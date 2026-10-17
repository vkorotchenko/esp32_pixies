#include "DeviceControl.h"
#include "config.h"
#include <esp_system.h>
#include <cstring>

namespace {
int failure(JsonDocument& doc,int status,const char* code,const char* message,const char* field=nullptr) {
  doc.clear();
  auto e=doc.createNestedObject("error"); e["code"]=code; e["message"]=message;
  if(field) e["field"]=field;
  return status;
}
bool fields(JsonVariantConst args,std::initializer_list<const char*> keys) {
  if(!keys.size()&&args.isNull()) return true;
  return args.is<JsonObjectConst>()&&args.size()==keys.size()&&
    pixies::keysOnly(args.as<JsonObjectConst>(),keys.begin(),keys.size());
}
bool text(JsonVariantConst v,size_t min,size_t max) {
  if(!v.is<const char*>()) return false;
  const auto s=v.as<JsonString>();
  return s.size()>=min&&s.size()<=max&&strlen(s.c_str())==s.size();
}
bool wifiPassword(JsonVariantConst v) {
  if(!text(v,0,64)) return false;
  const auto s=v.as<JsonString>();
  if(s.size()==0) return true;
  if(s.size()!=64) return s.size()>=8&&s.size()<=63;
  for(size_t i=0;i<s.size();++i) {
    const char c=s.c_str()[i];
    if(!((c>='0'&&c<='9')||(c>='a'&&c<='f')||(c>='A'&&c<='F'))) return false;
  }
  return true;
}
}
void DeviceControl::begin() {
  char id[17]; snprintf(id,sizeof id,"%08lx%08lx",static_cast<unsigned long>(esp_random()),static_cast<unsigned long>(esp_random()));
  bootId=id; admin.begin();
  leds.powerReady=store.loadPower(leds.powerSettings);
  if(!strcmp(store.powerRecovery,"missing")) leds.powerReady=true;
}
void DeviceControl::restartLater() { restarting=true; restartAt=millis(); }
bool DeviceControl::resetAll() {
  return (!clearBonds||clearBonds())&&store.factoryReset();
}
bool DeviceControl::tick(uint32_t now) {
  admin.expire(now); network.holdAp=ota.busy;
  if(restarting&&static_cast<int32_t>(now-restartAt)>=1000) { ESP.restart(); return false; }
  return true;
}
void DeviceControl::config(JsonDocument& doc) {
  doc.clear();
  doc["schemaVersion"]=1; doc["bootId"]=bootId;
  doc["revision"]=settings.revision; doc["savedRevision"]=settings.savedRevision;
  doc["dirty"]=settings.dirty(); doc["activeLedCount"]=settings.activeCount;
  doc["requestedLedCount"]=settings.live.ledCount; doc["savedLedCount"]=settings.persisted.ledCount;
  doc["restartRequired"]=settings.restartRequired();
  doc["savedRestartRequired"]=settings.persisted.ledCount!=settings.activeCount;
  pixies::writeSettings(doc.createNestedObject("config"),settings.live);
}
void DeviceControl::status(JsonDocument& doc) {
  doc.clear(); doc["schemaVersion"]=1; doc["bootId"]=bootId;
  auto firmware=doc.createNestedObject("firmware");
  firmware["version"]=PIXIES_VERSION; firmware["target"]=PIXIES_TARGET;
  firmware["flashBytes"]=ESP.getFlashChipSize(); firmware["psramBytes"]=ESP.getPsramSize();
  firmware["expectedFlashBytes"]=16777216; firmware["expectedPsramBytes"]=8388608;
  firmware["memoryMatches"]=ESP.getFlashChipSize()==16777216&&ESP.getPsramSize()==8388608;
  doc["uptimeMs"]=millis(); doc["freeHeapBytes"]=ESP.getFreeHeap();
  auto s=doc.createNestedObject("settings");
  s["revision"]=settings.revision; s["savedRevision"]=settings.savedRevision;
  s["dirty"]=settings.dirty(); s["activeLedCount"]=settings.activeCount;
  s["requestedLedCount"]=settings.live.ledCount; s["savedLedCount"]=settings.persisted.ledCount;
  s["restartRequired"]=settings.restartRequired();
  s["savedRestartRequired"]=settings.persisted.ledCount!=settings.activeCount;
  s["recovery"]=store.settingsRecovery;
  ledStatus(doc.createNestedObject("led"));
  powerStatus(doc.createNestedObject("power"));
  auto net=doc.createNestedObject("network");
  net["state"]=network.state; net["hostname"]=network.hostname+".local";
  net["connected"]=WiFi.status()==WL_CONNECTED;
  net["ip"]=WiFi.status()==WL_CONNECTED?WiFi.localIP().toString():String("");
  net["ssid"]=WiFi.status()==WL_CONNECTED?WiFi.SSID():String("");
  net["apOpen"]=network.apOpen; net["apSsid"]=network.apSsid;
  net["apIp"]=network.apOpen?"192.168.4.1":"";
  net["wifiSaved"]=network.wifiSaved; net["candidateState"]=network.candidateState;
  net["scanState"]=network.scanState; net["error"]=network.error;
  auto a=doc.createNestedObject("admin");
  a["configured"]=admin.configured; a["credentialRecovery"]=store.credentialRecovery;
  // HTTP adds the protected-AP peer decision; BLE never needs the web claim flow.
  a["claimAllowed"]=false;
  auto update=doc.createNestedObject("update");
  update["bleOtaProtocol"]=1;
  update["state"]=ota.state; update["busy"]=ota.busy; update["receivedBytes"]=ota.received();
  update["expectedBytes"]=ota.expected(); update["slotBytes"]=ota.slotSize(); update["error"]=ota.error;
  doc["restarting"]=restarting;
}
void DeviceControl::ledStatus(JsonObject led) {
  led["ready"]=leds.ready; led["gpio"]=PIXIES_LED_PIN;
  led["protocol"]=PIXIES_LED_WS2811?"WS2811":"WS2812x";
  led["order"]=PIXIES_COLOR_GRB?"GRB":"RGB";
  led["maxCount"]=pixies::kMaxLeds; led["budgetMa"]=leds.powerBudgetMa();
  led["estimatedMa"]=leds.power.estimatedMa; led["requestedMa"]=leds.power.requestedMa;
  led["limited"]=leds.power.limited; led["scalePermille"]=leds.power.scalePermille;
  led["standbyExceedsBudget"]=leds.power.standbyExceedsBudget;
  led["frames"]=leds.frames; led["pausedForUpdate"]=ota.busy;
  led["activeLedCount"]=settings.activeCount; led["requestedLedCount"]=settings.live.ledCount;
  led["on"]=settings.live.on; led["brightness"]=settings.live.brightness;
  led["effect"]=pixies::effectName(settings.live.effect); led["paletteId"]=settings.live.paletteId;
}
void DeviceControl::powerStatus(JsonObject power) {
  power["revision"]=powerRevision;
  power["supplyWatts"]=leds.powerSettings.supplyWatts;
  power["ledMilliWatts"]=leds.powerSettings.ledMilliWatts;
  power["headroomPercent"]=pixies::kPowerHeadroomPercent;
  power["volts"]=pixies::kLedSupplyVolts;
  power["maximumMa"]=PIXIES_CURRENT_MA;
  power["budgetMa"]=leds.powerBudgetMa();
  power["ready"]=leds.powerReady;
  power["recovery"]=store.powerRecovery;
}
int DeviceControl::execute(const char* op,JsonVariantConst args,JsonDocument& out) {
  out.clear();
  const auto bad=[&](){ return failure(out,400,"invalid_json","Expected exactly the documented command fields"); };
  if(!strcmp(op,"config")||!strcmp(op,"status")||!strcmp(op,"palettes")||!strcmp(op,"wifi.scan.get")) {
    if(!fields(args,{})) return bad();
    if(!strcmp(op,"config")) config(out);
    else if(!strcmp(op,"status")) status(out);
    else if(!strcmp(op,"palettes")) {
      auto list=out.createNestedArray("palettes");
      pixies::writePalette(list.createNestedObject(),pixies::lightBlue(),true);
      pixies::writePalette(list.createNestedObject(),pixies::halloween(),true);
      pixies::writePalette(list.createNestedObject(),pixies::christmas(),true);
      for(size_t i=0;i<settings.live.customCount;++i) pixies::writePalette(list.createNestedObject(),settings.live.custom[i],false);
    } else {
      out["state"]=network.scanState; auto list=out.createNestedArray("networks");
      const int total=WiFi.scanComplete();
      if(!strcmp(network.scanState,"complete")&&total>=0) for(int i=0;i<total&&i<20;++i) {
        auto n=list.createNestedObject(); n["ssid"]=WiFi.SSID(i); n["rssi"]=WiFi.RSSI(i);
        n["channel"]=WiFi.channel(i); n["open"]=WiFi.encryptionType(i)==WIFI_AUTH_OPEN;
      }
      out["truncated"]=total>20;
    }
    return 200;
  }
  if(ota.busy||restarting) return failure(out,409,"busy","Update or restart in progress");
  if(!strcmp(op,"power.save")) {
    if(!fields(args,{"baseRevision","power"})) return bad();
    const auto revision=args["baseRevision"];
    if(!revision.is<uint32_t>()||revision.is<bool>())
      return failure(out,422,"validation","baseRevision must be an integer","baseRevision");
    if(revision.as<uint32_t>()!=powerRevision||powerRevision==UINT32_MAX)
      return failure(out,409,"revision_conflict","Refresh power settings before retrying");
    pixies::PowerSettings candidate; const char* field;
    if(!pixies::readPowerSettings(args["power"],candidate,field))
      return failure(out,422,"validation","Supply must be 1..2000 W; LED power must be 10..10000 mW",field);
    if(!store.savePower(candidate))
      return failure(out,500,"storage_failed","Power settings were not confirmed saved; previous limits remain active");
    leds.powerSettings=candidate; leds.powerReady=true; ++powerRevision;
    status(out); return 200;
  }
  if(!strcmp(op,"config.set")||!strcmp(op,"config.save")) {
    const bool preview=!strcmp(op,"config.set");
    if(preview?!fields(args,{"baseRevision","config"}):!fields(args,{"baseRevision"})) return bad();
    auto revision=args["baseRevision"];
    if(!revision.is<uint32_t>()||revision.is<bool>())
      return failure(out,422,"validation","baseRevision must be an integer","baseRevision");
    if(revision.as<uint32_t>()!=settings.revision)
      return failure(out,409,"revision_conflict","Reload configuration before retrying");
    if(preview) {
      pixies::Settings candidate; const char* field;
      if(!pixies::readSettings(args["config"],candidate,field))
        return failure(out,422,"validation","Invalid configuration; nothing applied",field);
      if(!settings.preview(candidate,revision.as<uint32_t>()))
        return failure(out,409,"revision_conflict","Reload configuration before retrying");
    } else {
      if(!store.saveSettings(settings.live)) return failure(out,500,"storage_failed","Settings were not confirmed saved");
      settings.saved();
    }
    config(out); return 200;
  }
  if(!strcmp(op,"wifi.scan")) {
    if(!fields(args,{})) return bad();
    if(!network.startScan()) return failure(out,409,"busy","Scan cannot start during another connection/scan");
    out["state"]="running"; return 202;
  }
  if(!strcmp(op,"wifi.connect")) {
    if(!fields(args,{"ssid","password"})) return bad();
    if(!text(args["ssid"],1,32)||!wifiPassword(args["password"]))
      return failure(out,422,"validation","SSID must be 1..32 bytes; password empty, 8..63 bytes, or 64 hex digits");
    WifiCredential candidate;
    strcpy(candidate.ssid,args["ssid"].as<const char*>());
    strcpy(candidate.password,args["password"].as<const char*>());
    const bool accepted=network.connectCandidate(candidate); candidate={};
    if(!accepted) return failure(out,409,"busy","Another Wi-Fi operation is active");
    out["state"]="connecting"; return 202;
  }
  if(!strcmp(op,"admin.claim")) {
    if(!fields(args,{"password"})) return bad();
    if(admin.configured) return failure(out,409,"already_configured","Website administration is already configured");
    if(!text(args["password"],12,64)) return failure(out,422,"validation","Website password must be 12..64 bytes");
    String password=args["password"].as<const char*>();
    const bool saved=admin.claim(password);
    memset(const_cast<char*>(password.c_str()),0,password.length());
    admin.logout();
    if(!saved) return failure(out,500,"storage_failed","Website administration was not saved");
    out["configured"]=true; return 200;
  }
  if(!strcmp(op,"restart")||!strcmp(op,"wifi.reset")||!strcmp(op,"factory-reset")) {
    if(!fields(args,{"confirm"})) return bad();
    const char* expected=!strcmp(op,"wifi.reset")?"wifi-reset":op;
    if(args["confirm"]!=expected) return failure(out,422,"confirmation","Confirmation does not match the operation");
    if(network.operationBusy()) return failure(out,409,"busy","Wi-Fi operation is active");
    if(!strcmp(op,"wifi.reset")) {
      if(!network.resetWifi()) return failure(out,500,"storage_failed","Wi-Fi credentials could not be removed");
      out["state"]="setup_ap"; out["apIp"]="192.168.4.1"; return 200;
    }
    if(!strcmp(op,"factory-reset")) {
      if(!resetAll()) return failure(out,500,"storage_failed","Reset incomplete; Bluetooth bonds or NVS could not be cleared");
      admin.logout();
    }
    restartLater(); out["restarting"]=true; return 202;
  }
  return failure(out,404,"not_found","Unknown Bluetooth command");
}
