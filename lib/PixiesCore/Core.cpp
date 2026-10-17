#include "Core.h"
#include <algorithm>
#include <cstring>

namespace pixies {
const Palette& lightBlue() {
  static const Palette p{"builtin:light-blue", "Light blue", 1, {{{173,216,230}}}};
  return p;
}
const Palette& halloween() {
  static const Palette p{"halloween", "Halloween", 2, {{{0,255,0},{255,165,0}}}};
  return p;
}
const Palette& christmas() {
  static const Palette p{"christmas", "Christmas", 3, {{{255,0,0},{255,255,255},{0,255,0}}}};
  return p;
}
const char* effectName(Effect e) {
  static const char* names[]{"steady","twinkle","candle","breathe","chase"};
  return unsigned(e) < 5 ? names[unsigned(e)] : "";
}
bool parseEffect(const char* name, Effect& out) {
  if (!name) return false;
  for (unsigned i=0; i<5; ++i) if (!strcmp(name,effectName(Effect(i)))) { out=Effect(i); return true; }
  return false;
}
const Palette* selectedPalette(const Settings& s) {
  if (!strcmp(s.paletteId,"builtin:light-blue")) return &lightBlue();
  if (!strcmp(s.paletteId,"halloween")) return &halloween();
  if (!strcmp(s.paletteId,"christmas")) return &christmas();
  for (size_t i=0; i<std::min(size_t(s.customCount),kMaxPalettes); ++i)
    if (!strcmp(s.paletteId,s.custom[i].id)) return &s.custom[i];
  return nullptr;
}
static bool text(const char* s, size_t cap, bool id) {
  const size_t n = strnlen(s,cap);
  if (!n || n==cap) return false;
  for (size_t i=0; i<n; ++i) {
    const auto c = static_cast<unsigned char>(s[i]);
    if (id ? !((c>='a'&&c<='z')||(c>='0'&&c<='9')||c=='-'||c=='_') : (c<32||c>126))
      return false;
  }
  return true;
}
bool validate(const Settings& s, const char*& field) {
  field = "ledCount";
  if (s.ledCount<1 || s.ledCount>kMaxLeds) return false;
  field = "controls";
  if (s.brightness>100 || s.speed>100 || s.intensity>100 || s.density>100) return false;
  field = "effect";
  if (unsigned(s.effect)>=5) return false;
  field = "customPalettes";
  if (s.customCount>kMaxPalettes) return false;
  for (size_t i=0; i<s.customCount; ++i) {
    const Palette& p = s.custom[i];
    if (!text(p.id,sizeof p.id,true)||!text(p.name,sizeof p.name,false)||
        p.count<1||p.count>kMaxColors||!strcmp(p.id,"halloween")||!strcmp(p.id,"christmas")) return false;
    for (size_t j=0; j<i; ++j) if (!strcmp(p.id,s.custom[j].id)) return false;
  }
  field = "paletteId";
  if ((!text(s.paletteId,sizeof s.paletteId,true) &&
       strncmp(s.paletteId,"builtin:light-blue",sizeof s.paletteId)) || !selectedPalette(s)) return false;
  field = "";
  return true;
}
bool equal(const Settings& a, const Settings& b) {
  if (a.ledCount!=b.ledCount||a.on!=b.on||a.brightness!=b.brightness||a.speed!=b.speed||
      a.intensity!=b.intensity||a.density!=b.density||a.effect!=b.effect||
      strcmp(a.paletteId,b.paletteId)||a.customCount!=b.customCount) return false;
  for (size_t i=0; i<a.customCount; ++i) {
    const auto& x=a.custom[i]; const auto& y=b.custom[i];
    if (strcmp(x.id,y.id)||strcmp(x.name,y.name)||x.count!=y.count) return false;
    for(size_t j=0;j<x.count;++j) if (!(x.colors[j]==y.colors[j])) return false;
  }
  return true;
}
void SettingsState::restore(const Settings& s) { live=persisted=s; activeCount=s.ledCount; revision=savedRevision=1; }
bool SettingsState::preview(const Settings& s, uint32_t base) {
  const char* f=nullptr;
  if (base!=revision||!validate(s,f)) return false;
  live=s;
  ++revision;
  if (!revision) revision=1;
  return true;
}
void SettingsState::saved() { persisted=live; savedRevision=revision; }
static uint32_t hash(uint32_t x) {
  x ^= x >> 16; x *= 0x7feb352dU; x ^= x >> 15; x *= 0x846ca68bU; return x ^ (x >> 16);
}
static uint8_t triangle(uint64_t time, uint32_t period) {
  const uint32_t t = uint32_t(time % period) * 510U / period;
  return uint8_t(t>255 ? 510-t : t);
}
bool validatePower(const PowerSettings& s,const char*& field) {
  field="supplyWatts";
  if(s.supplyWatts<1||s.supplyWatts>2000) return false;
  field="ledMilliWatts";
  if(s.ledMilliWatts<10||s.ledMilliWatts>10000) return false;
  field=nullptr; return true;
}
uint32_t powerBudgetMa(const PowerSettings& s,uint32_t hardwareBudgetMa) {
  const uint32_t supply=uint32_t(uint64_t(s.supplyWatts)*1000U*(100U-kPowerHeadroomPercent)/(100U*kLedSupplyVolts));
  return supply<hardwareBudgetMa ? supply : hardwareBudgetMa;
}
Power render(const Settings& s,uint64_t ms,Rgb* out,size_t count,uint32_t budget,uint16_t ledMilliWatts) {
  Power p;
  if (!out || !count || count>kMaxLeds) return p;
  const Palette* pal = selectedPalette(s);
  if (!pal || !pal->count) return p;
  const uint32_t period = 300U + (100U-s.speed)*47U;
  uint64_t sum = 0;
  for (size_t i=0; i<count; ++i) {
    size_t color = i%pal->count;
    uint32_t level = s.on ? 255 : 0;
    const uint32_t seed=hash(uint32_t(i)+0x1234567U);
    switch (s.effect) {
      case Effect::Steady: break;
      case Effect::Breathe: level=level*(25U+triangle(ms,period)*230U/255U)/255U; break;
      case Effect::Chase: {
        const uint64_t step=ms/(20U+(100U-s.speed)*3U);
        color=(i+step)%pal->count;
        if ((i+step)%100 >= s.density) level=level*(100U-s.intensity)/100U;
        break;
      }
      case Effect::Twinkle: {
        const uint64_t local=ms+(seed%period);
        const uint32_t choose=hash(uint32_t(local/period)^seed)%100;
        const uint32_t pulse=choose<s.density ? triangle(local,period) : 0;
        level=level*(255U-s.intensity*255U/100U+pulse*s.intensity/100U)/255U;
        break;
      }
      case Effect::Candle: {
        const uint32_t tick=40U+(100U-s.speed)*4U;
        const uint32_t a=hash(uint32_t(ms/tick)^seed)&255U;
        const uint32_t b=hash(uint32_t(ms/tick+1)^seed)&255U;
        const uint32_t mix=uint32_t(ms%tick);
        const uint32_t noise=(a*(tick-mix)+b*mix)/tick;
        if (seed%100<s.density) level=level*(255U-noise*s.intensity/100U)/255U;
        break;
      }
    }
    const Rgb c=pal->colors[color];
    level=level*s.brightness/100U;
    out[i]={uint8_t(c.r*level/255U),uint8_t(c.g*level/255U),uint8_t(c.b*level/255U)};
    sum+=out[i].r+out[i].g+out[i].b;
  }
  // Include 1mA standby per physical pixel; rated LED watts scale RGB demand.
  constexpr uint32_t denominator=3U*255U*kLedSupplyVolts;
  const auto demand=[&](uint64_t channels) {
    return uint32_t(count+(channels*ledMilliWatts+denominator-1)/denominator);
  };
  p.requestedMa=demand(sum);
  const uint32_t idle=uint32_t(count);
  p.standbyExceedsBudget=idle>budget;
  const uint64_t allowance=budget>idle&&ledMilliWatts>=10&&ledMilliWatts<=10000
    ? uint64_t(budget-idle)*denominator/ledMilliWatts : 0;
  if (sum>allowance) {
    p.limited=true;
    p.scalePermille=sum ? uint16_t(allowance*1000U/sum) : 1000;
    for (size_t i=0;i<count;++i) {
      out[i].r=uint8_t(out[i].r*allowance/sum);
      out[i].g=uint8_t(out[i].g*allowance/sum);
      out[i].b=uint8_t(out[i].b*allowance/sum);
    }
    sum=0;
    for (size_t i=0;i<count;++i) sum+=out[i].r+out[i].g+out[i].b;
  }
  p.estimatedMa=demand(sum);
  return p;
}
ConnectResult connectionDecision(bool candidate, bool connected, uint32_t age) {
  if (connected) return candidate ? ConnectResult::CommitCandidate : ConnectResult::Connected;
  if (age>=15000) return candidate ? ConnectResult::FailedCandidate : ConnectResult::Fallback;
  return ConnectResult::Waiting;
}
bool passwordLength(size_t n) { return n>=12 && n<=64; }
bool canClaim(bool configured,bool ap,bool peer) { return !configured&&ap&&peer; }
bool adminAllowed(bool session,bool origin,bool csrf) { return session&&origin&&csrf; }
bool otaStartAllowed(bool auth,bool busy,size_t n,size_t slot) { return auth&&!busy&&n>=288&&n<=slot; }
bool OtaTransfer::begin(size_t n,size_t slot) {
  expected=n; received=0; failed=n<288||n>slot; return !failed;
}
bool OtaTransfer::chunk(size_t n) {
  if (failed||n>expected-received) { failed=true; return false; }
  received+=n; return true;
}
bool OtaTransfer::complete(bool valid) const { return !failed&&valid&&received==expected; }
uint32_t crc32(const uint8_t* data,size_t n) {
  uint32_t c=0xffffffffU;
  for(size_t i=0;i<n;++i) { c^=data[i]; for(int b=0;b<8;++b) c=(c>>1)^((c&1)?0xedb88320U:0); }
  return ~c;
}
bool validRecord(const RecordHeader& h,const uint8_t* payload,size_t stored,size_t cap) {
  return h.magic==kRecordMagic&&h.version==1&&h.length<=cap&&
    stored>=sizeof h&&h.length==stored-sizeof h&&h.crc==crc32(payload,h.length);
}
bool supportedImage(const ImageIdentity& i) {
  // ESP32-S3 chip ID 9, 16MB flash enum 4, app descriptor magic per IDF.
  return i.magic==0xe9&&i.segments>=1&&i.segments<=16&&i.flashSize==4&&
    i.hashAppended==1&&i.chip==9&&i.appMagic==0xabcd5432U&&i.secureVersion==0;
}
uint32_t LoginThrottle::retryAfter(uint32_t now) const {
  if(!attempted) return 0;
  const uint32_t delayMs=failures>=5 ? 60000 : 1500;
  const uint32_t age=uint32_t(now-lastAttempt);
  return age<delayMs ? delayMs-age : 0;
}
void LoginThrottle::result(uint32_t now,bool success) {
  attempted=true; lastAttempt=now;
  if(success) failures=0; else if(failures<255) ++failures;
}
}  // namespace pixies
