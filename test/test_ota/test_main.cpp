#include <unity.h>
#include "../../src/OtaUpdater.cpp"
#include <array>
unsigned blanks=0;
void LedOutput::blank() { ++blanks; }
void setUp() { fake_ota::reset(); blanks=0; }
void tearDown() {}
std::array<uint8_t,1024> image() {
  std::array<uint8_t,1024> data{};
  esp_image_header_t header{}; header.magic=0xe9; header.segment_count=5; header.spi_size=4;
  header.chip_id=9; header.hash_appended=1;
  esp_app_desc_t app{}; app.magic_word=0xabcd5432;
  memcpy(data.data(),&header,sizeof header); memcpy(data.data()+32,&app,sizeof app); return data;
}
void authorization_before_every_flash_boundary() {
  LedOutput leds; OtaUpdater ota(leds); bool auth=false; ota.guard=[&](){return auth;};
  auto data=image();
  TEST_ASSERT_FALSE(ota.begin(data.size())); TEST_ASSERT_EQUAL(0,fake_ota::begins);
  auth=true; TEST_ASSERT_TRUE(ota.begin(data.size())); TEST_ASSERT_EQUAL(1,blanks);
  auth=false; TEST_ASSERT_FALSE(ota.chunk(data.data(),data.size()));
  TEST_ASSERT_EQUAL(0,fake_ota::begins); TEST_ASSERT_EQUAL(0,fake_ota::selects);
  auth=true; TEST_ASSERT_TRUE(ota.begin(data.size())); TEST_ASSERT_TRUE(ota.chunk(data.data(),data.size()));
  auth=false; TEST_ASSERT_FALSE(ota.end()); TEST_ASSERT_EQUAL(0,fake_ota::ends); TEST_ASSERT_EQUAL(0,fake_ota::selects);
  auth=true; TEST_ASSERT_TRUE(ota.begin(data.size())); TEST_ASSERT_TRUE(ota.chunk(data.data(),data.size()));
  TEST_ASSERT_TRUE(ota.end()); auth=false; TEST_ASSERT_FALSE(ota.select()); TEST_ASSERT_EQUAL(0,fake_ota::selects);
}
void streaming_and_inactive_selection() {
  LedOutput leds; OtaUpdater ota(leds); ota.guard=[](){return true;}; const auto data=image();
  TEST_ASSERT_TRUE(ota.begin(data.size()));
  TEST_ASSERT_TRUE(ota.chunk(data.data(),100)); TEST_ASSERT_EQUAL(0,fake_ota::begins);
  TEST_ASSERT_TRUE(ota.chunk(data.data()+100,400));
  TEST_ASSERT_TRUE(ota.chunk(data.data()+500,524));
  TEST_ASSERT_EQUAL(1024,fake_ota::bytes); TEST_ASSERT_EQUAL(0,fake_ota::selects);
  TEST_ASSERT_TRUE(ota.end()); TEST_ASSERT_TRUE(ota.validated); TEST_ASSERT_EQUAL(0,fake_ota::selects);
  TEST_ASSERT_TRUE(ota.select()); TEST_ASSERT_EQUAL(1,fake_ota::selects);
}
void invalid_and_interrupted_never_select() {
  LedOutput leds; OtaUpdater ota(leds); ota.guard=[](){return true;}; auto data=image();
  TEST_ASSERT_FALSE(ota.begin(0x700001)); TEST_ASSERT_EQUAL(0,fake_ota::begins);
  data[12]=0; TEST_ASSERT_TRUE(ota.begin(data.size())); TEST_ASSERT_FALSE(ota.chunk(data.data(),data.size()));
  TEST_ASSERT_EQUAL(0,fake_ota::begins); TEST_ASSERT_FALSE(ota.busy);
  data=image(); TEST_ASSERT_TRUE(ota.begin(data.size())); TEST_ASSERT_TRUE(ota.chunk(data.data(),512));
  TEST_ASSERT_FALSE(ota.end()); TEST_ASSERT_EQUAL(0,fake_ota::selects);
  TEST_ASSERT_TRUE(ota.begin(data.size())); TEST_ASSERT_TRUE(ota.chunk(data.data(),data.size()));
  fake_ota::endError=-1; TEST_ASSERT_FALSE(ota.end()); TEST_ASSERT_EQUAL(0,fake_ota::selects);
  fake_ota::endError=0;
  TEST_ASSERT_TRUE(ota.begin(data.size())); TEST_ASSERT_TRUE(ota.chunk(data.data(),data.size()));
  fake_ota::verifiedLength=1000; TEST_ASSERT_FALSE(ota.end()); TEST_ASSERT_EQUAL(0,fake_ota::selects);
  TEST_ASSERT_TRUE(ota.begin(data.size())); TEST_ASSERT_TRUE(ota.chunk(data.data(),512));
  ota.abort(); TEST_ASSERT_FALSE(ota.busy); TEST_ASSERT_FALSE(ota.select());
  TEST_ASSERT_EQUAL(0,fake_ota::selects);
  fake_ota::target.address=fake_ota::running.address;
  TEST_ASSERT_FALSE(ota.begin(data.size())); TEST_ASSERT_EQUAL(0,fake_ota::selects);
  fake_ota::target.address=0x710000;
}
int main() {
  UNITY_BEGIN(); RUN_TEST(authorization_before_every_flash_boundary); RUN_TEST(streaming_and_inactive_selection);
  RUN_TEST(invalid_and_interrupted_never_select); return UNITY_END();
}
