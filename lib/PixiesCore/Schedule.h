#pragma once
#include <array>
#include <cstddef>
#include <cstdint>

namespace pixies {
constexpr int64_t kUtcStart=1577836800LL, kUtcEnd=2145916800LL;
constexpr size_t kMaxTransitions=16;
struct ZoneTransition { int64_t atUtc=0; int32_t offsetSeconds=0; };
struct ScheduleZone {
  char id[65]{};
  int64_t fromUtc=0, untilUtc=0;
  int32_t initialOffsetSeconds=0;
  uint8_t count=0;
  std::array<ZoneTransition,kMaxTransitions> transitions{};
};
struct ScheduleDay { bool enabled=false; uint16_t onMinute=1080, offMinute=1380; };
struct ScheduleV1 {
  uint8_t version=1;
  bool enabled=false, hasTimezone=false;
  ScheduleZone timezone;
  std::array<ScheduleDay,7> days{};
};
struct ScheduleEvaluation { bool on=false; int64_t nextBoundaryUtc=0; };
bool validateSchedule(const ScheduleV1&);
ScheduleEvaluation evaluate(const ScheduleV1&,int64_t utcSeconds);
class ScheduleRuntime {
 public:
  ScheduleV1 saved;
  bool healthy=true, automaticOn=false, effectiveOn=true, overrideActive=false, overrideOn=false;
  int64_t nextBoundaryUtc=0, overrideUntilUtc=0;
  const char* pauseReason="none";
  void restore(const ScheduleV1&,bool verified=true);
  void tick(int64_t utc,bool synced,bool manualIntent);
  void manual(bool on,int64_t utc,bool synced);
  void resume() { overrideActive=false; overrideUntilUtc=0; }
 private:
  int64_t lastUtc_=0;
  bool awaitingSync_=false;
};
}
