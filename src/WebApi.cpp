#include "WebApi.h"
#include "config.h"
#include <esp_system.h>
#include <cstring>

extern const uint8_t index_start[] asm("_binary_web_index_html_start");
extern const uint8_t index_end[] asm("_binary_web_index_html_end");
extern const uint8_t app_start[] asm("_binary_web_app_js_start");
extern const uint8_t app_end[] asm("_binary_web_app_js_end");
extern const uint8_t styles_start[] asm("_binary_web_styles_css_start");
extern const uint8_t styles_end[] asm("_binary_web_styles_css_end");

namespace {
bool boundedText(JsonVariantConst v,size_t min,size_t max,String& out) {
  if(!v.is<const char*>()) return false;
  const JsonString s=v.as<JsonString>();
  if(s.size()<min||s.size()>max||strlen(s.c_str())!=s.size()) return false;
  out=s.c_str(); return true;
}
bool wifiPassword(const String& p) {
  if(p.length()==0) return true; // Explicitly selecting an open router is allowed.
  if(p.length()==64) {
    for(size_t i=0;i<64;++i) if(!isxdigit(static_cast<unsigned char>(p[i]))) return false;
    return true;
  }
  return p.length()>=8&&p.length()<=63;
}
String authority(String value) {
  value.toLowerCase();
  if(value.endsWith(":80")) value.remove(value.length()-3);
  return value;
}
}
void WebApi::headers() {
  server_.sendHeader("Cache-Control","no-store");
  server_.sendHeader("X-Content-Type-Options","nosniff");
  server_.sendHeader("Referrer-Policy","no-referrer");
  server_.sendHeader("X-Frame-Options","DENY");
  server_.sendHeader("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  server_.sendHeader("Connection","close");
}
void WebApi::error(int code,const char* name,const char* message,const char* field) {
  StaticJsonDocument<384> doc;
  auto e=doc.createNestedObject("error"); e["code"]=name; e["message"]=message;
  if(field) e["field"]=field;
  json(code,doc);
}
void WebApi::json(int code,JsonDocument& doc) {
  headers();
  if(doc.overflowed()) { server_.send(503,"application/json","{\"error\":{\"code\":\"out_of_memory\",\"message\":\"Response unavailable\"}}"); return; }
  String text; serializeJson(doc,text); server_.send(code,"application/json",text);
}
bool WebApi::originValid() const {
  // WebServer's accessor API is non-const.
  auto& s=const_cast<BoundedWebServer&>(server_);
  const String host=authority(s.hostHeader());
  return s.header("Origin")=="http://"+host;
}
bool WebApi::requestGate() {
  const String host=authority(server_.hostHeader());
  const String local=server_.client().localIP().toString();
  const bool allowed=host==local||host==network_.hostname||host==network_.hostname+".local";
  if(!allowed) {
    if(server_.method()==HTTP_GET&&!server_.uri().startsWith("/api/")) {
      headers(); server_.sendHeader("Location","http://192.168.4.1/"); server_.send(302,"text/plain","");
    } else error(403,"bad_host","Use the device IP address or its advertised hostname");
    return false;
  }
  if(server_.method()!=HTTP_GET) {
    if(!originValid()||server_.header("X-Pixies-Request")!="1") {
      error(403,"origin","Same-origin request headers are required"); return false;
    }
    if(server_.uri()!="/api/update"&&server_.header("Content-Type")!="application/json") {
      error(415,"content_type","Use application/json"); return false;
    }
  }
  return true;
}
bool WebApi::adminGuard(bool csrf) {
  if(!admin_.authenticated(server_,millis())) { error(401,"authentication","Admin login required"); return false; }
  if(csrf&&(!originValid()||!admin_.csrf(server_))) { error(403,"csrf","CSRF token or origin invalid"); return false; }
  return true;
}
bool WebApi::uploadGuard() {
  return pixies::adminAllowed(admin_.authenticated(server_,millis()),originValid(),admin_.csrf(server_));
}
bool WebApi::body(JsonDocument& doc,const char* const* keys,size_t n) {
  if(server_.body().length()>pixies::kMaxBody) { error(413,"body_too_large","JSON body exceeds 8192 bytes"); return false; }
  if(!pixies::completeJsonObject(server_.body().c_str(),server_.body().length())) {
    error(400,"invalid_json","Expected one complete JSON object"); return false;
  }
  const auto result=deserializeJson(doc,server_.body(),DeserializationOption::NestingLimit(7));
  if(result||!doc.is<JsonObject>()||doc.size()!=n||!pixies::keysOnly(doc.as<JsonObjectConst>(),keys,n)) {
    error(400,"invalid_json","Expected an object with exactly the documented fields"); return false;
  }
  return true;
}
bool WebApi::idle() {
  if(ota_.busy||restartScheduled_) { error(409,"busy","Update or restart in progress"); return false; }
  return true;
}
bool WebApi::revision(JsonVariantConst v) {
  if(!v.is<uint32_t>()||v.is<bool>()) { error(422,"validation","baseRevision must be an integer","baseRevision"); return false; }
  if(v.as<uint32_t>()!=settings_.revision) { error(409,"revision_conflict","Reload configuration before retrying"); return false; }
  return true;
}
void WebApi::config() {
  DynamicJsonDocument doc(pixies::kJsonCapacity);
  doc["schemaVersion"]=1; doc["bootId"]=bootId_;
  doc["revision"]=settings_.revision; doc["savedRevision"]=settings_.savedRevision;
  doc["dirty"]=settings_.dirty(); doc["activeLedCount"]=settings_.activeCount;
  doc["requestedLedCount"]=settings_.live.ledCount; doc["savedLedCount"]=settings_.persisted.ledCount;
  doc["restartRequired"]=settings_.restartRequired();
  doc["savedRestartRequired"]=settings_.persisted.ledCount!=settings_.activeCount;
  pixies::writeSettings(doc.createNestedObject("config"),settings_.live);
  json(200,doc);
}
void WebApi::status() {
  DynamicJsonDocument doc(4096);
  doc["schemaVersion"]=1; doc["bootId"]=bootId_;
  auto firmware=doc.createNestedObject("firmware");
  firmware["version"]=PIXIES_VERSION; firmware["target"]=PIXIES_TARGET;
  firmware["flashBytes"]=ESP.getFlashChipSize(); firmware["psramBytes"]=ESP.getPsramSize();
  firmware["expectedFlashBytes"]=16777216; firmware["expectedPsramBytes"]=8388608;
  firmware["memoryMatches"]=ESP.getFlashChipSize()==16777216&&ESP.getPsramSize()==8388608;
  doc["uptimeMs"]=millis(); doc["freeHeapBytes"]=ESP.getFreeHeap();
  auto s=doc.createNestedObject("settings");
  s["revision"]=settings_.revision; s["savedRevision"]=settings_.savedRevision;
  s["dirty"]=settings_.dirty(); s["activeLedCount"]=settings_.activeCount;
  s["requestedLedCount"]=settings_.live.ledCount; s["savedLedCount"]=settings_.persisted.ledCount;
  s["restartRequired"]=settings_.restartRequired();
  s["savedRestartRequired"]=settings_.persisted.ledCount!=settings_.activeCount;
  s["recovery"]=store_.settingsRecovery;
  auto led=doc.createNestedObject("led");
  led["ready"]=leds_.ready; led["gpio"]=PIXIES_LED_PIN; led["order"]=PIXIES_COLOR_GRB?"GRB":"RGB";
  led["maxCount"]=pixies::kMaxLeds; led["budgetMa"]=PIXIES_CURRENT_MA;
  led["estimatedMa"]=leds_.power.estimatedMa; led["requestedMa"]=leds_.power.requestedMa;
  led["limited"]=leds_.power.limited; led["scalePermille"]=leds_.power.scalePermille;
  led["frames"]=leds_.frames; led["pausedForUpdate"]=ota_.busy;
  auto net=doc.createNestedObject("network");
  net["state"]=network_.state; net["hostname"]=network_.hostname+".local";
  net["connected"]=WiFi.status()==WL_CONNECTED;
  net["ip"]=WiFi.status()==WL_CONNECTED?WiFi.localIP().toString():String("");
  net["ssid"]=WiFi.status()==WL_CONNECTED?WiFi.SSID():String("");
  net["apOpen"]=network_.apOpen; net["apSsid"]=network_.apSsid;
  net["apIp"]=network_.apOpen?"192.168.4.1":"";
  net["wifiSaved"]=network_.wifiSaved; net["candidateState"]=network_.candidateState;
  net["scanState"]=network_.scanState; net["error"]=network_.error;
  auto admin=doc.createNestedObject("admin");
  admin["configured"]=admin_.configured; admin["credentialRecovery"]=store_.credentialRecovery;
  admin["claimAllowed"]=pixies::canClaim(admin_.configured,network_.apOpen,network_.apPeer(server_.client()));
  auto update=doc.createNestedObject("update");
  update["state"]=ota_.state; update["busy"]=ota_.busy; update["receivedBytes"]=ota_.received();
  update["expectedBytes"]=ota_.expected(); update["slotBytes"]=ota_.slotSize(); update["error"]=ota_.error;
  doc["restarting"]=restartScheduled_;
  json(200,doc);
}
void WebApi::session(bool newlyAuthenticated) {
  StaticJsonDocument<384> doc;
  const bool auth=newlyAuthenticated||admin_.authenticated(server_,millis());
  doc["configured"]=admin_.configured; doc["authenticated"]=auth;
  doc["claimAllowed"]=pixies::canClaim(admin_.configured,network_.apOpen,network_.apPeer(server_.client()));
  if(auth) doc["csrfToken"]=admin_.csrfToken(); else doc["csrfToken"]=nullptr;
  doc["sessionLifetimeSeconds"]=1800;
  json(200,doc);
}
void WebApi::restartLater() { restartScheduled_=true; restartAt_=millis(); }
void WebApi::begin() {
  char id[17]; snprintf(id,sizeof id,"%08lx%08lx",static_cast<unsigned long>(esp_random()),static_cast<unsigned long>(esp_random()));
  bootId_=id; admin_.begin();
  const char* collected[]{"Content-Type","Origin","Cookie","X-CSRF-Token","X-Pixies-Request","X-Firmware-Size"};
  server_.collectHeaders(collected,6);
  server_.requestGate=[this](){ return requestGate(); };
  ota_.guard=[this](){ return uploadGuard(); };
  server_.uploadStart=[this](size_t length) {
    if(!adminGuard()||!idle()) return false;
    if(network_.operationBusy()||!strcmp(network_.scanState,"running")) {
      error(409,"busy","Finish Wi-Fi operation before firmware upload"); return false;
    }
    if(server_.header("Content-Type")!="application/octet-stream") {
      error(415,"content_type","Upload raw application/octet-stream, not multipart"); return false;
    }
    const String declared=server_.header("X-Firmware-Size");
    bool digits=declared.length()>0&&declared.length()<9;
    for(size_t i=0;i<declared.length();++i) if(declared[i]<'0'||declared[i]>'9') digits=false;
    if(!digits||strtoul(declared.c_str(),nullptr,10)!=length) {
      error(400,"length_mismatch","X-Firmware-Size must equal Content-Length and actual file size"); return false;
    }
    if(length<288||length>ota_.slotSize()) { error(413,"image_size","Application image outside OTA slot bounds"); return false; }
    if(!ota_.begin(length)) { error(422,"update_rejected",ota_.error); return false; }
    network_.holdAp=true;
    return true;
  };
  server_.uploadChunk=[this](const uint8_t* bytes,size_t n) {
    if(!ota_.chunk(bytes,n)) { error(uploadGuard()?422:401,"update_failed",ota_.error); return false; }
    return true;
  };
  server_.uploadEnd=[this]() {
    if(!ota_.end()) { error(uploadGuard()?422:401,"update_failed",ota_.error); return false; }
    return true;
  };
  server_.uploadAbort=[this](){ if(ota_.busy) ota_.abort(); };
  server_.on("/",HTTP_GET,[this](){ headers(); server_.send_P(200,"text/html; charset=utf-8",
    reinterpret_cast<const char*>(index_start),size_t(index_end-index_start)-1); });
  server_.on("/app.js",HTTP_GET,[this](){ headers(); server_.send_P(200,"text/javascript; charset=utf-8",
    reinterpret_cast<const char*>(app_start),size_t(app_end-app_start)-1); });
  server_.on("/styles.css",HTTP_GET,[this](){ headers(); server_.send_P(200,"text/css; charset=utf-8",
    reinterpret_cast<const char*>(styles_start),size_t(styles_end-styles_start)-1); });
  server_.on("/api/status",HTTP_GET,[this](){ status(); });
  server_.on("/api/config",HTTP_GET,[this](){ config(); });
  server_.on("/api/palettes",HTTP_GET,[this](){
    DynamicJsonDocument doc(pixies::kJsonCapacity);
    auto list=doc.createNestedArray("palettes");
    pixies::writePalette(list.createNestedObject(),pixies::halloween(),true);
    pixies::writePalette(list.createNestedObject(),pixies::christmas(),true);
    for(size_t i=0;i<settings_.live.customCount;++i) {
      auto p=list.createNestedObject(); pixies::writePalette(p,settings_.live.custom[i],false); p["builtin"]=false;
    }
    json(200,doc);
  });
  server_.on("/api/config",HTTP_PUT,[this](){
    if(!idle()) return;
    DynamicJsonDocument doc(pixies::kJsonCapacity);
    const char* keys[]{"baseRevision","config"};
    if(!body(doc,keys,2)||!revision(doc["baseRevision"])) return;
    pixies::Settings s; const char* field;
    if(!pixies::readSettings(doc["config"],s,field)) { error(422,"validation","Invalid configuration; nothing applied",field); return; }
    if(!settings_.preview(s,doc["baseRevision"])) { error(409,"revision_conflict","Reload configuration"); return; }
    config();
  });
  server_.on("/api/save",HTTP_POST,[this](){
    if(!idle()) return;
    StaticJsonDocument<128> doc; const char* keys[]{"baseRevision"};
    if(!body(doc,keys,1)||!revision(doc["baseRevision"])) return;
    if(!store_.saveSettings(settings_.live)) { error(500,"storage_failed","Settings were not confirmed saved"); return; }
    settings_.saved(); config();
  });
  server_.on("/api/auth/session",HTTP_GET,[this](){ session(); });
  server_.on("/api/auth/claim",HTTP_POST,[this](){
    if(!idle()) return;
    if(!pixies::canClaim(admin_.configured,network_.apOpen,network_.apPeer(server_.client()))) {
      error(403,"claim_forbidden","Initial claim requires the protected setup AP and an unconfigured admin"); return;
    }
    StaticJsonDocument<256> doc; const char* keys[]{"password"}; String password;
    if(!body(doc,keys,1)) return;
    if(!boundedText(doc["password"],12,64,password)) { error(422,"validation","Admin password must be 12..64 bytes","password"); return; }
    const bool ok=admin_.claim(password); memset(const_cast<char*>(password.c_str()),0,password.length());
    if(!ok) { error(500,"storage_failed","Admin verifier was not saved"); return; }
    admin_.cookie(server_); session(true);
  });
  server_.on("/api/auth/login",HTTP_POST,[this](){
    if(!idle()) return;
    const uint32_t retry=admin_.retryAfter(millis());
    if(retry) { server_.sendHeader("Retry-After",String((retry+999)/1000)); error(429,"rate_limited","Wait before trying login again"); return; }
    StaticJsonDocument<256> doc; const char* keys[]{"password"}; String password;
    if(!body(doc,keys,1)) return;
    if(!boundedText(doc["password"],1,64,password)) { error(422,"validation","Password must be 1..64 bytes","password"); return; }
    const bool ok=admin_.login(password,millis()); memset(const_cast<char*>(password.c_str()),0,password.length());
    if(!ok) { error(401,"authentication","Login failed"); return; }
    admin_.cookie(server_); session(true);
  });
  server_.on("/api/auth/logout",HTTP_POST,[this](){
    if(!adminGuard()||!idle()) return;
    StaticJsonDocument<64> doc; if(!body(doc,nullptr,0)) return;
    admin_.logout();
    server_.sendHeader("Set-Cookie","pixies_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"); session();
  });
  server_.on("/api/wifi/scan",HTTP_POST,[this](){
    if(!adminGuard()||!idle()) return;
    StaticJsonDocument<96> doc; if(!body(doc,nullptr,0)) return;
    if(!network_.startScan()) { error(409,"busy","Scan cannot start during another connection/scan"); return; }
    doc["state"]="running"; json(202,doc);
  });
  server_.on("/api/wifi/scan",HTTP_GET,[this](){
    if(!adminGuard(false)) return;
    DynamicJsonDocument doc(4096); doc["state"]=network_.scanState;
    auto list=doc.createNestedArray("networks");
    const int total=WiFi.scanComplete();
    if(!strcmp(network_.scanState,"complete")&&total>=0) for(int i=0;i<total&&i<20;++i) {
      auto net=list.createNestedObject(); net["ssid"]=WiFi.SSID(i); net["rssi"]=WiFi.RSSI(i);
      net["channel"]=WiFi.channel(i); net["open"]=WiFi.encryptionType(i)==WIFI_AUTH_OPEN;
    }
    doc["truncated"]=total>20; json(200,doc);
  });
  server_.on("/api/wifi/connect",HTTP_POST,[this](){
    if(!adminGuard()||!idle()) return;
    StaticJsonDocument<512> doc; const char* keys[]{"ssid","password"}; String ssid,password;
    if(!body(doc,keys,2)) return;
    if(!boundedText(doc["ssid"],1,32,ssid)||!boundedText(doc["password"],0,64,password)||!wifiPassword(password)) {
      error(422,"validation","SSID must be 1..32 bytes; Wi-Fi password empty, 8..63 bytes, or 64 hex digits"); return;
    }
    WifiCredential candidate;
    memcpy(candidate.ssid,ssid.c_str(),ssid.length()+1);
    memcpy(candidate.password,password.c_str(),password.length()+1);
    memset(const_cast<char*>(password.c_str()),0,password.length());
    const bool ok=network_.connectCandidate(candidate); memset(&candidate,0,sizeof candidate);
    if(!ok) { error(409,"busy","Another Wi-Fi operation is active"); return; }
    doc.clear(); doc["state"]="connecting"; json(202,doc);
  });
  server_.on("/api/wifi/reset",HTTP_POST,[this](){
    if(!adminGuard()||!idle()) return;
    StaticJsonDocument<160> doc; const char* keys[]{"confirm"};
    if(!body(doc,keys,1)) return;
    if(doc["confirm"]!="wifi-reset") { error(422,"confirmation","Expected confirm: wifi-reset"); return; }
    if(network_.operationBusy()) { error(409,"busy","Wi-Fi operation is active"); return; }
    if(!network_.resetWifi()) { error(500,"storage_failed","Wi-Fi credentials could not be removed"); return; }
    doc.clear(); doc["state"]="setup_ap"; doc["apIp"]="192.168.4.1"; json(200,doc);
  });
  server_.on("/api/restart",HTTP_POST,[this](){
    if(!adminGuard()||!idle()) return;
    StaticJsonDocument<160> doc; const char* keys[]{"confirm"};
    if(!body(doc,keys,1)) return;
    if(doc["confirm"]!="restart") { error(422,"confirmation","Expected confirm: restart"); return; }
    if(network_.operationBusy()) { error(409,"busy","Wi-Fi operation is active"); return; }
    doc.clear(); doc["restarting"]=true; json(202,doc); restartLater();
  });
  server_.on("/api/factory-reset",HTTP_POST,[this](){
    if(!adminGuard()||!idle()) return;
    StaticJsonDocument<160> doc; const char* keys[]{"confirm"};
    if(!body(doc,keys,1)) return;
    if(doc["confirm"]!="factory-reset") { error(422,"confirmation","Expected confirm: factory-reset"); return; }
    if(network_.operationBusy()) { error(409,"busy","Wi-Fi operation is active"); return; }
    if(!store_.factoryReset()) { error(500,"storage_failed","Reset incomplete; USB recovery may be needed"); return; }
    admin_.logout(); doc.clear(); doc["restarting"]=true; json(202,doc); restartLater();
  });
  server_.on("/api/update",HTTP_POST,[this](){
    if(!adminGuard()||!ota_.select()) {
      if(ota_.busy) ota_.abort("boot_select_failed");
      // select errors are separate from failures already answered by the guard.
      if(uploadGuard()) error(500,"update_failed",ota_.error);
      return;
    }
    StaticJsonDocument<160> doc; doc["state"]="restarting"; doc["receivedBytes"]=ota_.received();
    doc["restarting"]=true; json(202,doc); restartLater();
  });
  server_.onNotFound([this](){
    if(server_.uri().startsWith("/api/")) error(404,"not_found","Unknown route or method");
    else { headers(); server_.sendHeader("Location","/"); server_.send(302,"text/plain",""); }
  });
  server_.begin();
}
void WebApi::tick(uint32_t now) {
  admin_.expire(now);
  network_.holdAp=ota_.busy;
  if(restartScheduled_&&pixies::elapsed(now,restartAt_,1000)) { ESP.restart(); return; }
  server_.handleClient();
}
