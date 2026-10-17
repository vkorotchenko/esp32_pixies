#include <unity.h>
#include <Core.h>
#include <SettingsJson.h>
#include <cstring>
#include <climits>
using namespace pixies;
void setUp() {}
void tearDown() {}
void clean_defaults_preserve_saved_choices() {
  Settings initial; const char* field;
  TEST_ASSERT_TRUE(validate(initial,field));
  TEST_ASSERT_EQUAL(Effect::Twinkle,initial.effect);
  TEST_ASSERT_EQUAL_STRING("builtin:light-blue",initial.paletteId);
  TEST_ASSERT_TRUE(selectedPalette(initial)->colors[0]==(Rgb{173,216,230}));
  Settings saved=initial;
  saved.effect=Effect::Steady; saved.on=false; saved.ledCount=333;
  saved.customCount=1;
  saved.custom[0]={"light-blue","Previously valid custom",1,{{{1,2,3}}}};
  strcpy(saved.paletteId,"light-blue");
  TEST_ASSERT_TRUE(validate(saved,field));
  SettingsState reboot; reboot.restore(saved);
  TEST_ASSERT_TRUE(equal(saved,reboot.live));
  TEST_ASSERT_TRUE(selectedPalette(reboot.live)->colors[0]==(Rgb{1,2,3}));
}
void lengths() {
  const char* f; Settings s;
  for(unsigned n:{0,1,200,1000,1001}) {
    s.ledCount=n; TEST_ASSERT_EQUAL(n>=1&&n<=1000,validate(s,f));
  }
}
void palettes() {
  Settings s; const char* f;
  s.customCount=10;
  for(unsigned i=0;i<10;++i) {
    auto& p=s.custom[i]; snprintf(p.id,sizeof p.id,"p%u",i); strcpy(p.name,"Custom"); p.count=8;
  }
  TEST_ASSERT_TRUE(validate(s,f));
  s.customCount=11; TEST_ASSERT_FALSE(validate(s,f)); s.customCount=10;
  s.custom[0].count=0; TEST_ASSERT_FALSE(validate(s,f));
  s.custom[0].count=9; TEST_ASSERT_FALSE(validate(s,f)); s.custom[0].count=1;
  strcpy(s.custom[0].id,"halloween"); TEST_ASSERT_FALSE(validate(s,f));
  strcpy(s.custom[0].id,"p1"); TEST_ASSERT_FALSE(validate(s,f));
  strcpy(s.custom[0].id,"<bad>"); TEST_ASSERT_FALSE(validate(s,f));
}
void settings_json() {
  DynamicJsonDocument d(kJsonCapacity); Settings s,out; const char* f;
  writeSettings(d.to<JsonObject>(),s);
  TEST_ASSERT_TRUE(readSettings(d.as<JsonVariantConst>(),out,f));
  TEST_ASSERT_TRUE(equal(s,out));
  for(const char* key:{"ledCount","brightness","speed","intensity","density"}) {
    auto old=d[key].as<unsigned>();
    d[key]=-1; TEST_ASSERT_FALSE(readSettings(d.as<JsonVariantConst>(),out,f));
    d[key]=1.5; TEST_ASSERT_FALSE(readSettings(d.as<JsonVariantConst>(),out,f));
    d[key]=true; TEST_ASSERT_FALSE(readSettings(d.as<JsonVariantConst>(),out,f)); d[key]=old;
  }
  d["on"]="true"; TEST_ASSERT_FALSE(readSettings(d.as<JsonVariantConst>(),out,f)); d["on"]=true;
  d["effect"]="invalid"; TEST_ASSERT_FALSE(readSettings(d.as<JsonVariantConst>(),out,f)); d["effect"]="steady";
  d["paletteId"]="missing"; TEST_ASSERT_FALSE(readSettings(d.as<JsonVariantConst>(),out,f)); d["paletteId"]="halloween";
  d["extra"]=0; TEST_ASSERT_FALSE(readSettings(d.as<JsonVariantConst>(),out,f)); d.remove("extra");
  auto p=d["customPalettes"].as<JsonArray>().createNestedObject();
  p["id"]="custom"; p["name"]="Name"; auto c=p.createNestedArray("colors"); c.add("#abcdef");
  TEST_ASSERT_TRUE(readSettings(d.as<JsonVariantConst>(),out,f));
  c[0]="#zz0000"; TEST_ASSERT_FALSE(readSettings(d.as<JsonVariantConst>(),out,f));
  c[0]="#FF0000"; p["builtin"]=false; TEST_ASSERT_FALSE(readSettings(d.as<JsonVariantConst>(),out,f));
  for(const char* text:{"{}x","{}{}","[]","{\"x\":\"unfinished}","{\"x\":\"bad\nstring\"}","{} null"}) {
    TEST_ASSERT_FALSE(completeJsonObject(text,strlen(text)));
  }
  for(const char* text:{"{}"," \n {\"x\":\"{}[]\\\"\"} \t","{\"x\":[{\"nested\":true}]}"}) {
    TEST_ASSERT_TRUE(completeJsonObject(text,strlen(text)));
  }
  const char nul[]{'{','}',0,'x'};
  TEST_ASSERT_FALSE(completeJsonObject(nul,sizeof nul));
}
void persistence_rules() {
  SettingsState state; Settings s; s.on=false; s.ledCount=1000;
  TEST_ASSERT_TRUE(state.preview(s,1));
  TEST_ASSERT_TRUE(state.dirty()); TEST_ASSERT_TRUE(state.restartRequired());
  TEST_ASSERT_EQUAL(200,state.activeCount);
  TEST_ASSERT_FALSE(state.preview(Settings{},1));
  SettingsState reboot; reboot.restore(state.persisted);
  TEST_ASSERT_TRUE(reboot.live.on); TEST_ASSERT_EQUAL(200,reboot.activeCount);
  state.saved(); TEST_ASSERT_FALSE(state.dirty()); TEST_ASSERT_TRUE(state.restartRequired());
  reboot.restore(state.persisted); TEST_ASSERT_FALSE(reboot.live.on); TEST_ASSERT_EQUAL(1000,reboot.activeCount);
}
void effects_power() {
  std::array<Rgb,1002> frame{}, duplicate{}; Settings s;
  s.brightness=100;
  s.effect=Effect::Steady; strcpy(s.paletteId,"halloween");
  render(s,0,frame.data(),2,9000);
  TEST_ASSERT_TRUE(frame[0]==halloween().colors[0]);
  TEST_ASSERT_TRUE(frame[1]==halloween().colors[1]);
  frame.fill({});
  s.customCount=1; strcpy(s.custom[0].id,"white"); strcpy(s.custom[0].name,"White");
  s.custom[0].count=1; s.custom[0].colors[0]={255,255,255}; strcpy(s.paletteId,"white");
  s.brightness=100;
  for(unsigned e=0;e<5;++e) for(unsigned count:{1,200,1000}) for(uint64_t time:{0ULL,1000ULL,4294967300ULL}) {
    s.effect=Effect(e);
    auto p=render(s,time,frame.data()+1,count,9000);
    auto q=render(s,time,duplicate.data()+1,count,9000);
    TEST_ASSERT_EQUAL_MEMORY(frame.data(),duplicate.data(),sizeof frame);
    TEST_ASSERT_EQUAL(p.estimatedMa,q.estimatedMa);
    TEST_ASSERT_LESS_OR_EQUAL(9000,p.estimatedMa);
    TEST_ASSERT_TRUE(frame[0]==Rgb{}); TEST_ASSERT_TRUE(frame[count+1]==Rgb{});
    frame.fill({}); duplicate.fill({});
  }
  s.effect=Effect::Steady;
  auto p=render(s,0,frame.data(),1000,9000);
  TEST_ASSERT_TRUE(p.limited); TEST_ASSERT_EQUAL(61000,p.requestedMa);
  s.effect=Effect::Breathe;
  render(s,0,frame.data(),1,9000); const auto dim=frame[0];
  render(s,1325,frame.data(),1,9000); TEST_ASSERT_GREATER_THAN(dim.r,frame[0].r);
  for(unsigned e=0;e<5;++e) for(unsigned brightness:{0,100}) for(unsigned speed:{0,100})
    for(unsigned density:{0,100}) for(unsigned intensity:{0,100}) {
      s.effect=Effect(e); s.brightness=brightness; s.speed=speed; s.density=density; s.intensity=intensity;
      TEST_ASSERT_LESS_OR_EQUAL(9000,render(s,5555,frame.data(),1000,9000).estimatedMa);
    }
  s.on=false; render(s,200,frame.data(),1000,9000);
  for(unsigned i=0;i<1000;++i) TEST_ASSERT_TRUE(frame[i]==Rgb{});
  TEST_ASSERT_EQUAL(0,render(s,0,nullptr,0,9000).estimatedMa);
  TEST_ASSERT_EQUAL(0,render(s,0,frame.data(),1001,9000).estimatedMa);
  s.on=true; s.brightness=100;
  p=render(s,0,frame.data(),1000,1000);
  TEST_ASSERT_TRUE(p.limited); TEST_ASSERT_EQUAL(1000,p.estimatedMa);
  Clock clock; clock.reset(UINT32_MAX-9);
  TEST_ASSERT_EQUAL_UINT64(20,clock.advance(10));
  TEST_ASSERT_EQUAL_UINT64(30,clock.advance(20));
  TEST_ASSERT_TRUE(elapsed(10,UINT32_MAX-9,20));
}
void decisions() {
  TEST_ASSERT_EQUAL(ConnectResult::Waiting,connectionDecision(true,false,14999));
  TEST_ASSERT_EQUAL(ConnectResult::FailedCandidate,connectionDecision(true,false,15000));
  TEST_ASSERT_EQUAL(ConnectResult::CommitCandidate,connectionDecision(true,true,1));
  TEST_ASSERT_EQUAL(ConnectResult::Fallback,connectionDecision(false,false,15000));
  TEST_ASSERT_EQUAL(ConnectResult::Connected,connectionDecision(false,true,1));
  TEST_ASSERT_TRUE(canClaim(false,true,true));
  TEST_ASSERT_FALSE(canClaim(true,true,true)); TEST_ASSERT_FALSE(canClaim(false,true,false));
  for(unsigned flags=0;flags<8;++flags)
    TEST_ASSERT_EQUAL(flags==7,adminAllowed(flags&1,flags&2,flags&4));
  TEST_ASSERT_FALSE(passwordLength(11)); TEST_ASSERT_TRUE(passwordLength(12));
  TEST_ASSERT_TRUE(passwordLength(64)); TEST_ASSERT_FALSE(passwordLength(65));
  TEST_ASSERT_TRUE(otaStartAllowed(true,false,1024,2048));
  TEST_ASSERT_FALSE(otaStartAllowed(false,false,1024,2048));
  TEST_ASSERT_FALSE(otaStartAllowed(true,true,1024,2048));
  TEST_ASSERT_FALSE(otaStartAllowed(true,false,2049,2048));
  OtaTransfer t; TEST_ASSERT_TRUE(t.begin(1024,2048)); TEST_ASSERT_TRUE(t.chunk(512));
  TEST_ASSERT_FALSE(t.complete(true)); TEST_ASSERT_TRUE(t.chunk(512));
  TEST_ASSERT_FALSE(t.complete(false)); TEST_ASSERT_TRUE(t.complete(true));
  TEST_ASSERT_FALSE(t.chunk(1)); TEST_ASSERT_FALSE(t.complete(true));
  TEST_ASSERT_FALSE(t.begin(0,2048));
  const uint8_t data[]{1,2,3}; TEST_ASSERT_NOT_EQUAL(crc32(data,3),crc32(data,2));
}
void corrupt_records_and_images() {
  uint8_t data[]{1,2,3};
  RecordHeader header{kRecordMagic,1,3,crc32(data,3)};
  TEST_ASSERT_TRUE(validRecord(header,data,sizeof header+3,3));
  TEST_ASSERT_FALSE(validRecord(header,data,sizeof header+2,3));
  TEST_ASSERT_FALSE(validRecord(header,data,sizeof header+3,2));
  data[1]^=1; TEST_ASSERT_FALSE(validRecord(header,data,sizeof header+3,3)); data[1]^=1;
  header.version=2; TEST_ASSERT_FALSE(validRecord(header,data,sizeof header+3,3)); header.version=1;
  header.length=UINT32_MAX; TEST_ASSERT_FALSE(validRecord(header,data,sizeof header+3,3));
  ImageIdentity identity{0xe9,5,4,1,9,0xabcd5432U,0};
  TEST_ASSERT_TRUE(supportedImage(identity));
  auto bad=identity; bad.magic=0; TEST_ASSERT_FALSE(supportedImage(bad));
  bad=identity; bad.chip=0; TEST_ASSERT_FALSE(supportedImage(bad));
  bad=identity; bad.flashSize=3; TEST_ASSERT_FALSE(supportedImage(bad));
  bad=identity; bad.segments=0; TEST_ASSERT_FALSE(supportedImage(bad));
  bad=identity; bad.segments=17; TEST_ASSERT_FALSE(supportedImage(bad));
  bad=identity; bad.hashAppended=0; TEST_ASSERT_FALSE(supportedImage(bad));
  bad=identity; bad.appMagic=0; TEST_ASSERT_FALSE(supportedImage(bad));
  bad=identity; bad.secureVersion=1; TEST_ASSERT_FALSE(supportedImage(bad));
}
void login_throttling() {
  LoginThrottle throttle;
  TEST_ASSERT_EQUAL(0,throttle.retryAfter(0));
  for(unsigned i=0;i<5;++i) {
    throttle.result(i*2000,false);
    TEST_ASSERT_GREATER_THAN(0,throttle.retryAfter(i*2000));
  }
  TEST_ASSERT_EQUAL(60000,throttle.retryAfter(8000));
  TEST_ASSERT_EQUAL(0,throttle.retryAfter(68000));
  throttle.result(UINT32_MAX-9,true);
  TEST_ASSERT_EQUAL(1480,throttle.retryAfter(10));
  TEST_ASSERT_EQUAL(0,throttle.retryAfter(2000));
}
int main() {
  UNITY_BEGIN(); RUN_TEST(clean_defaults_preserve_saved_choices); RUN_TEST(lengths); RUN_TEST(palettes); RUN_TEST(settings_json);
  RUN_TEST(persistence_rules); RUN_TEST(effects_power); RUN_TEST(decisions);
  RUN_TEST(corrupt_records_and_images); RUN_TEST(login_throttling);
  return UNITY_END();
}
