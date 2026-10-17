#pragma once
namespace fake_mdns {
inline bool active=false;
}
inline struct FakeMDNS {
  bool begin(const char*) { fake_mdns::active=true; return true; }
  void end() { fake_mdns::active=false; }
  void addService(const char*,const char*,unsigned) {}
} MDNS;
