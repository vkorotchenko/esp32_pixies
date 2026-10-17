#include "NetworkManager.h"
#include <esp_system.h>
#include <cstring>
void NetworkManager::openAp() {
  if(apOpen) return;
  WiFi.mode(WIFI_AP_STA);
  IPAddress ip(192,168,4,1);
  if(!WiFi.softAPConfig(ip,ip,IPAddress(255,255,255,0))||
      !WiFi.softAP(apSsid.c_str(),apPassword_,6,false,4)) {
    error="ap_start_failed"; return;
  }
  apOpen=true;
  dns_.start(53,"*",ip);
  // The unique WPA key is printed ONLY to the physically local USB console.
  printSetupLocally();
}
void NetworkManager::printSetupLocally() const {
  if(apOpen) Serial.printf("Protected setup AP: %s\nWPA key (local USB only): %s\nhttp://192.168.4.1\n",
                           apSsid.c_str(),apPassword_);
  else Serial.println("Setup AP is closed.");
}
void NetworkManager::closeAp() {
  if(!apOpen) return;
  dns_.stop(); WiFi.softAPdisconnect(true); WiFi.mode(WIFI_STA); apOpen=false;
}
void NetworkManager::startSaved() {
  // Abandon the current attempt even when there is no saved network to restore.
  // Otherwise a rejected candidate can remain associated and later close the AP.
  WiFi.disconnect(false,false);
  attempting_=timingConnection_=wasConnected_=retryPending_=false;
  attemptAt_=connectedAt_=retryAt_=0;
  if(mdns_) { MDNS.end(); mdns_=false; }
  if(!wifiSaved) { state="setup_ap"; openAp(); return; }
  WiFi.begin(saved_.ssid,saved_.password);
  attemptAt_=millis(); attempting_=true; state="connecting";
}
void NetworkManager::begin() {
  WiFi.persistent(false); WiFi.setAutoReconnect(false);
  const uint64_t mac=ESP.getEfuseMac();
  char suffix[13]; snprintf(suffix,sizeof suffix,"%012llx",static_cast<unsigned long long>(mac));
  hostname=String("pixies-")+suffix; apSsid=String("Pixies-")+suffix;
  constexpr char chars[]="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  for(size_t i=0;i<20;++i) apPassword_[i]=chars[esp_random()%(sizeof(chars)-1)];
  apPassword_[20]=0;
  WiFi.mode(WIFI_STA); WiFi.setHostname(hostname.c_str());
  wifiSaved=store_.loadWifi(saved_);
  if(wifiSaved) startSaved(); else { state="setup_ap"; openAp(); }
}
bool NetworkManager::connectCandidate(const WifiCredential& credential) {
  if(operationBusy()||!strcmp(scanState,"running")) return false;
  candidate_=credential; candidateBusy=true; candidateState="connecting"; error="";
  // Return the HTTP acceptance before disrupting its receiving STA interface.
  candidatePending_=true; actionAt_=millis(); return true;
}
void NetworkManager::tick(uint32_t now) {
  if(apOpen) dns_.processNextRequest();
  if(!strcmp(scanState,"running")) {
    const int result=WiFi.scanComplete();
    if(result>=0) scanState="complete";
    else if(result==WIFI_SCAN_FAILED||pixies::elapsed(now,scanStarted,15000)) {
      WiFi.scanDelete(); scanState="failed";
    }
  }
  if(resetPending_) {
    if(pixies::elapsed(now,actionAt_,1000)) {
      resetPending_=false;
      if(mdns_) { MDNS.end(); mdns_=false; }
      WiFi.disconnect(false,false); state="setup_ap";
    }
    return;
  }
  if(candidatePending_) {
    if(pixies::elapsed(now,actionAt_,1000)) {
      candidatePending_=false; timingConnection_=false;
      // Preserve the protected local route while checking another router.
      openAp();
      if(mdns_) { MDNS.end(); mdns_=false; }
      WiFi.disconnect(false,false); WiFi.begin(candidate_.ssid,candidate_.password);
      attemptAt_=millis(); attempting_=true; state="connecting"; wasConnected_=false;
    }
    return;
  }
  // Enforce the candidate deadline even if a late IP/association arrives now.
  if(candidateBusy&&attempting_&&
      pixies::connectionDecision(true,false,uint32_t(now-attemptAt_))==pixies::ConnectResult::FailedCandidate) {
    candidateBusy=false; candidateState="failed"; error="connection_failed";
    candidate_={}; openAp(); startSaved(); return;
  }
  const bool connected=WiFi.status()==WL_CONNECTED&&WiFi.localIP()!=IPAddress(0,0,0,0);
  if(connected&&!candidateBusy&&(!wifiSaved||WiFi.SSID()!=saved_.ssid)) {
    // Ignore/terminate a delayed connection event from an abandoned candidate.
    startSaved(); return;
  }
  if(connected) {
    if(!timingConnection_) { timingConnection_=true; connectedAt_=now; }
    // Obtain an address and remain associated for one second before committing.
    if(candidateBusy && pixies::elapsed(now,connectedAt_,1000)) {
      if(store_.saveWifi(candidate_)) {
        saved_=candidate_; wifiSaved=true; candidateState="succeeded"; error="";
        candidateBusy=false; candidate_={};
      } else {
        error="storage_failed"; candidateState="failed"; candidateBusy=false;
        candidate_={}; timingConnection_=false; startSaved(); return;
      }
    }
    if(!candidateBusy) {
      state="connected"; attempting_=false; retryPending_=false;
      if(!wasConnected_) {
        Serial.printf("Local controller: http://%s.local / http://%s\n",hostname.c_str(),WiFi.localIP().toString().c_str());
        wasConnected_=true;
      }
      if(!mdns_) { mdns_=MDNS.begin(hostname.c_str()); if(mdns_) MDNS.addService("http","tcp",80); }
      if(!holdAp&&pixies::elapsed(now,connectedAt_,2000)) closeAp();
    }
    return;
  }
  timingConnection_=false;
  if(wasConnected_) {
    wasConnected_=false;
    if(mdns_) { MDNS.end(); mdns_=false; }
    state="reconnecting"; startSaved(); return;
  }
  if(attempting_) {
    const auto result=pixies::connectionDecision(candidateBusy,false,uint32_t(now-attemptAt_));
    if(result==pixies::ConnectResult::FailedCandidate) {
      candidateBusy=false; candidateState="failed"; error="connection_failed";
      candidate_={}; openAp(); startSaved();
    } else if(result==pixies::ConnectResult::Fallback) {
      attempting_=false; state="fallback_ap"; openAp();
      retryAt_=now; retryPending_=true;
    }
  } else if(retryPending_&&pixies::elapsed(now,retryAt_,30000)) {
    retryPending_=false; startSaved();
  }
}
bool NetworkManager::startScan() {
  if(operationBusy()||attempting_||!strcmp(scanState,"running")) return false;
  WiFi.scanDelete();
  const int result=WiFi.scanNetworks(true,false,false,120);
  scanStarted=millis();
  scanState=result==WIFI_SCAN_FAILED ? "failed" : "running";
  return result!=WIFI_SCAN_FAILED;
}
bool NetworkManager::resetWifi() {
  if(operationBusy()) return false;
  if(!store_.resetWifi()) return false;
  wifiSaved=false; candidateBusy=false; attempting_=false; retryPending_=false; wasConnected_=false;
  saved_={}; candidate_={};
  WiFi.scanDelete(); scanState="idle";
  candidateState="idle"; error=""; openAp();
  // Credential erase is complete; defer STA disconnect until response is sent.
  resetPending_=true; actionAt_=millis(); return true;
}
bool NetworkManager::apPeer(const WiFiClient& client) const {
  return apOpen&&client.localIP()==IPAddress(192,168,4,1);
}
