#pragma once
#include <Preferences.h>
#include <SettingsJson.h>
#include <ScheduleJson.h>

struct WifiCredential {
  char ssid[33]{};
  char password[65]{};
};
struct AdminVerifier {
  uint32_t iterations = 60000;
  uint8_t salt[16]{}, hash[32]{};
};
class SettingsStore {
 public:
  const char* settingsRecovery = "missing";
  const char* credentialRecovery = "none";
  const char* powerRecovery = "missing";
  const char* scheduleRecovery = "missing";
  bool begin();
  bool loadSettings(pixies::Settings&);
  bool saveSettings(const pixies::Settings&);
  bool loadPower(pixies::PowerSettings&);
  bool savePower(const pixies::PowerSettings&);
  bool loadSchedule(pixies::ScheduleV1&);
  bool saveSchedule(const pixies::ScheduleV1&);
  bool loadWifi(WifiCredential&);
  bool saveWifi(const WifiCredential&);
  bool loadAdmin(AdminVerifier&);
  bool saveAdmin(const AdminVerifier&);
  bool resetWifi();
  bool factoryReset();
 private:
  Preferences settings_, credentials_;
  bool ready_ = false;
  bool write(Preferences&, const char*, const uint8_t*, size_t);
  bool read(Preferences&, const char*, uint8_t*, size_t, size_t&);
};
