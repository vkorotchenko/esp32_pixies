#include <unity.h>
#include "../../src/OtaUpdater.cpp"
#include <array>
#include <string>
#include <SemVer.h>
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
std::string digest(const uint8_t* bytes,size_t size) {
  mbedtls_sha256_context hash; mbedtls_sha256_init(&hash);
  TEST_ASSERT_EQUAL(0,mbedtls_sha256_starts_ret(&hash,0));
  TEST_ASSERT_EQUAL(0,mbedtls_sha256_update_ret(&hash,bytes,size));
  uint8_t output[32]; TEST_ASSERT_EQUAL(0,mbedtls_sha256_finish_ret(&hash,output));
  mbedtls_sha256_free(&hash);
  char text[65]{};
  for(size_t i=0;i<32;++i) snprintf(text+2*i,3,"%02x",output[i]);
  return text;
}
void sha256_and_transport_ownership() {
  TEST_ASSERT_EQUAL_STRING("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    digest(reinterpret_cast<const uint8_t*>("abc"),3).c_str());
  LedOutput leds; OtaUpdater ota(leds);
  ota.guard=[](){return true;}; ota.bleGuard=[](){return true;};
  const auto data=image(); const auto hash=digest(data.data(),data.size());
  TEST_ASSERT_FALSE(ota.begin(data.size(),OtaOwner::Ble));
  TEST_ASSERT_TRUE(ota.begin(data.size(),OtaOwner::Ble,hash.c_str()));
  TEST_ASSERT_FALSE(ota.chunk(data.data(),512));
  TEST_ASSERT_FALSE(ota.end()); TEST_ASSERT_FALSE(ota.select()); TEST_ASSERT_FALSE(ota.abort());
  TEST_ASSERT_TRUE(ota.owns(OtaOwner::Ble));
  TEST_ASSERT_EQUAL(0,fake_ota::aborts); TEST_ASSERT_EQUAL(0,fake_ota::selects);
  TEST_ASSERT_TRUE(ota.chunk(data.data(),100,OtaOwner::Ble));
  TEST_ASSERT_TRUE(ota.chunk(data.data()+100,924,OtaOwner::Ble));
  TEST_ASSERT_TRUE(ota.end(OtaOwner::Ble)); TEST_ASSERT_TRUE(ota.select(OtaOwner::Ble));
  TEST_ASSERT_EQUAL(1,fake_ota::selects);
}
void checksum_and_ble_authorization_fail_closed() {
  LedOutput leds; OtaUpdater ota(leds); bool secure=true;
  ota.bleGuard=[&](){return secure;};
  const auto data=image();
  TEST_ASSERT_TRUE(ota.begin(data.size(),OtaOwner::Ble,std::string(64,'0').c_str()));
  TEST_ASSERT_TRUE(ota.chunk(data.data(),data.size(),OtaOwner::Ble));
  TEST_ASSERT_FALSE(ota.end(OtaOwner::Ble));
  TEST_ASSERT_EQUAL_STRING("checksum_mismatch",ota.error);
  TEST_ASSERT_EQUAL(0,fake_ota::selects); TEST_ASSERT_FALSE(ota.busy);
  const auto hash=digest(data.data(),data.size());
  TEST_ASSERT_TRUE(ota.begin(data.size(),OtaOwner::Ble,hash.c_str()));
  secure=false;
  TEST_ASSERT_FALSE(ota.chunk(data.data(),data.size(),OtaOwner::Ble));
  TEST_ASSERT_FALSE(ota.busy); TEST_ASSERT_EQUAL(0,fake_ota::selects);
}
void canonical_versions_compare_numerically() {
  int comparison=0;
  TEST_ASSERT_TRUE(pixies::compareVersion("0.10.0","0.9.99",comparison)); TEST_ASSERT_EQUAL(1,comparison);
  TEST_ASSERT_TRUE(pixies::compareVersion("1.0.0","1.0.0",comparison)); TEST_ASSERT_EQUAL(0,comparison);
  for(const char* value:{"01.2.3","1.2.3.4","1.2.3\n","1.2","1.2.3-beta.1","1000000.0.0"})
    TEST_ASSERT_FALSE(pixies::compareVersion(value,"1.2.3",comparison));
}
int main() {
  UNITY_BEGIN(); RUN_TEST(authorization_before_every_flash_boundary); RUN_TEST(streaming_and_inactive_selection);
  RUN_TEST(invalid_and_interrupted_never_select);
  RUN_TEST(sha256_and_transport_ownership);
  RUN_TEST(checksum_and_ble_authorization_fail_closed);
  RUN_TEST(canonical_versions_compare_numerically);
  return UNITY_END();
}
