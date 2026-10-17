#define PIXIES_CONTROL_TEST
#include <unity.h>
#include "../../src/SettingsStore.cpp"
#include "../../src/NetworkManager.cpp"
#include "../../src/OtaUpdater.cpp"
#include "../../src/DeviceControl.cpp"

// Crypto/session internals are outside this dispatcher fixture. The dispatcher,
// settings, persistence, radio state machine and OTA adapter are production code.
void Admin::begin() { configured=store_.loadAdmin(verifier_); }
bool Admin::claim(const String&) { configured=store_.saveAdmin(verifier_); return configured; }
void Admin::logout() {}
void Admin::expire(uint32_t) {}
void LedOutput::blank() {}
void setUp() { fake_nvs::reset(); fake_wifi::reset(); fake_mdns::active=false; fake_ota::reset(); }
void tearDown() {}
struct Fixture {
  SettingsStore store;
  pixies::SettingsState settings;
  LedOutput leds;
  NetworkManager network{store};
  DeviceControl control{store,settings,leds,network};
  DynamicJsonDocument args{pixies::kJsonCapacity},reply{pixies::kJsonCapacity};
  Fixture() { store.begin(); network.begin(); control.begin(); leds.ready=true; }
  int call(const char* op,const char* body="{}") {
    args.clear(); TEST_ASSERT_FALSE(bool(deserializeJson(args,body)));
    return control.execute(op,args.as<JsonVariantConst>(),reply);
  }
  int preview(const pixies::Settings& value,uint32_t revision) {
    args.clear(); args["baseRevision"]=revision;
    pixies::writeSettings(args.createNestedObject("config"),value);
    return control.execute("config.set",args.as<JsonVariantConst>(),reply);
  }
};
void common_defaults_and_sanitized_state() {
  Fixture f;
  TEST_ASSERT_EQUAL(200,f.call("config"));
  TEST_ASSERT_EQUAL_STRING("twinkle",f.reply["config"]["effect"].as<const char*>());
  TEST_ASSERT_EQUAL_STRING("builtin:light-blue",f.reply["config"]["paletteId"].as<const char*>());
  TEST_ASSERT_EQUAL(200,f.call("palettes")); TEST_ASSERT_EQUAL(3,f.reply["palettes"].size());
  TEST_ASSERT_EQUAL(200,f.call("status"));
  TEST_ASSERT_TRUE(f.reply["led"]["ready"].as<bool>());
  TEST_ASSERT_FALSE(f.reply["admin"]["claimAllowed"].as<bool>());
  TEST_ASSERT_FALSE(f.reply.containsKey("password"));
  TEST_ASSERT_FALSE(f.reply["network"].containsKey("password"));
  TEST_ASSERT_EQUAL(400,f.call("config","{\"extra\":1}"));
}
void preview_save_failure_and_real_reboot_record() {
  Fixture f; auto desired=f.settings.live;
  desired.on=false; desired.ledCount=333; desired.effect=pixies::Effect::Candle;
  strcpy(desired.paletteId,"christmas");
  TEST_ASSERT_EQUAL(200,f.preview(desired,1));
  TEST_ASSERT_TRUE(f.settings.dirty()); TEST_ASSERT_EQUAL(200,f.settings.activeCount);
  TEST_ASSERT_EQUAL(409,f.preview(desired,1));
  fake_nvs::failWrite=true;
  TEST_ASSERT_EQUAL(500,f.call("config.save","{\"baseRevision\":2}"));
  TEST_ASSERT_TRUE(f.settings.dirty());
  fake_nvs::failWrite=false;
  TEST_ASSERT_EQUAL(200,f.call("config.save","{\"baseRevision\":2}"));
  TEST_ASSERT_FALSE(f.settings.dirty());
  pixies::Settings loaded; TEST_ASSERT_TRUE(f.store.loadSettings(loaded));
  pixies::SettingsState reboot; reboot.restore(loaded);
  TEST_ASSERT_TRUE(pixies::equal(desired,reboot.live));
  TEST_ASSERT_EQUAL(333,reboot.activeCount); TEST_ASSERT_FALSE(reboot.live.on);
  desired.ledCount=1001;
  TEST_ASSERT_EQUAL(422,f.preview(desired,2));
  TEST_ASSERT_EQUAL(333,f.settings.live.ledCount);
}
void ota_busy_cannot_be_bypassed_over_ble() {
  Fixture f; f.control.ota.busy=true;
  TEST_ASSERT_EQUAL(409,f.preview(f.settings.live,1));
  TEST_ASSERT_EQUAL(409,f.call("config.save","{\"baseRevision\":1}"));
  TEST_ASSERT_EQUAL(409,f.call("wifi.scan"));
  TEST_ASSERT_EQUAL(409,f.call("wifi.connect","{\"ssid\":\"fixture\",\"password\":\"fixture-only-password\"}"));
  TEST_ASSERT_EQUAL(409,f.call("restart","{\"confirm\":\"restart\"}"));
  TEST_ASSERT_EQUAL(200,f.call("status"));
  TEST_ASSERT_TRUE(f.reply["update"]["busy"].as<bool>());
}
void network_validation_and_failed_persistence_keep_setup() {
  Fixture f;
  TEST_ASSERT_EQUAL(422,f.call("wifi.connect","{\"ssid\":\"fixture\",\"password\":\"short\"}"));
  TEST_ASSERT_FALSE(f.network.candidateBusy);
  TEST_ASSERT_EQUAL(400,f.call("wifi.connect","{\"ssid\":\"fixture\",\"password\":\"fixture-only-password\",\"extra\":1}"));
  TEST_ASSERT_EQUAL(202,f.call("wifi.connect","{\"ssid\":\"fixture\",\"password\":\"fixture-only-password\"}"));
  fake_wifi::now+=1000; f.network.tick(fake_wifi::now);
  fake_wifi::connect("fixture"); f.network.tick(fake_wifi::now);
  fake_nvs::failWrite=true;
  fake_wifi::now+=1000; f.network.tick(fake_wifi::now);
  TEST_ASSERT_FALSE(fake_wifi::connected); TEST_ASSERT_TRUE(f.network.apOpen);
  TEST_ASSERT_EQUAL_STRING("storage_failed",f.network.error);
  TEST_ASSERT_EQUAL(200,f.call("status"));
  std::string text; serializeJson(f.reply,text);
  TEST_ASSERT_EQUAL(std::string::npos,text.find("fixture-only-password"));
}
void restart_and_factory_reset_clear_bonds_only_when_requested() {
  Fixture f; unsigned cleared=0;
  f.control.clearBonds=[&](){ ++cleared; return false; };
  TEST_ASSERT_EQUAL(422,f.call("factory-reset","{\"confirm\":\"wrong\"}")); TEST_ASSERT_EQUAL(0,cleared);
  TEST_ASSERT_EQUAL(500,f.call("factory-reset","{\"confirm\":\"factory-reset\"}")); TEST_ASSERT_EQUAL(1,cleared);
  TEST_ASSERT_FALSE(f.control.restarting);
  f.control.clearBonds=[&](){ ++cleared; return true; };
  TEST_ASSERT_EQUAL(202,f.call("factory-reset","{\"confirm\":\"factory-reset\"}"));
  TEST_ASSERT_EQUAL(2,cleared); TEST_ASSERT_TRUE(f.control.restarting);
  TEST_ASSERT_TRUE(f.control.tick(fake_wifi::now+999));
  TEST_ASSERT_FALSE(f.control.tick(fake_wifi::now+1000)); TEST_ASSERT_EQUAL(1,fake_wifi::restarts);
}
void optional_website_claim_requires_valid_data_and_checked_storage() {
  Fixture f;
  TEST_ASSERT_EQUAL(422,f.call("admin.claim","{\"password\":\"short\"}"));
  fake_nvs::failWrite=true;
  TEST_ASSERT_EQUAL(500,f.call("admin.claim","{\"password\":\"fixture-only-password\"}"));
  TEST_ASSERT_FALSE(f.control.admin.configured);
  fake_nvs::failWrite=false;
  TEST_ASSERT_EQUAL(200,f.call("admin.claim","{\"password\":\"fixture-only-password\"}"));
  TEST_ASSERT_TRUE(f.reply["configured"].as<bool>());
  TEST_ASSERT_EQUAL(409,f.call("admin.claim","{\"password\":\"fixture-only-password\"}"));
}
int main() {
  UNITY_BEGIN(); RUN_TEST(common_defaults_and_sanitized_state);
  RUN_TEST(preview_save_failure_and_real_reboot_record);
  RUN_TEST(ota_busy_cannot_be_bypassed_over_ble);
  RUN_TEST(network_validation_and_failed_persistence_keep_setup);
  RUN_TEST(restart_and_factory_reset_clear_bonds_only_when_requested);
  RUN_TEST(optional_website_claim_requires_valid_data_and_checked_storage);
  return UNITY_END();
}
