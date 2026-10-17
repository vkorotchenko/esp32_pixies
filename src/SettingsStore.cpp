#include "SettingsStore.h"
#include <cstring>
#include <memory>

namespace {
using Header=pixies::RecordHeader;
constexpr size_t kRecordMax=pixies::kMaxBody+sizeof(Header);
bool removeChecked(Preferences& prefs,const char* key) {
  return !prefs.isKey(key) || (prefs.remove(key)&&!prefs.isKey(key));
}
}
bool SettingsStore::begin() {
  const bool s=settings_.begin("px-settings",false);
  const bool c=credentials_.begin("px-creds",false);
  ready_=s&&c;
  if(!ready_) { settingsRecovery="storage_unavailable"; credentialRecovery="storage_unavailable"; powerRecovery="storage_unavailable"; }
  return ready_;
}
bool SettingsStore::read(Preferences& prefs,const char* key,uint8_t* out,size_t cap,size_t& length) {
  length=0;
  if(!ready_) return false;
  const size_t n=prefs.getBytesLength(key);
  if(n<sizeof(Header)||n>kRecordMax||n>cap+sizeof(Header)) return false;
  std::unique_ptr<uint8_t[]> buf(new(std::nothrow) uint8_t[n]);
  if(!buf||prefs.getBytes(key,buf.get(),n)!=n) return false;
  Header h; memcpy(&h,buf.get(),sizeof h);
  if(!pixies::validRecord(h,buf.get()+sizeof h,n,cap)) {
    memset(buf.get(),0,n); return false;
  }
  length=h.length; memcpy(out,buf.get()+sizeof h,length); memset(buf.get(),0,n); return true;
}
bool SettingsStore::write(Preferences& prefs,const char* key,const uint8_t* data,size_t n) {
  if(!ready_||n>pixies::kMaxBody) return false;
  const size_t size=sizeof(Header)+n;
  std::unique_ptr<uint8_t[]> buf(new(std::nothrow) uint8_t[size]);
  std::unique_ptr<uint8_t[]> verify(new(std::nothrow) uint8_t[size]);
  if(!buf||!verify) return false;
  Header h{pixies::kRecordMagic,1,uint32_t(n),pixies::crc32(data,n)};
  memcpy(buf.get(),&h,sizeof h); memcpy(buf.get()+sizeof h,data,n);
  const bool ok=prefs.putBytes(key,buf.get(),size)==size&&
    prefs.getBytesLength(key)==size&&prefs.getBytes(key,verify.get(),size)==size&&
    !memcmp(buf.get(),verify.get(),size);
  memset(buf.get(),0,size); memset(verify.get(),0,size); return ok;
}
bool SettingsStore::loadSettings(pixies::Settings& out) {
  if(!ready_) return false;
  const bool exists=settings_.isKey("record");
  std::unique_ptr<uint8_t[]> data(new(std::nothrow) uint8_t[pixies::kMaxBody]);
  size_t n=0;
  if(!data||!read(settings_,"record",data.get(),pixies::kMaxBody,n)) {
    settingsRecovery=exists ? "invalid_record" : "missing"; return false;
  }
  DynamicJsonDocument doc(pixies::kJsonCapacity); const char* field;
  const bool ok=pixies::completeJsonObject(reinterpret_cast<const char*>(data.get()),n)&&
    !deserializeJson(doc,data.get(),n,DeserializationOption::NestingLimit(6))&&
    pixies::readSettings(doc.as<JsonVariantConst>(),out,field);
  settingsRecovery=ok ? "none" : "invalid_record"; return ok;
}
bool SettingsStore::saveSettings(const pixies::Settings& s) {
  const char* f;
  if(!pixies::validate(s,f)) return false;
  DynamicJsonDocument doc(pixies::kJsonCapacity);
  pixies::writeSettings(doc.to<JsonObject>(),s);
  String json; serializeJson(doc,json);
  const bool ok=!doc.overflowed()&&write(settings_,"record",reinterpret_cast<const uint8_t*>(json.c_str()),json.length());
  if(ok) settingsRecovery="none";
  return ok;
}
bool SettingsStore::loadPower(pixies::PowerSettings& out) {
  if(!ready_) { powerRecovery="storage_unavailable"; return false; }
  const bool exists=settings_.isKey("power");
  uint8_t data[256]{}; size_t n=0;
  if(!read(settings_,"power",data,sizeof data,n)) {
    powerRecovery=exists ? "invalid_record" : "missing"; return false;
  }
  StaticJsonDocument<256> doc; const char* field;
  const bool ok=pixies::completeJsonObject(reinterpret_cast<const char*>(data),n)&&
    !deserializeJson(doc,data,n,DeserializationOption::NestingLimit(2))&&
    pixies::readPowerSettings(doc.as<JsonVariantConst>(),out,field);
  powerRecovery=ok ? "none" : "invalid_record"; return ok;
}
bool SettingsStore::savePower(const pixies::PowerSettings& value) {
  const char* field;
  if(!pixies::validatePower(value,field)) return false;
  StaticJsonDocument<256> doc;
  pixies::writePowerSettings(doc.to<JsonObject>(),value);
  String text; serializeJson(doc,text);
  const bool ok=!doc.overflowed()&&write(settings_,"power",reinterpret_cast<const uint8_t*>(text.c_str()),text.length());
  if(ok) powerRecovery="none";
  return ok;
}
bool SettingsStore::loadWifi(WifiCredential& wifi) {
  size_t n=0;
  WifiCredential temp;
  if(!read(credentials_,"wifi",reinterpret_cast<uint8_t*>(&temp),sizeof temp,n)||
      n!=sizeof temp||!memchr(temp.ssid,0,sizeof temp.ssid)||!temp.ssid[0]||
      !memchr(temp.password,0,sizeof temp.password)) {
    if(ready_&&credentials_.isKey("wifi")) credentialRecovery="invalid_wifi_record";
    return false;
  }
  wifi=temp; temp={}; return true;
}
bool SettingsStore::saveWifi(const WifiCredential& wifi) {
  return write(credentials_,"wifi",reinterpret_cast<const uint8_t*>(&wifi),sizeof wifi);
}
bool SettingsStore::loadAdmin(AdminVerifier& verifier) {
  size_t n=0; AdminVerifier temp;
  if(!read(credentials_,"admin",reinterpret_cast<uint8_t*>(&temp),sizeof temp,n)||
      n!=sizeof temp||temp.iterations!=60000) {
    if(ready_&&credentials_.isKey("admin")) credentialRecovery="invalid_admin_record";
    return false;
  }
  verifier=temp; return true;
}
bool SettingsStore::saveAdmin(const AdminVerifier& v) {
  return write(credentials_,"admin",reinterpret_cast<const uint8_t*>(&v),sizeof v);
}
bool SettingsStore::resetWifi() { return ready_&&removeChecked(credentials_,"wifi"); }
bool SettingsStore::factoryReset() {
  if(!ready_) return false;
  // Separate namespaces deliberately; a partial erase is an explicit error.
  const bool s=settings_.clear();
  const bool c=credentials_.clear();
  return s&&c&&!settings_.isKey("record")&&!settings_.isKey("power")&&!credentials_.isKey("wifi")&&!credentials_.isKey("admin");
}
