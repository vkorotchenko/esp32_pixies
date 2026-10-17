#include <unity.h>
#include "../../src/SettingsStore.cpp"
void setUp() { fake_nvs::reset(); }
void tearDown() {}
void actual_settings_adapter() {
  SettingsStore store; TEST_ASSERT_TRUE(store.begin());
  pixies::Settings s;
  TEST_ASSERT_FALSE(store.loadSettings(s)); TEST_ASSERT_EQUAL_STRING("missing",store.settingsRecovery);
  s.on=false; s.ledCount=1000;
  TEST_ASSERT_TRUE(store.saveSettings(s));
  pixies::Settings read;
  TEST_ASSERT_TRUE(store.loadSettings(read)); TEST_ASSERT_TRUE(pixies::equal(s,read));
  auto& record=fake_nvs::records["px-settings/record"]; record.back()^=1;
  TEST_ASSERT_FALSE(store.loadSettings(read)); TEST_ASSERT_EQUAL_STRING("invalid_record",store.settingsRecovery);
  TEST_ASSERT_TRUE(store.saveSettings(s));
  fake_nvs::failWrite=true; TEST_ASSERT_FALSE(store.saveSettings(pixies::Settings{}));
  fake_nvs::failWrite=false;
  TEST_ASSERT_TRUE(store.loadSettings(read)); TEST_ASSERT_FALSE(read.on); TEST_ASSERT_EQUAL(1000,read.ledCount);
  fake_nvs::failRead=true; TEST_ASSERT_FALSE(store.saveSettings(s));
}
void separated_credentials_and_reset() {
  SettingsStore store; store.begin();
  WifiCredential wifi; strcpy(wifi.ssid,"test-router"); strcpy(wifi.password,"test-only-placeholder");
  AdminVerifier admin;
  admin.salt[0]=3; admin.hash[0]=7;
  TEST_ASSERT_TRUE(store.saveWifi(wifi)); TEST_ASSERT_TRUE(store.saveAdmin(admin));
  TEST_ASSERT_TRUE(store.saveSettings(pixies::Settings{}));
  WifiCredential loaded; AdminVerifier loadedAdmin;
  TEST_ASSERT_TRUE(store.loadWifi(loaded)); TEST_ASSERT_EQUAL_STRING(wifi.ssid,loaded.ssid);
  TEST_ASSERT_TRUE(store.loadAdmin(loadedAdmin)); TEST_ASSERT_EQUAL(7,loadedAdmin.hash[0]);
  TEST_ASSERT_TRUE(store.resetWifi()); TEST_ASSERT_FALSE(store.loadWifi(loaded));
  TEST_ASSERT_TRUE(store.loadAdmin(loadedAdmin));
  pixies::Settings s; TEST_ASSERT_TRUE(store.loadSettings(s));
  fake_nvs::failErase=true; TEST_ASSERT_FALSE(store.factoryReset());
  fake_nvs::failErase=false; TEST_ASSERT_TRUE(store.factoryReset());
  TEST_ASSERT_FALSE(store.loadAdmin(loadedAdmin)); TEST_ASSERT_FALSE(store.loadSettings(s));
}
void unavailable_storage() {
  fake_nvs::failBegin=true; SettingsStore store;
  TEST_ASSERT_FALSE(store.begin()); TEST_ASSERT_FALSE(store.saveSettings(pixies::Settings{}));
  TEST_ASSERT_FALSE(store.resetWifi()); TEST_ASSERT_FALSE(store.factoryReset());
  TEST_ASSERT_EQUAL_STRING("storage_unavailable",store.powerRecovery);
}
void independent_checked_power_record() {
  SettingsStore unopened; pixies::PowerSettings unknown;
  TEST_ASSERT_FALSE(unopened.loadPower(unknown));
  TEST_ASSERT_EQUAL_STRING("storage_unavailable",unopened.powerRecovery);
  SettingsStore store; TEST_ASSERT_TRUE(store.begin());
  pixies::Settings lights; lights.ledCount=333; lights.on=false;
  TEST_ASSERT_TRUE(store.saveSettings(lights));
  pixies::PowerSettings power;
  TEST_ASSERT_FALSE(store.loadPower(power)); TEST_ASSERT_EQUAL_STRING("missing",store.powerRecovery);
  power={20,600}; TEST_ASSERT_TRUE(store.savePower(power));
  pixies::PowerSettings restored; TEST_ASSERT_TRUE(store.loadPower(restored));
  TEST_ASSERT_EQUAL(20,restored.supplyWatts); TEST_ASSERT_EQUAL(600,restored.ledMilliWatts);
  TEST_ASSERT_TRUE(store.saveSettings(pixies::Settings{}));
  TEST_ASSERT_TRUE(store.loadPower(restored)); TEST_ASSERT_EQUAL(20,restored.supplyWatts);
  fake_nvs::failWrite=true; TEST_ASSERT_FALSE(store.savePower({60,300}));
  fake_nvs::failWrite=false;
  TEST_ASSERT_TRUE(store.loadPower(restored)); TEST_ASSERT_EQUAL(20,restored.supplyWatts);
  fake_nvs::records["px-settings/power"].back()^=1;
  TEST_ASSERT_FALSE(store.loadPower(restored)); TEST_ASSERT_EQUAL_STRING("invalid_record",store.powerRecovery);
  pixies::Settings intact; TEST_ASSERT_TRUE(store.loadSettings(intact));
  TEST_ASSERT_TRUE(store.savePower(power));
  TEST_ASSERT_TRUE(store.factoryReset()); TEST_ASSERT_FALSE(store.loadPower(restored));
  TEST_ASSERT_EQUAL_STRING("missing",store.powerRecovery);
}
int main() {
  UNITY_BEGIN(); RUN_TEST(actual_settings_adapter); RUN_TEST(separated_credentials_and_reset);
  RUN_TEST(unavailable_storage); RUN_TEST(independent_checked_power_record); return UNITY_END();
}
