#define PIXIES_CONTROL_TEST
#include <unity.h>
#include "../../src/SettingsStore.cpp"
#include "../../src/NetworkManager.cpp"
#include "../../src/OtaUpdater.cpp"
#include "../../src/DeviceControl.cpp"
#include "../../src/BleControl.cpp"

// Crypto/session internals are outside this dispatcher fixture. The dispatcher,
// settings, persistence, radio state machine and OTA adapter are production code.
void Admin::begin() { configured=store_.loadAdmin(verifier_); }
bool Admin::claim(const String&) { configured=store_.saveAdmin(verifier_); return configured; }
void Admin::logout() {}
void Admin::expire(uint32_t) {}
void LedOutput::blank() {}
void setUp() {
  fake_nvs::reset(); fake_wifi::reset(); fake_mdns::active=false; fake_ota::reset();
  fake_rtos::reset(); NimBLEDevice::resetForTest();
}
void tearDown() { fake_rtos::reset(); NimBLEDevice::resetForTest(); }
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
struct BleFixture:Fixture {
  BleControl bluetooth{control};
  NimBLEConnInfo peer;
  NimBLEServer& server=NimBLEDevice::server;
  BleFixture() {
    TEST_ASSERT_TRUE(bluetooth.begin("Pixies-test"));
    server.callbacks->onConnect(&server,peer);
  }
  void authenticate(bool encrypted,bool bonded) {
    peer.encrypted=encrypted; peer.bonded=bonded;
    server.callbacks->onAuthenticationComplete(peer);
  }
  void write(bool encrypted,bool bonded) {
    DynamicJsonDocument request(pixies::kJsonCapacity);
    request["op"]="config.set";
    auto args=request.createNestedObject("args"); args["baseRevision"]=settings.revision;
    auto desired=settings.live; desired.brightness=42;
    pixies::writeSettings(args.createNestedObject("config"),desired);
    std::string json; serializeJson(request,json);
    NimBLEConnInfo writer{peer.handle,encrypted,bonded};
    uint8_t frame[pixies::ble::kMaxPacket]; size_t offset=0;
    while(offset<json.size()) {
      const auto n=pixies::ble::packet(reinterpret_cast<const uint8_t*>(json.data()),
        json.size(),17,false,offset,frame,sizeof frame);
      server.service.rx.setValue(frame,n);
      server.service.rx.callbacks->onWrite(&server.service.rx,writer);
      offset+=n-pixies::ble::kHeader;
    }
  }
};
void encrypted_writes_wait_for_bonding_instead_of_disconnecting_android() {
  BleFixture f;
  f.write(true,false);
  TEST_ASSERT_EQUAL(0,f.server.disconnected.size());
  f.bluetooth.tick(100);
  TEST_ASSERT_EQUAL(25,f.settings.live.brightness);
  TEST_ASSERT_TRUE(f.server.service.tx.notifications.empty());
  f.authenticate(true,true);
  f.bluetooth.tick(101);
  TEST_ASSERT_EQUAL(42,f.settings.live.brightness);
  TEST_ASSERT_EQUAL(2,f.settings.revision);
  TEST_ASSERT_EQUAL(0,f.server.disconnected.size());
  f.server.service.tx.callbacks->onSubscribe(&f.server.service.tx,f.peer,1);
  for(uint32_t now=110;now<200;now+=10) f.bluetooth.tick(now);
  TEST_ASSERT_FALSE(f.server.service.tx.notifications.empty());
}
void pairing_failure_never_executes_queued_commands() {
  for(bool encrypted:{false,true}) {
    BleFixture f; f.write(true,false);
    f.authenticate(encrypted,false);
    TEST_ASSERT_EQUAL(1,f.server.disconnected.size());
    f.bluetooth.tick(100);
    TEST_ASSERT_EQUAL(25,f.settings.live.brightness);
    TEST_ASSERT_EQUAL(1,f.settings.revision);
    NimBLEDevice::resetForTest();
  }
}
void unencrypted_writes_are_still_rejected() {
  BleFixture f; f.write(false,false);
  TEST_ASSERT_FALSE(f.server.disconnected.empty());
  f.authenticate(true,true); f.bluetooth.tick(100);
  TEST_ASSERT_EQUAL(25,f.settings.live.brightness);
}
void reconnect_cannot_replay_a_previous_pairing_session() {
  BleFixture f; f.write(true,false);
  f.server.callbacks->onDisconnect(&f.server,f.peer,0);
  f.server.callbacks->onConnect(&f.server,f.peer);
  f.authenticate(true,true); f.bluetooth.tick(100);
  TEST_ASSERT_EQUAL(25,f.settings.live.brightness);
  TEST_ASSERT_TRUE(f.server.service.tx.notifications.empty());
  f.write(true,true); f.bluetooth.tick(101);
  TEST_ASSERT_EQUAL(42,f.settings.live.brightness);
}
int main() {
  UNITY_BEGIN(); RUN_TEST(common_defaults_and_sanitized_state);
  RUN_TEST(preview_save_failure_and_real_reboot_record);
  RUN_TEST(ota_busy_cannot_be_bypassed_over_ble);
  RUN_TEST(network_validation_and_failed_persistence_keep_setup);
  RUN_TEST(restart_and_factory_reset_clear_bonds_only_when_requested);
  RUN_TEST(optional_website_claim_requires_valid_data_and_checked_storage);
  RUN_TEST(encrypted_writes_wait_for_bonding_instead_of_disconnecting_android);
  RUN_TEST(pairing_failure_never_executes_queued_commands);
  RUN_TEST(unencrypted_writes_are_still_rejected);
  RUN_TEST(reconnect_cannot_replay_a_previous_pairing_session);
  return UNITY_END();
}
