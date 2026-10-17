#pragma once
#include "Core.h"
#include <ArduinoJson.h>
namespace pixies {
constexpr size_t kJsonCapacity=16384, kMaxBody=8192;
bool readSettings(JsonVariantConst, Settings&, const char*& field);
void writeSettings(JsonObject, const Settings&);
bool readPowerSettings(JsonVariantConst, PowerSettings&, const char*& field);
void writePowerSettings(JsonObject, const PowerSettings&);
void writePalette(JsonObject, const Palette&, bool builtin);
bool keysOnly(JsonObjectConst, const char* const*, size_t);
bool completeJsonObject(const char*,size_t);
}
