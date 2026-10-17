#include <unity.h>
#include "../../src/SettingsStore.cpp"
#ifndef PIXIES_NETWORK_SOURCE
#define PIXIES_NETWORK_SOURCE "../../src/NetworkManager.cpp"
#endif
#include PIXIES_NETWORK_SOURCE
void setUp() { fake_nvs::reset(); fake_wifi::reset(); fake_mdns::active=false; }
void tearDown() {}
WifiCredential credential(const char* ssid) {
  WifiCredential result; strcpy(result.ssid,ssid); strcpy(result.password,"test-only-placeholder"); return result;
}
void advance(NetworkManager& network,uint32_t ms) {
  fake_wifi::now+=ms; network.tick(fake_wifi::now);
}
void startCandidate(NetworkManager& network) {
  TEST_ASSERT_TRUE(network.connectCandidate(credential("candidate-router")));
  const unsigned disconnects=fake_wifi::disconnects;
  advance(network,999); TEST_ASSERT_EQUAL(disconnects,fake_wifi::disconnects);
  advance(network,1);
  TEST_ASSERT_TRUE(network.candidateBusy);
  TEST_ASSERT_TRUE(network.apOpen); TEST_ASSERT_TRUE(fake_wifi::protectedAp);
  TEST_ASSERT_EQUAL_STRING("candidate-router",fake_wifi::requested.c_str());
}
void assertApOnly(NetworkManager& network,const char* error) {
  TEST_ASSERT_EQUAL_STRING("setup_ap",network.state);
  TEST_ASSERT_EQUAL_STRING("failed",network.candidateState);
  TEST_ASSERT_EQUAL_STRING(error,network.error);
  TEST_ASSERT_FALSE(network.candidateBusy); TEST_ASSERT_FALSE(network.operationBusy());
  TEST_ASSERT_FALSE(network.wifiSaved);
  TEST_ASSERT_TRUE(network.apOpen); TEST_ASSERT_TRUE(fake_wifi::ap); TEST_ASSERT_TRUE(fake_wifi::protectedAp);
  TEST_ASSERT_FALSE(fake_wifi::connected); TEST_ASSERT_FALSE(fake_mdns::active);
  TEST_ASSERT_EQUAL(0,fake_wifi::apCloses);
}
void first_persistence_failure_disconnects_and_keeps_protected_ap() {
  SettingsStore store; TEST_ASSERT_TRUE(store.begin());
  NetworkManager network(store); network.begin(); startCandidate(network);
  fake_wifi::connect("candidate-router"); advance(network,0);
  fake_nvs::failWrite=true;
  advance(network,999); TEST_ASSERT_TRUE(network.candidateBusy);
  const unsigned disconnects=fake_wifi::disconnects;
  advance(network,1);
  TEST_ASSERT_EQUAL(disconnects+1,fake_wifi::disconnects);
  assertApOnly(network,"storage_failed");
  WifiCredential loaded; TEST_ASSERT_FALSE(store.loadWifi(loaded));
  for(uint32_t wait:{1,2000,30000,60000}) { advance(network,wait); assertApOnly(network,"storage_failed"); }
  // Deliver a stale association/IP event AFTER rollback. It must be terminated,
  // not promoted to success or allowed to age into closing the protected AP.
  fake_wifi::connect("candidate-router"); advance(network,0); assertApOnly(network,"storage_failed");
  advance(network,5000); assertApOnly(network,"storage_failed");
}
void persistence_failure_restores_old_credentials_and_fresh_stability_timer() {
  SettingsStore store; store.begin(); TEST_ASSERT_TRUE(store.saveWifi(credential("saved-router")));
  NetworkManager network(store); network.begin();
  fake_wifi::connect("saved-router"); advance(network,0); advance(network,2000);
  TEST_ASSERT_EQUAL_STRING("connected",network.state);
  startCandidate(network);
  fake_wifi::connect("candidate-router"); advance(network,0);
  fake_nvs::failWrite=true; advance(network,1000);
  TEST_ASSERT_EQUAL_STRING("failed",network.candidateState);
  TEST_ASSERT_EQUAL_STRING("storage_failed",network.error);
  TEST_ASSERT_EQUAL_STRING("connecting",network.state);
  TEST_ASSERT_FALSE(fake_wifi::connected); TEST_ASSERT_FALSE(fake_mdns::active);
  TEST_ASSERT_TRUE(network.apOpen); TEST_ASSERT_TRUE(network.wifiSaved);
  TEST_ASSERT_EQUAL_STRING("saved-router",fake_wifi::requested.c_str());
  WifiCredential loaded; TEST_ASSERT_TRUE(store.loadWifi(loaded));
  TEST_ASSERT_EQUAL_STRING("saved-router",loaded.ssid);
  TEST_ASSERT_EQUAL_STRING("disconnect",fake_wifi::events[fake_wifi::events.size()-2].c_str());
  TEST_ASSERT_EQUAL_STRING("begin:saved-router",fake_wifi::events.back().c_str());
  // A delayed candidate event cannot masquerade as the restored saved network.
  fake_wifi::connect("candidate-router"); advance(network,0);
  TEST_ASSERT_FALSE(fake_wifi::connected); TEST_ASSERT_TRUE(network.apOpen);
  fake_wifi::connect("saved-router"); advance(network,0);
  advance(network,1999); TEST_ASSERT_TRUE(network.apOpen);
  advance(network,1); TEST_ASSERT_FALSE(network.apOpen);
  TEST_ASSERT_TRUE(fake_mdns::active);
  TEST_ASSERT_EQUAL_STRING("connected",network.state);
  TEST_ASSERT_EQUAL_STRING("storage_failed",network.error);
}
void candidate_timeout_and_late_connection_without_saved_network() {
  SettingsStore store; store.begin(); NetworkManager network(store); network.begin();
  startCandidate(network);
  advance(network,14999); TEST_ASSERT_TRUE(network.candidateBusy);
  // IP arrives on the deadline: it is too late even though status is connected.
  fake_wifi::connect("candidate-router"); advance(network,1);
  assertApOnly(network,"connection_failed");
  WifiCredential loaded; TEST_ASSERT_FALSE(store.loadWifi(loaded));
  fake_wifi::connect("candidate-router"); advance(network,0);
  assertApOnly(network,"connection_failed");
  advance(network,30000); assertApOnly(network,"connection_failed");
}
void candidate_timeout_restores_old_network_and_rejects_stale_candidate() {
  SettingsStore store; store.begin(); store.saveWifi(credential("saved-router"));
  NetworkManager network(store); network.begin(); startCandidate(network);
  advance(network,15000);
  TEST_ASSERT_FALSE(network.candidateBusy);
  TEST_ASSERT_EQUAL_STRING("connection_failed",network.error);
  TEST_ASSERT_EQUAL_STRING("saved-router",fake_wifi::requested.c_str());
  TEST_ASSERT_FALSE(fake_wifi::connected); TEST_ASSERT_TRUE(network.apOpen);
  fake_wifi::connect("candidate-router"); advance(network,0);
  TEST_ASSERT_FALSE(fake_wifi::connected);
  TEST_ASSERT_EQUAL_STRING("saved-router",fake_wifi::requested.c_str());
  fake_wifi::connect("saved-router"); advance(network,0); advance(network,2000);
  TEST_ASSERT_FALSE(network.apOpen); TEST_ASSERT_EQUAL_STRING("connected",network.state);
  WifiCredential loaded; TEST_ASSERT_TRUE(store.loadWifi(loaded));
  TEST_ASSERT_EQUAL_STRING("saved-router",loaded.ssid);
}
void successful_candidate_must_have_ip_stability_and_persistence() {
  for(bool prior:{false,true}) {
    fake_nvs::reset(); fake_wifi::reset(); fake_mdns::active=false;
    SettingsStore store; store.begin(); if(prior) store.saveWifi(credential("saved-router"));
    NetworkManager network(store); network.begin(); startCandidate(network);
    fake_wifi::connect("candidate-router",false); advance(network,2000);
    TEST_ASSERT_TRUE(network.candidateBusy); TEST_ASSERT_TRUE(network.apOpen);
    fake_wifi::connect("candidate-router"); advance(network,0);
    advance(network,999); TEST_ASSERT_TRUE(network.candidateBusy);
    WifiCredential loaded;
    if(prior) { TEST_ASSERT_TRUE(store.loadWifi(loaded)); TEST_ASSERT_EQUAL_STRING("saved-router",loaded.ssid); }
    else TEST_ASSERT_FALSE(store.loadWifi(loaded));
    advance(network,1);
    TEST_ASSERT_FALSE(network.candidateBusy); TEST_ASSERT_TRUE(network.wifiSaved);
    TEST_ASSERT_EQUAL_STRING("succeeded",network.candidateState);
    TEST_ASSERT_TRUE(store.loadWifi(loaded)); TEST_ASSERT_EQUAL_STRING("candidate-router",loaded.ssid);
    TEST_ASSERT_TRUE(network.apOpen);
    advance(network,999); TEST_ASSERT_TRUE(network.apOpen);
    advance(network,1); TEST_ASSERT_FALSE(network.apOpen);
    TEST_ASSERT_EQUAL_STRING("connected",network.state); TEST_ASSERT_EQUAL_STRING("",network.error);
  }
}
void reset_and_saved_network_fallback_remain_cooperative() {
  SettingsStore store; store.begin(); store.saveWifi(credential("saved-router"));
  NetworkManager network(store); network.begin();
  advance(network,15000); TEST_ASSERT_EQUAL_STRING("fallback_ap",network.state);
  TEST_ASSERT_TRUE(network.apOpen);
  advance(network,30000); TEST_ASSERT_EQUAL_STRING("connecting",network.state);
  fake_wifi::connect("saved-router"); advance(network,0); advance(network,2000);
  TEST_ASSERT_FALSE(network.apOpen);
  TEST_ASSERT_TRUE(network.resetWifi()); TEST_ASSERT_TRUE(network.apOpen);
  TEST_ASSERT_TRUE(fake_wifi::connected); // Response grace period is preserved.
  advance(network,999); TEST_ASSERT_TRUE(fake_wifi::connected);
  advance(network,1); TEST_ASSERT_FALSE(fake_wifi::connected);
  advance(network,5000); TEST_ASSERT_TRUE(network.apOpen);
  TEST_ASSERT_FALSE(network.wifiSaved); TEST_ASSERT_EQUAL_STRING("setup_ap",network.state);
}
int main() {
  UNITY_BEGIN();
  RUN_TEST(first_persistence_failure_disconnects_and_keeps_protected_ap);
  RUN_TEST(persistence_failure_restores_old_credentials_and_fresh_stability_timer);
  RUN_TEST(candidate_timeout_and_late_connection_without_saved_network);
  RUN_TEST(candidate_timeout_restores_old_network_and_rejects_stale_candidate);
  RUN_TEST(successful_candidate_must_have_ip_stability_and_persistence);
  RUN_TEST(reset_and_saved_network_fallback_remain_cooperative);
  return UNITY_END();
}
