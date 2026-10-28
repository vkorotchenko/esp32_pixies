#pragma once
#include "Schedule.h"
#include <ArduinoJson.h>
namespace pixies {
bool readSchedule(JsonVariantConst,ScheduleV1&);
void writeSchedule(JsonObject,const ScheduleV1&);
}
