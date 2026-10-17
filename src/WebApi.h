#pragma once
#include "DeviceControl.h"
#include "BoundedWebServer.h"
#include "NetworkManager.h"
#include "OtaUpdater.h"
class WebApi {
 public:
  explicit WebApi(DeviceControl& device):
    device_(device),store_(device.store),settings_(device.settings),leds_(device.leds),network_(device.network),
    admin_(device.admin),ota_(device.ota),bootId_(device.bootId),restartScheduled_(device.restarting),restartAt_(device.restartAt) {}
  void begin();
  void tick(uint32_t);
 private:
  DeviceControl& device_;
  SettingsStore& store_;
  pixies::SettingsState& settings_;
  LedOutput& leds_;
  NetworkManager& network_;
  Admin& admin_;
  OtaUpdater& ota_;
  BoundedWebServer server_;
  String& bootId_;
  bool& restartScheduled_;
  uint32_t& restartAt_;
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
  void invoke(const char*,JsonVariantConst=JsonVariantConst());
  void session(bool newlyAuthenticated=false);
  void restartLater();
};
