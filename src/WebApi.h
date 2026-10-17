#pragma once
#include "Admin.h"
#include "BoundedWebServer.h"
#include "NetworkManager.h"
#include "OtaUpdater.h"
class WebApi {
 public:
  WebApi(SettingsStore& store,pixies::SettingsState& settings,LedOutput& leds,NetworkManager& network):
    store_(store),settings_(settings),leds_(leds),network_(network),admin_(store),ota_(leds) {}
  void begin();
  void tick(uint32_t);
 private:
  SettingsStore& store_;
  pixies::SettingsState& settings_;
  LedOutput& leds_;
  NetworkManager& network_;
  Admin admin_;
  OtaUpdater ota_;
  BoundedWebServer server_;
  String bootId_;
  bool restartScheduled_=false;
  uint32_t restartAt_=0;
  bool originValid() const;
  bool requestGate();
  bool adminGuard(bool csrf=true);
  bool uploadGuard();
  void headers();
  void error(int,const char*,const char*,const char* field=nullptr);
  void json(int,JsonDocument&);
  bool body(JsonDocument&,const char* const*,size_t);
  bool idle();
  bool revision(JsonVariantConst);
  void config();
  void status();
  void session(bool newlyAuthenticated=false);
  void restartLater();
};
