#include <unity.h>
#include <Core.h>
#include <ScheduleJson.h>
#include "../../src/ClockService.cpp"
#include <cstring>
using namespace pixies;
void setUp() {}
void tearDown() {}
constexpr int64_t monday=1792972800LL; // 2026-10-26 UTC
ScheduleV1 base(int32_t offset=0) {
  ScheduleV1 s; s.enabled=s.hasTimezone=true;
  strcpy(s.timezone.id,"Test/Zone"); s.timezone.fromUtc=kUtcStart;
  s.timezone.untilUtc=kUtcEnd; s.timezone.initialOffsetSeconds=offset;
  return s;
}
void weekdays_boundaries_and_sunday_overnight() {
  auto s=base(); s.days[0]={true,600,660}; s.days[1]={true,1200,1260};
  TEST_ASSERT_FALSE(evaluate(s,monday+599*60).on);
  TEST_ASSERT_TRUE(evaluate(s,monday+600*60).on);
  TEST_ASSERT_FALSE(evaluate(s,monday+660*60).on);
  TEST_ASSERT_EQUAL_INT64(monday+86400+1200*60,evaluate(s,monday+660*60).nextBoundaryUtc);
  s.days[0].enabled=false; s.days[6]={true,1380,60};
  TEST_ASSERT_TRUE(evaluate(s,monday+30*60).on);
  TEST_ASSERT_FALSE(evaluate(s,monday+60*60).on);
  TEST_ASSERT_FALSE(evaluate(s,monday+600*60).on);
  s.days[6].offMinute=1380; TEST_ASSERT_FALSE(validateSchedule(s));
}
void overlaps_are_union_and_disabled_days_have_no_starts() {
  auto s=base(); s.days[6]={true,1320,120}; s.days[0]={true,60,180};
  const auto e=evaluate(s,monday+60*60);
  TEST_ASSERT_TRUE(e.on); TEST_ASSERT_EQUAL_INT64(monday+180*60,e.nextBoundaryUtc);
  for(auto& d:s.days) d.enabled=false;
  TEST_ASSERT_FALSE(evaluate(s,monday).on);
  TEST_ASSERT_EQUAL_INT64(0,evaluate(s,monday).nextBoundaryUtc);
}
void spring_gap_and_autumn_fold() {
  auto s=base(-18000); s.days[6]={true,150,240};
  s.timezone.count=2;
  s.timezone.transitions[0]={1772953200,-14400}; // Mar 8, 07:00 UTC
  s.timezone.transitions[1]={1793512800,-18000}; // Nov 1, 06:00 UTC
  TEST_ASSERT_FALSE(evaluate(s,1772953199).on);
  TEST_ASSERT_TRUE(evaluate(s,1772953200).on);
  TEST_ASSERT_FALSE(evaluate(s,1772956800).on);
  s.days[6]={true,120,150}; // Both missing endpoints clamp to 03:00.
  TEST_ASSERT_FALSE(evaluate(s,1772953200).on);
  s.days[6]={true,90,105};
  TEST_ASSERT_TRUE(evaluate(s,1793511000).on);
  TEST_ASSERT_TRUE(evaluate(s,1793513700).on);
  TEST_ASSERT_FALSE(evaluate(s,1793515500).on);
  TEST_ASSERT_EQUAL_INT64(1793515500,evaluate(s,1793511000).nextBoundaryUtc);
}
void fractional_offsets_southern_half_hour_dst_and_expiry() {
  for(int32_t offset:{20700,-12600}) {
    auto s=base(offset); s.days[0]={true,600,660};
    TEST_ASSERT_TRUE(evaluate(s,monday+600*60-offset).on);
    TEST_ASSERT_FALSE(evaluate(s,monday+660*60-offset).on);
  }
  auto s=base(37800);
  s.timezone.count=1; s.timezone.transitions[0]={1791041400,39600}; // Lord Howe Oct 4
  s.days[6]={true,135,180};
  TEST_ASSERT_TRUE(evaluate(s,1791041400).on);
  TEST_ASSERT_FALSE(evaluate(s,1791043200).on);
  s=base(); s.days[0]={true,0,60}; s.timezone.untilUtc=monday+1800;
  TEST_ASSERT_EQUAL_INT64(monday+1800,evaluate(s,monday).nextBoundaryUtc);
  TEST_ASSERT_FALSE(evaluate(s,monday+1800).on);
  TEST_ASSERT_FALSE(evaluate(s,kUtcStart-1).on);
  s.timezone.fromUtc=monday; s.timezone.untilUtc=monday+86400;
  TEST_ASSERT_EQUAL_INT64(monday,evaluate(s,monday-1).nextBoundaryUtc);
}
void override_clock_corrections_and_no_phone_cold_boot() {
  auto s=base(); s.days[0]={true,600,660};
  ScheduleRuntime r; r.restore(s);
  r.tick(0,false,true); TEST_ASSERT_FALSE(r.effectiveOn);
  r.manual(true,0,false); r.tick(0,false,true); TEST_ASSERT_TRUE(r.effectiveOn);
  r.tick(monday+590*60,true,true);
  TEST_ASSERT_EQUAL_INT64(monday+600*60,r.overrideUntilUtc);
  r.tick(monday+650*60,true,true); TEST_ASSERT_FALSE(r.overrideActive);
  r.manual(false,monday+650*60,true); r.tick(monday+650*60,true,false);
  TEST_ASSERT_FALSE(r.effectiveOn);
  r.tick(monday+580*60,true,false);
  TEST_ASSERT_EQUAL_INT64(monday+600*60,r.overrideUntilUtc);
  r.tick(monday+665*60,true,false); TEST_ASSERT_FALSE(r.overrideActive);
  r.manual(true,monday+665*60,true); r.resume(); r.tick(monday+665*60,true,true);
  TEST_ASSERT_FALSE(r.effectiveOn);
  for(auto& d:s.days) d.enabled=false;
  r.restore(s); r.manual(true,monday,true); r.tick(monday,true,false);
  TEST_ASSERT_TRUE(r.effectiveOn); TEST_ASSERT_EQUAL_INT64(0,r.overrideUntilUtc);
  s.enabled=false; r.restore(s); r.tick(monday,true,false); TEST_ASSERT_FALSE(r.effectiveOn);
  r.restore(s,false); r.tick(monday,true,true); TEST_ASSERT_TRUE(r.effectiveOn);
  TEST_ASSERT_EQUAL_STRING("storage_invalid",r.pauseReason);
  s=base(); s.days[6]={true,1320,120}; s.days[0]={true,60,180};
  r.restore(s); r.manual(false,monday,true); r.tick(monday+120*60,true,true);
  TEST_ASSERT_TRUE(r.overrideActive);
  TEST_ASSERT_EQUAL_INT64(monday+180*60,r.overrideUntilUtc);
  r.tick(monday+180*60,true,true); TEST_ASSERT_FALSE(r.overrideActive);
}
void clock_is_volatile_monotonic_and_injectable() {
  ClockService c; c.tick(100); TEST_ASSERT_FALSE(c.synced());
  TEST_ASSERT_FALSE(c.sync(kUtcEnd,"phone",100));
  TEST_ASSERT_TRUE(c.sync(monday,"phone",100));
  c.tick(2100); TEST_ASSERT_EQUAL_INT64(monday+2,c.utc());
  TEST_ASSERT_EQUAL_INT64(2,c.syncAgeSeconds());
  TEST_ASSERT_TRUE(c.sync(monday+7200,"ntp",2100));
  c.tick(3100,false); TEST_ASSERT_EQUAL_INT64(monday+7201,c.utc());
  TEST_ASSERT_EQUAL_STRING("ntp",c.source());
  ClockService reboot; reboot.tick(3100); TEST_ASSERT_FALSE(reboot.synced());
  ClockService wrap; wrap.tick(UINT32_MAX-499); wrap.sync(monday,"phone",UINT32_MAX-499);
  wrap.tick(500); TEST_ASSERT_EQUAL_INT64(monday+1,wrap.utc());
}
void strict_json_is_atomic_and_bounded() {
  auto s=base(); s.days[0]={true,600,660};
  DynamicJsonDocument doc(4096); writeSchedule(doc.to<JsonObject>(),s);
  ScheduleV1 read; TEST_ASSERT_TRUE(readSchedule(doc.as<JsonVariantConst>(),read));
  doc["days"][0]["onMinute"]="600"; TEST_ASSERT_FALSE(readSchedule(doc.as<JsonVariantConst>(),read));
  doc["days"][0]["onMinute"]=600; doc["extra"]=1;
  TEST_ASSERT_FALSE(readSchedule(doc.as<JsonVariantConst>(),read));
  doc.remove("extra");
  doc["timezone"]["id"]=serialized("\"Bad\\u0000Zone\"");
  std::string wire; serializeJson(doc,wire); doc.clear(); deserializeJson(doc,wire);
  TEST_ASSERT_FALSE(readSchedule(doc.as<JsonVariantConst>(),read));
  s.timezone.count=2; s.timezone.transitions[0]={monday,1800}; s.timezone.transitions[1]={monday,3600};
  TEST_ASSERT_FALSE(validateSchedule(s));
}
void effective_render_never_changes_manual_intent_or_power_limit() {
  Settings s; s.on=false; s.effect=Effect::Steady; s.brightness=100;
  Rgb frame[10]{};
  auto p=render(s,true,0,frame,10,50);
  TEST_ASSERT_FALSE(s.on); TEST_ASSERT_TRUE(p.limited);
  TEST_ASSERT_GREATER_THAN(0,frame[0].b);
  render(s,false,0,frame,10,9000); TEST_ASSERT_EQUAL(0,frame[0].b);
}
int main() {
  UNITY_BEGIN();
  RUN_TEST(weekdays_boundaries_and_sunday_overnight);
  RUN_TEST(overlaps_are_union_and_disabled_days_have_no_starts);
  RUN_TEST(spring_gap_and_autumn_fold);
  RUN_TEST(fractional_offsets_southern_half_hour_dst_and_expiry);
  RUN_TEST(override_clock_corrections_and_no_phone_cold_boot);
  RUN_TEST(clock_is_volatile_monotonic_and_injectable);
  RUN_TEST(strict_json_is_atomic_and_bounded);
  RUN_TEST(effective_render_never_changes_manual_intent_or_power_limit);
  return UNITY_END();
}
