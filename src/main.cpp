#include <Arduino.h>
#include "config.h"
#include "WebApi.h"
#include "BleControl.h"

SettingsStore store;
pixies::SettingsState settings;
LedOutput leds;
NetworkManager network(store);
DeviceControl control(store,settings,leds,network);
WebApi api(control);
BleControl bluetooth(control);
char usbCommand[12]{};
size_t usbCommandSize=0;
void usbTick() {
  unsigned budget=16;
  while(Serial.available()&&budget--) {
    const char c=Serial.read();
    if(c=='\n'||c=='\r') {
      if(!strcmp(usbCommand,"setup")) network.printSetupLocally();
      else if(!strcmp(usbCommand,"ledstatus")) {
        StaticJsonDocument<1024> doc;
        control.ledStatus(doc.to<JsonObject>());
        Serial.print("Pixies LED status: "); serializeJson(doc,Serial); Serial.println();
      }
      memset(usbCommand,0,sizeof usbCommand); usbCommandSize=0;
    } else if(usbCommandSize<sizeof(usbCommand)-1) usbCommand[usbCommandSize++]=c;
  }
}

#if PIXIES_RECOVERY_PIN >= 0
// Opt-in carrier-specific active-low switch. Begin sampling AFTER boot; holding
// GPIO0 while resetting is ROM download mode and cannot execute this gesture.
bool recoveryHeld=false,recoveryDone=false;
uint32_t recoverySince=0;
void recoveryTick(uint32_t now) {
  if(recoveryDone||now<3000) return;
  if(digitalRead(PIXIES_RECOVERY_PIN)==LOW) {
    if(!recoveryHeld) { recoveryHeld=true; recoverySince=now; }
    if(pixies::elapsed(now,recoverySince,10000)) {
      recoveryDone=true;
      if(control.resetAll()) { Serial.println("Physical factory recovery complete; restarting."); ESP.restart(); }
      else Serial.println("Physical recovery failed: NVS error. Use USB recovery.");
    }
  } else recoveryHeld=false;
}
#endif
void setup() {
  Serial.begin(115200); // Never wait for a serial host; lighting is independent.
  store.begin();
  pixies::Settings saved;
  store.loadSettings(saved); settings.restore(saved);
  leds.begin(settings.activeCount);
  Serial.printf("Pixies %s / %s; flash=%u, PSRAM=%u; settings=%s; LEDs=%s\n",
    PIXIES_VERSION,PIXIES_TARGET,ESP.getFlashChipSize(),ESP.getPsramSize(),store.settingsRecovery,
    leds.ready?"ready":"unavailable");
#if PIXIES_RECOVERY_PIN >= 0
  pinMode(PIXIES_RECOVERY_PIN,INPUT_PULLUP);
#endif
  network.begin(); api.begin();
  if(bluetooth.begin(PIXIES_BLE_NAME)) Serial.println("Pixies BLE ready.");
  else Serial.println("Pixies BLE unavailable; use the local website or USB recovery.");
}
void loop() {
  const uint32_t now=millis();
  leds.tick(settings.live,now);
  network.tick(now);
  bluetooth.tick(now);
  api.tick(now);
  usbTick();
#if PIXIES_RECOVERY_PIN >= 0
  recoveryTick(now);
#endif
  yield();
}
