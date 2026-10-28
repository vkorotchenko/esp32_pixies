#define PIXIES_WEB_API_TEST
#define ARDUINOJSON_ENABLE_ARDUINO_STRING 1
#include <unity.h>
#include "../../src/SettingsStore.cpp"
#include "../../src/NetworkManager.cpp"
#include "../../src/OtaUpdater.cpp"
#include "../../src/ClockService.cpp"
#include "../../src/DeviceControl.cpp"
#ifdef __clang__
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wunused-private-field"
#endif
#include "../../src/WebApi.cpp"
#ifdef __clang__
#pragma clang diagnostic pop
#endif

extern const uint8_t test_index_start[] asm("_binary_web_index_html_start")={0};
extern const uint8_t test_index_end[] asm("_binary_web_index_html_end")={0};
extern const uint8_t test_app_start[] asm("_binary_web_app_js_start")={0};
extern const uint8_t test_app_end[] asm("_binary_web_app_js_end")={0};
extern const uint8_t test_styles_start[] asm("_binary_web_styles_css_start")={0};
extern const uint8_t test_styles_end[] asm("_binary_web_styles_css_end")={0};
void BoundedWebServer::handleClient() {
  body_=fake_web::body;
  if(!requestGate||requestGate()) WebServer::dispatch();
}
void Admin::begin() {}
bool Admin::claim(const String&) { return false; }
bool Admin::login(const String&,uint32_t) { return false; }
bool Admin::authenticated(WebServer&,uint32_t) const { return fake_web::authenticated; }
bool Admin::csrf(WebServer& s) const { return s.header("X-CSRF-Token")=="test-csrf"; }
void Admin::cookie(WebServer&) {}
void Admin::logout() {}
void Admin::expire(uint32_t) {}
uint32_t Admin::retryAfter(uint32_t) const { return 0; }
void LedOutput::blank() {}
void setUp() {
  fake_nvs::reset(); fake_wifi::reset(); fake_ota::reset();
  fake_web::authenticated=false; fake_web::headers.clear(); fake_web::host="192.168.4.1";
}
void tearDown() {}
struct Fixture {
  SettingsStore store;
  pixies::SettingsState settings;
  LedOutput leds;
  NetworkManager network{store};
  DeviceControl device{store,settings,leds,network};
  WebApi api{device};
  Fixture() { store.begin(); network.begin(); api.begin(); }
  int call(const char* path,HTTPMethod method,const std::string& body="{}") {
    fake_web::path=path; fake_web::method=method; fake_web::body=body.c_str();
    fake_web::response=""; fake_web::code=0; api.tick(fake_wifi::now);
    return fake_web::code;
  }
  void origin() {
    fake_web::headers["Origin"]="http://192.168.4.1";
    fake_web::headers["X-Pixies-Request"]="1";
    fake_web::headers["Content-Type"]="application/json";
  }
};
void real_routes_enforce_admin_csrf_origin_boot_and_busy_guards() {
  Fixture f;
  TEST_ASSERT_EQUAL(200,f.call("/api/schedule",HTTP_GET));
  const std::string sync="{\"bootId\":\""+std::string(f.device.bootId.c_str())+"\",\"utcSeconds\":1792972800}";
  TEST_ASSERT_EQUAL(403,f.call("/api/time/sync",HTTP_POST,sync));
  f.origin();
  TEST_ASSERT_EQUAL(401,f.call("/api/time/sync",HTTP_POST,sync));
  fake_web::authenticated=true;
  TEST_ASSERT_EQUAL(403,f.call("/api/time/sync",HTTP_POST,sync));
  fake_web::headers["X-CSRF-Token"]="test-csrf";
  TEST_ASSERT_EQUAL(413,f.call("/api/time/sync",HTTP_POST,sync+std::string(4096,' ')));
  TEST_ASSERT_EQUAL(200,f.call("/api/time/sync",HTTP_POST,sync));
  TEST_ASSERT_TRUE(f.device.clock.synced());
  f.device.ota.busy=true;
  TEST_ASSERT_EQUAL(409,f.call("/api/time/sync",HTTP_POST,sync));
  f.device.ota.busy=false;
  TEST_ASSERT_EQUAL(409,f.call("/api/schedule/resume",HTTP_POST,"{\"bootId\":\"0000000000000000\"}"));
}
void real_schedule_save_read_and_trusted_lan_manual_routes() {
  Fixture f; f.origin(); fake_web::authenticated=true; fake_web::headers["X-CSRF-Token"]="test-csrf";
  DynamicJsonDocument args(4096);
  args["bootId"]=f.device.bootId; args["baseRevision"]=1;
  pixies::writeSchedule(args.createNestedObject("schedule"),pixies::ScheduleV1{});
  std::string body; serializeJson(args,body);
  TEST_ASSERT_EQUAL(200,f.call("/api/schedule",HTTP_PUT,body));
  TEST_ASSERT_TRUE(fake_nvs::records.count("px-settings/schedule"));
  TEST_ASSERT_EQUAL(200,f.call("/api/schedule",HTTP_GET));
  TEST_ASSERT_TRUE(fake_web::response.length()<4096);
  fake_web::authenticated=false; fake_web::headers.erase("X-CSRF-Token");
  body="{\"bootId\":\""+std::string(f.device.bootId.c_str())+"\",\"baseRevision\":1,\"on\":false}";
  TEST_ASSERT_EQUAL(200,f.call("/api/lights",HTTP_PUT,body)); TEST_ASSERT_FALSE(f.settings.live.on);
  f.device.restarting=true;
  TEST_ASSERT_EQUAL(409,f.call("/api/lights",HTTP_PUT,body));
}
int main() {
  UNITY_BEGIN(); RUN_TEST(real_routes_enforce_admin_csrf_origin_boot_and_busy_guards);
  RUN_TEST(real_schedule_save_read_and_trusted_lan_manual_routes); return UNITY_END();
}
