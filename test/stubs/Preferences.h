#pragma once
#include <string>
#include <map>
#include <vector>
#include <cstring>
#ifdef PIXIES_WEB_API_TEST
#include "ArduinoString.h"
#else
using String=std::string;
#endif
namespace fake_nvs {
inline std::map<std::string,std::vector<uint8_t>> records;
inline bool failBegin=false, failWrite=false, failRead=false, failErase=false;
inline unsigned writes=0;
inline void reset() { records.clear(); failBegin=failWrite=failRead=failErase=false; writes=0; }
}
class Preferences {
  std::string ns_;
  std::string key(const char* k) const { return ns_+"/"+k; }
 public:
  bool begin(const char* ns,bool) { ns_=ns; return !fake_nvs::failBegin; }
  bool isKey(const char* k) { return fake_nvs::records.count(key(k)); }
  size_t getBytesLength(const char* k) { return isKey(k)?fake_nvs::records[key(k)].size():0; }
  size_t getBytes(const char* k,void* out,size_t n) {
    if(fake_nvs::failRead||!isKey(k)||n<getBytesLength(k)) return 0;
    auto& v=fake_nvs::records[key(k)]; memcpy(out,v.data(),v.size()); return v.size();
  }
  size_t putBytes(const char* k,const void* data,size_t n) {
    ++fake_nvs::writes;
    if(fake_nvs::failWrite) return 0;
    const auto* b=static_cast<const uint8_t*>(data);
    fake_nvs::records[key(k)]={b,b+n}; return n;
  }
  bool remove(const char* k) { return !fake_nvs::failErase&&fake_nvs::records.erase(key(k))!=0; }
  bool clear() {
    if(fake_nvs::failErase) return false;
    for(auto i=fake_nvs::records.begin();i!=fake_nvs::records.end();)
      if(i->first.find(ns_+"/")==0) i=fake_nvs::records.erase(i); else ++i;
    return true;
  }
};
