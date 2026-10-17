#pragma once
#include <WiFi.h>
#include <DNSServer.h>
#include <ESPmDNS.h>
#include "SettingsStore.h"
class NetworkManager {
 public:
  explicit NetworkManager(SettingsStore& store):store_(store) {}
  void begin();
  void tick(uint32_t);
  bool connectCandidate(const WifiCredential&);
  bool startScan();
  bool resetWifi();
  bool operationBusy() const { return candidateBusy||resetPending_; }
  void printSetupLocally() const;
  bool apPeer(const WiFiClient&) const;
  bool apOpen=false, candidateBusy=false;
  String hostname, apSsid;
  const char* state="unconfigured";
  const char* candidateState="idle";
  const char* error="";
  const char* scanState="idle";
  bool wifiSaved=false;
  bool holdAp=false;
  uint32_t scanStarted=0;
 private:
  SettingsStore& store_;
  DNSServer dns_;
  WifiCredential saved_{}, candidate_{};
  char apPassword_[25]{};
  uint32_t attemptAt_=0,retryAt_=0,connectedAt_=0;
  bool attempting_=false, mdns_=false, wasConnected_=false, retryPending_=false;
  bool candidatePending_=false, resetPending_=false, timingConnection_=false;
  uint32_t actionAt_=0;
  void openAp();
  void startSaved();
  void closeAp();
};
