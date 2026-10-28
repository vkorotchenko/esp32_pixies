#include "ScheduleJson.h"
#include "SettingsJson.h"
#include <cstring>
namespace pixies {
namespace {
bool object(JsonVariantConst v,std::initializer_list<const char*> keys) {
  return v.is<JsonObjectConst>()&&v.size()==keys.size()&&keysOnly(v.as<JsonObjectConst>(),keys.begin(),keys.size());
}
bool integer(JsonVariantConst v,int64_t min,int64_t max) {
  return !v.is<bool>()&&v.is<int64_t>()&&v.as<int64_t>()>=min&&v.as<int64_t>()<=max;
}
}
bool readSchedule(JsonVariantConst v,ScheduleV1& out) {
  if(!object(v,{"version","enabled","timezone","days"})||!integer(v["version"],1,1)||
     !v["enabled"].is<bool>()||!v["days"].is<JsonArrayConst>()||v["days"].size()!=7) return false;
  ScheduleV1 s; s.enabled=v["enabled"];
  for(size_t i=0;i<7;++i) {
    const auto d=v["days"][i];
    if(!object(d,{"enabled","onMinute","offMinute"})||!d["enabled"].is<bool>()||
       !integer(d["onMinute"],0,1439)||!integer(d["offMinute"],0,1439)) return false;
    s.days[i]={d["enabled"].as<bool>(),d["onMinute"].as<uint16_t>(),d["offMinute"].as<uint16_t>()};
  }
  const auto z=v["timezone"];
  s.hasTimezone=!z.isNull();
  if(s.hasTimezone) {
    if(!object(z,{"id","fromUtc","untilUtc","initialOffsetSeconds","transitions"})||
       !z["id"].is<const char*>()||!integer(z["fromUtc"],kUtcStart,kUtcEnd-1)||
       !integer(z["untilUtc"],kUtcStart+1,kUtcEnd)||!integer(z["initialOffsetSeconds"],-50400,50400)||
       !z["transitions"].is<JsonArrayConst>()||z["transitions"].size()>kMaxTransitions) return false;
    const auto name=z["id"].as<JsonString>();
    if(!name.size()||name.size()>64||strlen(name.c_str())!=name.size()) return false;
    memcpy(s.timezone.id,name.c_str(),name.size()+1);
    s.timezone.fromUtc=z["fromUtc"]; s.timezone.untilUtc=z["untilUtc"];
    s.timezone.initialOffsetSeconds=z["initialOffsetSeconds"];
    for(JsonVariantConst t:z["transitions"].as<JsonArrayConst>()) {
      if(!object(t,{"atUtc","offsetSeconds"})||!integer(t["atUtc"],kUtcStart,kUtcEnd-1)||
         !integer(t["offsetSeconds"],-50400,50400)) return false;
      s.timezone.transitions[s.timezone.count++]={t["atUtc"].as<int64_t>(),t["offsetSeconds"].as<int32_t>()};
    }
  }
  if(!validateSchedule(s)) return false;
  out=s; return true;
}
void writeSchedule(JsonObject out,const ScheduleV1& s) {
  out["version"]=1; out["enabled"]=s.enabled;
  if(s.hasTimezone) {
    auto z=out.createNestedObject("timezone");
    z["id"]=s.timezone.id; z["fromUtc"]=s.timezone.fromUtc; z["untilUtc"]=s.timezone.untilUtc;
    z["initialOffsetSeconds"]=s.timezone.initialOffsetSeconds;
    auto transitions=z.createNestedArray("transitions");
    for(size_t i=0;i<s.timezone.count;++i) {
      auto t=transitions.createNestedObject(); t["atUtc"]=s.timezone.transitions[i].atUtc;
      t["offsetSeconds"]=s.timezone.transitions[i].offsetSeconds;
    }
  } else out["timezone"]=nullptr;
  auto days=out.createNestedArray("days");
  for(const auto& d:s.days) {
    auto day=days.createNestedObject(); day["enabled"]=d.enabled;
    day["onMinute"]=d.onMinute; day["offMinute"]=d.offMinute;
  }
}
}
