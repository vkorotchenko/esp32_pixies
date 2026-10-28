#include "Schedule.h"
#include <algorithm>
#include <cstring>

namespace pixies {
bool validateSchedule(const ScheduleV1& s) {
  if(s.version!=1||(s.enabled&&!s.hasTimezone)) return false;
  for(const auto& d:s.days)
    if(d.onMinute>1439||d.offMinute>1439||(d.enabled&&d.onMinute==d.offMinute)) return false;
  if(!s.hasTimezone) return true;
  const auto& z=s.timezone;
  const auto n=strnlen(z.id,sizeof z.id);
  if(!n||n>64||z.count>kMaxTransitions||z.fromUtc<kUtcStart||
     z.untilUtc>kUtcEnd||z.fromUtc>=z.untilUtc||
     z.initialOffsetSeconds < -50400||z.initialOffsetSeconds>50400) return false;
  for(size_t i=0;i<n;++i) if(z.id[i]<33||z.id[i]>126) return false;
  int64_t previous=z.fromUtc;
  for(size_t i=0;i<z.count;++i) {
    const auto& t=z.transitions[i];
    if(t.atUtc<=previous||t.atUtc>=z.untilUtc||t.offsetSeconds < -50400||t.offsetSeconds>50400) return false;
    previous=t.atUtc;
  }
  return true;
}
namespace {
int64_t endpoint(const ScheduleZone& z,int64_t local,bool latest) {
  int64_t found=-1, begin=z.fromUtc;
  int32_t offset=z.initialOffsetSeconds;
  for(size_t i=0;i<=z.count;++i) {
    const int64_t end=i<z.count?z.transitions[i].atUtc:z.untilUtc;
    const int64_t candidate=local-offset;
    if(candidate>=begin&&candidate<end)
      found=found<0?candidate:(latest?std::max(found,candidate):std::min(found,candidate));
    if(i<z.count) {
      const auto next=z.transitions[i].offsetSeconds;
      if(next>offset&&local>=end+offset&&local<end+next)
        found=found<0?end:(latest?std::max(found,end):std::min(found,end));
      offset=next;
    }
    begin=end;
  }
  if(found>=0) return found;
  if(local<z.fromUtc+z.initialOffsetSeconds) return z.fromUtc;
  if(local>=z.untilUtc+offset) return z.untilUtc;
  return -1;
}
struct Interval { int64_t start=0,end=0; };
Interval interval(const ScheduleV1& s,int64_t day) {
  const auto& d=s.days[size_t((day+3)%7)];
  if(!d.enabled) return {};
  const auto start=endpoint(s.timezone,day*86400+d.onMinute*60,false);
  const auto end=endpoint(s.timezone,(day+(d.offMinute<d.onMinute))*86400+d.offMinute*60,true);
  return start>=0&&end>start?Interval{start,end}:Interval{};
}
bool onAt(const ScheduleV1& s,int64_t utc) {
  if(utc<s.timezone.fromUtc||utc>=s.timezone.untilUtc) return false;
  const auto today=utc/86400;
  for(int64_t day=today-3;day<=today+3;++day) {
    const auto i=interval(s,day);
    if(i.start<=utc&&utc<i.end) return true;
  }
  return false;
}
}
ScheduleEvaluation evaluate(const ScheduleV1& s,int64_t utc) {
  if(!validateSchedule(s)||!s.enabled||!s.hasTimezone||utc>=s.timezone.untilUtc) return {};
  const bool any=std::any_of(s.days.begin(),s.days.end(),[](const ScheduleDay& d){return d.enabled;});
  if(!any) return {};
  ScheduleEvaluation result{onAt(s,utc),0};
  int64_t cursor=std::max(utc,s.timezone.fromUtc-1);
  while(cursor<s.timezone.untilUtc) {
    const auto today=cursor/86400;
    const auto horizon=std::min(s.timezone.untilUtc,(today+7)*86400);
    std::array<int64_t,29> boundaries{}; size_t count=0;
    for(int64_t day=today-3;day<=today+10;++day) {
      const auto i=interval(s,day);
      if(i.end>i.start) { boundaries[count++]=i.start; boundaries[count++]=i.end; }
    }
    boundaries[count++]=s.timezone.untilUtc;
    std::sort(boundaries.begin(),boundaries.begin()+count);
    for(size_t i=0;i<count;++i) {
      const auto at=boundaries[i];
      if(at>cursor&&at<=horizon&&onAt(s,at)!=result.on) {
        result.nextBoundaryUtc=at; return result;
      }
    }
    cursor=horizon;
  }
  return result;
}
void ScheduleRuntime::restore(const ScheduleV1& value,bool verified) {
  saved=value; healthy=verified; resume(); lastUtc_=0; awaitingSync_=false;
}
void ScheduleRuntime::manual(bool on,int64_t utc,bool synced) {
  if(!saved.enabled||!healthy) return;
  overrideActive=true; overrideOn=on; awaitingSync_=!synced;
  overrideUntilUtc=synced?evaluate(saved,utc).nextBoundaryUtc:0;
}
void ScheduleRuntime::tick(int64_t utc,bool synced,bool manualIntent) {
  pauseReason=!healthy?"storage_invalid":
    !saved.enabled?"none":!synced?"clock_unsynced":
    !saved.hasTimezone||utc<saved.timezone.fromUtc||utc>=saved.timezone.untilUtc?"timezone_expired":"none";
  const auto e=healthy&&synced?
    (lastUtc_==utc?ScheduleEvaluation{automaticOn,nextBoundaryUtc}:evaluate(saved,utc)):ScheduleEvaluation{};
  automaticOn=e.on; nextBoundaryUtc=e.nextBoundaryUtc;
  if(overrideActive&&synced) {
    if(awaitingSync_||(lastUtc_&&utc<lastUtc_)) {
      overrideUntilUtc=e.nextBoundaryUtc; awaitingSync_=false;
    } else if(overrideUntilUtc&&utc>=overrideUntilUtc) resume();
  }
  effectiveOn=(!healthy||!saved.enabled)?manualIntent:(overrideActive?overrideOn:automaticOn);
  lastUtc_=synced?utc:0;
}
}
