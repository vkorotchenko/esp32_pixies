#pragma once
#include "Core.h"
#include <ArduinoJson.h>
namespace pixies {
constexpr size_t kJsonCapacity=16384, kMaxBody=8192;
bool readSettings(JsonVariantConst, Settings&, const char*& field);
void writeSettings(JsonObject, const Settings&);
void writePalette(JsonObject, const Palette&, bool builtin);
bool keysOnly(JsonObjectConst, const char* const*, size_t);
bool completeJsonObject(const char*,size_t);
}
