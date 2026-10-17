#define PIXIES_CONTROL_TEST
#include <unity.h>
#include <type_traits>
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
char otaBegin[256]{};
void setUp() {
  fake_nvs::reset(); fake_wifi::reset(); fake_mdns::active=false; fake_ota::reset();
  fake_rtos::reset(); NimBLEDevice::resetForTest();
  uint32_t version[3]{};
  TEST_ASSERT_TRUE(pixies::versionParts(PIXIES_VERSION,version));
  snprintf(otaBegin,sizeof otaBegin,
    "{\"size\":1024,\"sha256\":\"0000000000000000000000000000000000000000000000000000000000000000\",\"version\":\"%u.0.0\",\"target\":\"esp32s3_n16r8\"}",
    unsigned(version[0]+1));
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
  TEST_ASSERT_EQUAL_STRING("WS2811",f.reply["led"]["protocol"].as<const char*>());
  TEST_ASSERT_EQUAL_STRING("RGB",f.reply["led"]["order"].as<const char*>());
  TEST_ASSERT_TRUE((std::is_base_of<NeoPixelBus<NeoRgbFeature,NeoEsp32Rmt0Ws2811Method>,PixiesBus>::value));
  TEST_ASSERT_FALSE(f.reply["admin"]["claimAllowed"].as<bool>());
  TEST_ASSERT_FALSE(f.reply.containsKey("password"));
  TEST_ASSERT_FALSE(f.reply["network"].containsKey("password"));
  TEST_ASSERT_EQUAL(400,f.call("config","{\"extra\":1}"));
}
void led_diagnostics_reflect_active_hardware_and_live_settings() {
  Fixture f; auto desired=f.settings.live;
  desired.ledCount=333; desired.brightness=10; desired.effect=pixies::Effect::Steady;
  TEST_ASSERT_EQUAL(200,f.preview(desired,1));
  f.leds.frames=123; f.control.ota.busy=true;
  StaticJsonDocument<1024> diagnostics;
  f.control.ledStatus(diagnostics.to<JsonObject>());
  TEST_ASSERT_FALSE(diagnostics.overflowed());
  TEST_ASSERT_TRUE(diagnostics["ready"].as<bool>());
  TEST_ASSERT_EQUAL(4,diagnostics["gpio"].as<unsigned>());
  TEST_ASSERT_EQUAL(123,diagnostics["frames"].as<unsigned>());
  TEST_ASSERT_EQUAL(200,diagnostics["activeLedCount"].as<unsigned>());
  TEST_ASSERT_EQUAL(333,diagnostics["requestedLedCount"].as<unsigned>());
  TEST_ASSERT_TRUE(diagnostics["on"].as<bool>());
  TEST_ASSERT_EQUAL(10,diagnostics["brightness"].as<unsigned>());
  TEST_ASSERT_EQUAL_STRING("steady",diagnostics["effect"].as<const char*>());
  TEST_ASSERT_EQUAL_STRING("builtin:light-blue",diagnostics["paletteId"].as<const char*>());
  TEST_ASSERT_TRUE(diagnostics["pausedForUpdate"].as<bool>());
  TEST_ASSERT_FALSE(diagnostics.containsKey("network"));
  TEST_ASSERT_FALSE(diagnostics.containsKey("admin"));
  TEST_ASSERT_FALSE(diagnostics.containsKey("password"));
  TEST_ASSERT_EQUAL(200,f.call("status"));
  std::string direct,nested;
  serializeJson(diagnostics,direct); serializeJson(f.reply["led"],nested);
  TEST_ASSERT_EQUAL_STRING(direct.c_str(),nested.c_str());
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
  TEST_ASSERT_EQUAL(409,f.call("power.save","{\"baseRevision\":1,\"power\":{\"supplyWatts\":20,\"ledMilliWatts\":300}}"));
  TEST_ASSERT_EQUAL(409,f.call("wifi.scan"));
  TEST_ASSERT_EQUAL(409,f.call("wifi.connect","{\"ssid\":\"fixture\",\"password\":\"fixture-only-password\"}"));
  TEST_ASSERT_EQUAL(409,f.call("restart","{\"confirm\":\"restart\"}"));
  TEST_ASSERT_EQUAL(200,f.call("status"));
  TEST_ASSERT_TRUE(f.reply["update"]["busy"].as<bool>());
}
void power_saves_are_checked_independent_and_do_not_restart() {
  Fixture f;
  TEST_ASSERT_TRUE(f.leds.powerReady); TEST_ASSERT_EQUAL(9000,f.leds.powerBudgetMa());
  TEST_ASSERT_EQUAL(422,f.call("power.save","{\"baseRevision\":1,\"power\":{\"supplyWatts\":0,\"ledMilliWatts\":300}}"));
  TEST_ASSERT_EQUAL(400,f.call("power.save","{\"baseRevision\":1,\"power\":{\"supplyWatts\":20,\"ledMilliWatts\":300},\"extra\":true}"));
  TEST_ASSERT_EQUAL(200,f.call("power.save","{\"baseRevision\":1,\"power\":{\"supplyWatts\":20,\"ledMilliWatts\":600}}"));
  TEST_ASSERT_EQUAL(3200,f.leds.powerBudgetMa()); TEST_ASSERT_EQUAL(600,f.leds.powerSettings.ledMilliWatts);
  TEST_ASSERT_EQUAL(2,f.reply["power"]["revision"].as<unsigned>());
  TEST_ASSERT_FALSE(f.control.restarting); TEST_ASSERT_FALSE(f.settings.dirty());
  TEST_ASSERT_EQUAL(1,f.settings.revision); TEST_ASSERT_EQUAL(200,f.settings.activeCount);
  TEST_ASSERT_EQUAL(409,f.call("power.save","{\"baseRevision\":1,\"power\":{\"supplyWatts\":60,\"ledMilliWatts\":300}}"));
  fake_nvs::failWrite=true;
  TEST_ASSERT_EQUAL(500,f.call("power.save","{\"baseRevision\":2,\"power\":{\"supplyWatts\":60,\"ledMilliWatts\":300}}"));
  TEST_ASSERT_EQUAL(3200,f.leds.powerBudgetMa()); TEST_ASSERT_EQUAL(2,f.control.powerRevision);
  fake_nvs::failWrite=false;
  TEST_ASSERT_EQUAL(200,f.call("config.save","{\"baseRevision\":1}"));
  Fixture reboot;
  TEST_ASSERT_EQUAL(3200,reboot.leds.powerBudgetMa()); TEST_ASSERT_EQUAL(600,reboot.leds.powerSettings.ledMilliWatts);
  fake_nvs::records["px-settings/power"].back()^=1;
  Fixture corrupt;
  TEST_ASSERT_FALSE(corrupt.leds.powerReady); TEST_ASSERT_EQUAL(0,corrupt.leds.powerBudgetMa());
  TEST_ASSERT_EQUAL(200,corrupt.call("status"));
  TEST_ASSERT_EQUAL_STRING("invalid_record",corrupt.reply["power"]["recovery"].as<const char*>());
  TEST_ASSERT_EQUAL(200,corrupt.call("power.save","{\"baseRevision\":1,\"power\":{\"supplyWatts\":10,\"ledMilliWatts\":300}}"));
  TEST_ASSERT_TRUE(corrupt.leds.powerReady); TEST_ASSERT_EQUAL(1600,corrupt.leds.powerBudgetMa());
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
  TEST_ASSERT_TRUE(f.control.tick(fake_wifi::now-1));
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
  uint32_t time=100;
  BleFixture() {
    TEST_ASSERT_TRUE(bluetooth.begin(PIXIES_BLE_NAME));
    server.callbacks->onConnect(&server,peer);
  }
  void authenticate(bool encrypted,bool bonded) {
    peer.encrypted=encrypted; peer.bonded=bonded;
    server.callbacks->onAuthenticationComplete(peer);
  }
  int command(const char* op,const char* body="{}",bool deferredRestart=false) {
    DynamicJsonDocument request(pixies::kJsonCapacity);
    request["op"]=op;
    TEST_ASSERT_FALSE(bool(deserializeJson(args,body)));
    request["args"]=args.as<JsonVariantConst>();
    std::string json; serializeJson(request,json);
    server.service.tx.notifications.clear();
    server.service.tx.callbacks->onSubscribe(&server.service.tx,peer,1);
    uint8_t bytes[pixies::ble::kMaxPacket]; size_t offset=0;
    while(offset<json.size()) {
      const size_t n=pixies::ble::packet(reinterpret_cast<const uint8_t*>(json.data()),
        json.size(),25,false,offset,bytes,sizeof bytes);
      server.service.rx.setValue(bytes,n); server.service.rx.callbacks->onWrite(&server.service.rx,peer);
      bluetooth.tick(time+=10); offset+=n-pixies::ble::kHeader;
    }
    pixies::ble::Receiver response;
    if(deferredRestart) {
      TEST_ASSERT_EQUAL(1,fake_ota::selects);
      TEST_ASSERT_FALSE(control.restarting);
    }
    size_t seen=0;
    for(unsigned step=0;step<100;++step) {
      bluetooth.tick(time+=10);
      while(seen<server.service.tx.notifications.size()) {
        const auto& frame=server.service.tx.notifications[seen++];
        if(response.push(frame.data(),frame.size(),time,true)==pixies::ble::Result::Complete) {
          if(deferredRestart) TEST_ASSERT_TRUE(control.restarting);
          TEST_ASSERT_FALSE(bool(deserializeJson(reply,response.data(),response.size())));
          return reply["status"].as<int>();
        }
      }
      if(deferredRestart) TEST_ASSERT_FALSE(control.restarting);
    }
    TEST_FAIL_MESSAGE("BLE response did not complete"); return 0;
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
void bluetooth_name_is_pixies_without_changing_network_identity() {
  BleFixture f;
  TEST_ASSERT_EQUAL_STRING("pixies",NimBLEDevice::name.c_str());
  TEST_ASSERT_EQUAL_STRING("pixies",NimBLEDevice::advertising.scanName.c_str());
  TEST_ASSERT_EQUAL(0,strncmp(f.network.apSsid.c_str(),"Pixies-",7));
  TEST_ASSERT_EQUAL(0,strncmp(f.network.hostname.c_str(),"pixies-",7));
}
void ordinary_save_never_restarts_and_only_count_changes_wait_for_restart() {
  Fixture f; const auto boot=f.control.bootId;
  auto desired=f.settings.live; desired.brightness=31; desired.effect=pixies::Effect::Steady;
  TEST_ASSERT_EQUAL(200,f.preview(desired,1));
  TEST_ASSERT_EQUAL(200,f.call("config.save","{\"baseRevision\":2}"));
  TEST_ASSERT_FALSE(f.reply["restartRequired"].as<bool>());
  TEST_ASSERT_FALSE(f.reply["savedRestartRequired"].as<bool>());
  TEST_ASSERT_FALSE(f.control.restarting);
  TEST_ASSERT_TRUE(f.control.tick(fake_wifi::now+2000));
  TEST_ASSERT_EQUAL(0,fake_wifi::restarts);
  TEST_ASSERT_EQUAL_STRING(boot.c_str(),f.control.bootId.c_str());
  TEST_ASSERT_TRUE(pixies::equal(desired,f.settings.live));
  desired.ledCount=333;
  TEST_ASSERT_EQUAL(200,f.preview(desired,2));
  TEST_ASSERT_EQUAL(200,f.call("config.save","{\"baseRevision\":3}"));
  TEST_ASSERT_TRUE(f.reply["savedRestartRequired"].as<bool>());
  TEST_ASSERT_EQUAL(200,f.settings.activeCount);
  TEST_ASSERT_FALSE(f.control.restarting);
  TEST_ASSERT_EQUAL(0,fake_wifi::restarts);
}
void ble_ota_complete_image_drains_reply_before_restart_and_preserves_settings() {
  BleFixture f; f.authenticate(true,true);
  auto saved=f.settings.live; saved.brightness=17;
  TEST_ASSERT_EQUAL(200,f.preview(saved,1));
  TEST_ASSERT_EQUAL(200,f.call("config.save","{\"baseRevision\":2}"));
  uint8_t image[1024]{};
  esp_image_header_t header{}; header.magic=0xe9; header.segment_count=5;
  header.spi_size=4; header.chip_id=9; header.hash_appended=1;
  esp_app_desc_t app{}; app.magic_word=0xabcd5432;
  memcpy(image,&header,sizeof header); memcpy(image+32,&app,sizeof app);
  mbedtls_sha256_context hash; mbedtls_sha256_init(&hash);
  uint8_t digest[32]; char checksum[65]{};
  TEST_ASSERT_EQUAL(0,mbedtls_sha256_starts_ret(&hash,0));
  TEST_ASSERT_EQUAL(0,mbedtls_sha256_update_ret(&hash,image,sizeof image));
  TEST_ASSERT_EQUAL(0,mbedtls_sha256_finish_ret(&hash,digest));
  mbedtls_sha256_free(&hash);
  for(size_t i=0;i<32;++i) snprintf(checksum+2*i,3,"%02x",digest[i]);
  DynamicJsonDocument begin(512);
  TEST_ASSERT_FALSE(bool(deserializeJson(begin,otaBegin))); begin["sha256"]=checksum;
  std::string body; serializeJson(begin,body);
  TEST_ASSERT_EQUAL(200,f.command("ota.begin",body.c_str()));
  const std::string id=f.reply["body"]["transferId"].as<const char*>();
  const char* alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  std::string encoded;
  for(size_t i=0;i<sizeof image;i+=3) {
    const uint32_t value=(uint32_t(image[i])<<16)|
      (i+1<sizeof image?uint32_t(image[i+1])<<8:0)|(i+2<sizeof image?image[i+2]:0);
    encoded+=alphabet[(value>>18)&63]; encoded+=alphabet[(value>>12)&63];
    encoded+=i+1<sizeof image?alphabet[(value>>6)&63]:'=';
    encoded+=i+2<sizeof image?alphabet[value&63]:'=';
  }
  body="{\"transferId\":\""+id+"\",\"offset\":0,\"data\":\""+encoded+"\"}";
  TEST_ASSERT_EQUAL(200,f.command("ota.chunk",body.c_str()));
  TEST_ASSERT_EQUAL(1024,f.reply["body"]["offset"].as<unsigned>());
  TEST_ASSERT_EQUAL(0,fake_ota::selects);
  body="{\"transferId\":\""+id+"\"}";
  TEST_ASSERT_EQUAL(202,f.command("ota.finish",body.c_str(),true));
  TEST_ASSERT_EQUAL_STRING("restarting",f.reply["body"]["state"].as<const char*>());
  TEST_ASSERT_EQUAL(1024,f.reply["body"]["receivedBytes"].as<unsigned>());
  TEST_ASSERT_EQUAL(0,fake_wifi::restarts);
  TEST_ASSERT_TRUE(f.control.tick(fake_wifi::now-1));
  TEST_ASSERT_TRUE(f.control.tick(fake_wifi::now+999));
  TEST_ASSERT_FALSE(f.control.tick(fake_wifi::now+1000));
  TEST_ASSERT_EQUAL(1,fake_wifi::restarts);
  pixies::Settings loaded; TEST_ASSERT_TRUE(f.store.loadSettings(loaded));
  TEST_ASSERT_TRUE(pixies::equal(saved,loaded));
}
void ble_ota_disconnect_timeout_and_stale_sessions_abort() {
  BleFixture f; f.authenticate(true,true);
  TEST_ASSERT_EQUAL(200,f.command("ota.begin",otaBegin));
  const std::string id=f.reply["body"]["transferId"].as<const char*>();
  TEST_ASSERT_TRUE(f.control.ota.owns(OtaOwner::Ble));
  TEST_ASSERT_FALSE(f.control.ota.abort()); TEST_ASSERT_TRUE(f.control.ota.busy);
  f.server.callbacks->onDisconnect(&f.server,f.peer,0); f.bluetooth.tick(f.time+=10);
  TEST_ASSERT_FALSE(f.control.ota.busy); TEST_ASSERT_EQUAL_STRING("disconnected",f.control.ota.error);
  f.server.callbacks->onConnect(&f.server,f.peer); f.authenticate(true,true);
  TEST_ASSERT_EQUAL(409,f.command("ota.finish",("{\"transferId\":\""+id+"\"}").c_str()));
  TEST_ASSERT_EQUAL(200,f.command("ota.begin",otaBegin));
  f.bluetooth.tick(f.time+60001);
  TEST_ASSERT_FALSE(f.control.ota.busy); TEST_ASSERT_EQUAL_STRING("transfer_timeout",f.control.ota.error);
  TEST_ASSERT_EQUAL(0,fake_ota::selects); TEST_ASSERT_EQUAL(1,f.settings.revision);
}
void ble_ota_validates_offsets_and_rejects_truncation() {
  BleFixture f; f.authenticate(true,true);
  TEST_ASSERT_EQUAL(200,f.command("ota.begin",otaBegin));
  std::string id=f.reply["body"]["transferId"].as<const char*>();
  TEST_ASSERT_EQUAL(200,f.command("ota.chunk",("{\"transferId\":\""+id+"\",\"offset\":0,\"data\":\"AAAA\"}").c_str()));
  TEST_ASSERT_EQUAL(3,f.reply["body"]["offset"].as<unsigned>());
  TEST_ASSERT_EQUAL(409,f.preview(f.settings.live,1));
  TEST_ASSERT_EQUAL(409,f.command("ota.chunk",("{\"transferId\":\""+id+"\",\"offset\":0,\"data\":\"AAAA\"}").c_str()));
  TEST_ASSERT_FALSE(f.control.ota.busy);
  TEST_ASSERT_EQUAL(200,f.command("ota.begin",otaBegin));
  id=f.reply["body"]["transferId"].as<const char*>();
  TEST_ASSERT_EQUAL(422,f.command("ota.finish",("{\"transferId\":\""+id+"\"}").c_str()));
  TEST_ASSERT_FALSE(f.control.ota.busy); TEST_ASSERT_EQUAL(0,fake_ota::selects);
  TEST_ASSERT_EQUAL(200,f.command("ota.begin",otaBegin));
  id=f.reply["body"]["transferId"].as<const char*>();
  TEST_ASSERT_EQUAL(200,f.command("ota.abort",("{\"transferId\":\""+id+"\"}").c_str()));
  TEST_ASSERT_FALSE(f.control.ota.busy); TEST_ASSERT_FALSE(f.control.restarting);
}
void ble_ota_rejects_wrong_target_versions_and_http_conflicts() {
  BleFixture f; f.authenticate(true,true);
  for(const char* body:{
    "{\"size\":1024,\"sha256\":\"bad\",\"version\":\"0.3.1\",\"target\":\"esp32s3_n16r8\"}",
    "{\"size\":1024,\"sha256\":\"bad\",\"version\":\"0.3.0\",\"target\":\"esp32s3_n16r8\"}",
    "{\"size\":1024,\"sha256\":\"bad\",\"version\":\"0.3.1\",\"target\":\"esp32\"}"})
    TEST_ASSERT_EQUAL(422,f.command("ota.begin",body));
  f.control.ota.guard=[](){return true;};
  TEST_ASSERT_TRUE(f.control.ota.begin(1024));
  TEST_ASSERT_EQUAL(409,f.command("ota.begin",otaBegin));
  TEST_ASSERT_TRUE(f.control.ota.owns(OtaOwner::Http)); TEST_ASSERT_EQUAL(0,fake_ota::selects);
}
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
  RUN_TEST(power_saves_are_checked_independent_and_do_not_restart);
  RUN_TEST(led_diagnostics_reflect_active_hardware_and_live_settings);
  RUN_TEST(preview_save_failure_and_real_reboot_record);
  RUN_TEST(ota_busy_cannot_be_bypassed_over_ble);
  RUN_TEST(network_validation_and_failed_persistence_keep_setup);
  RUN_TEST(restart_and_factory_reset_clear_bonds_only_when_requested);
  RUN_TEST(optional_website_claim_requires_valid_data_and_checked_storage);
  RUN_TEST(encrypted_writes_wait_for_bonding_instead_of_disconnecting_android);
  RUN_TEST(pairing_failure_never_executes_queued_commands);
  RUN_TEST(unencrypted_writes_are_still_rejected);
  RUN_TEST(reconnect_cannot_replay_a_previous_pairing_session);
  RUN_TEST(ble_ota_disconnect_timeout_and_stale_sessions_abort);
  RUN_TEST(ble_ota_validates_offsets_and_rejects_truncation);
  RUN_TEST(ble_ota_rejects_wrong_target_versions_and_http_conflicts);
  RUN_TEST(ble_ota_complete_image_drains_reply_before_restart_and_preserves_settings);
  RUN_TEST(bluetooth_name_is_pixies_without_changing_network_identity);
  RUN_TEST(ordinary_save_never_restarts_and_only_count_changes_wait_for_restart);
  return UNITY_END();
}
