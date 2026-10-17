#pragma once
// Stateful radio boundary for the REAL NetworkManager/SettingsStore adapters.
// begin() starts an attempt; only an explicit test event establishes a link.
#include "Preferences.h"
#include <cstdint>
#include <cstdio>
#include <vector>
class IPAddress {
  uint8_t bytes_[4];
 public:
  IPAddress(uint8_t a,uint8_t b,uint8_t c,uint8_t d):bytes_{a,b,c,d} {}
  bool operator==(const IPAddress& other) const { return !memcmp(bytes_,other.bytes_,4); }
  bool operator!=(const IPAddress& other) const { return !(*this==other); }
  String toString() const {
    char text[16]; snprintf(text,sizeof text,"%u.%u.%u.%u",bytes_[0],bytes_[1],bytes_[2],bytes_[3]); return text;
  }
};
enum { WIFI_STA=1,WIFI_AP_STA=3,WL_CONNECTED=3,WL_DISCONNECTED=6,WIFI_SCAN_FAILED=-2 };
namespace fake_wifi {
inline uint32_t now=100;
inline bool connected=false,hasIp=false,ap=false,protectedAp=false;
inline unsigned disconnects=0,apCloses=0;
inline std::string ssid,requested;
inline std::vector<std::string> events;
inline void reset() {
  now=100; connected=hasIp=ap=protectedAp=false;
  disconnects=apCloses=0; ssid.clear(); requested.clear(); events.clear();
}
inline void connect(const char* name,bool ip=true) { connected=true; hasIp=ip; ssid=name; }
}
inline uint32_t millis() { return fake_wifi::now; }
class WiFiClient {
 public:
  IPAddress localIP() const { return IPAddress(192,168,4,1); }
};
class FakeWiFi {
 public:
  void persistent(bool) {}
  void setAutoReconnect(bool) {}
  void setHostname(const char*) {}
  void mode(int) {}
  bool softAPConfig(IPAddress,IPAddress,IPAddress) { return true; }
  bool softAP(const char*,const char* password,int,bool,int) {
    fake_wifi::protectedAp=password&&strlen(password)>=8;
    fake_wifi::ap=true; fake_wifi::events.push_back("ap-open"); return true;
  }
  void softAPdisconnect(bool) {
    fake_wifi::ap=false; ++fake_wifi::apCloses; fake_wifi::events.push_back("ap-close");
  }
  void disconnect(bool,bool) {
    fake_wifi::connected=fake_wifi::hasIp=false; fake_wifi::ssid.clear(); fake_wifi::requested.clear();
    ++fake_wifi::disconnects; fake_wifi::events.push_back("disconnect");
  }
  void begin(const char* ssid,const char*) {
    fake_wifi::requested=ssid;
    fake_wifi::events.push_back(std::string("begin:")+ssid);
  }
  int status() const { return fake_wifi::connected?WL_CONNECTED:WL_DISCONNECTED; }
  IPAddress localIP() const { return fake_wifi::hasIp?IPAddress(10,0,0,2):IPAddress(0,0,0,0); }
  String SSID() const { return fake_wifi::ssid; }
  int scanComplete() const { return 0; }
  void scanDelete() {}
  int scanNetworks(bool,bool,bool,int) { return -1; }
};
inline FakeWiFi WiFi;
inline struct FakeSerial {
  template<class... T> void printf(const char*,T...) const {}
  void println(const char*) const {}
} Serial;
inline struct FakeESP {
  uint64_t getEfuseMac() const { return 0x123456789abcULL; }
} ESP;
