#pragma once
#include "Admin.h"
#include "NetworkManager.h"
#include "OtaUpdater.h"
#include "ClockService.h"
#include <functional>

class DeviceControl {
 public:
  DeviceControl(SettingsStore& s,pixies::SettingsState& c,LedOutput& l,NetworkManager& n):
    store(s),settings(c),leds(l),network(n),admin(s),ota(l) {}
  void begin();
  bool tick(uint32_t);
  void config(JsonDocument&);
  void status(JsonDocument&);
  void ledStatus(JsonObject);
  void powerStatus(JsonObject);
  void scheduleTick(uint32_t);
  void scheduleStatus(JsonObject);
  void scheduleResponse(JsonDocument&);
  int execute(const char*,JsonVariantConst,JsonDocument&);
  void restartLater();
  bool resetAll();
  SettingsStore& store;
  pixies::SettingsState& settings;
  LedOutput& leds;
  NetworkManager& network;
  Admin admin;
  OtaUpdater ota;
  String bootId;
  bool restarting=false;
  uint32_t restartAt=0;
  uint32_t powerRevision=1;
  uint32_t scheduleRevision=1;
  ClockService clock;
  pixies::ScheduleRuntime schedule;
  std::function<bool()> clearBonds;
};
