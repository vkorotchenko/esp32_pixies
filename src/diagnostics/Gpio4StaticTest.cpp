#include <Arduino.h>
#include <esp_err.h>

// Linked only in this diagnostic: skip NVS and Arduino's erase-on-init-error recovery.
extern "C" esp_err_t __wrap_nvs_flash_init(void) {
  return ESP_OK;
}

namespace {
constexpr uint8_t kPin=4;
constexpr uint32_t kPhaseMs=5000;
bool high=false;
uint32_t phaseStarted=0;

void printLevel(uint32_t now) {
  Serial.printf("GPIO4_DIAG t_ms=%lu; GPIO4=%s; phase_ms=%lu\n",
    static_cast<unsigned long>(now),high?"HIGH":"LOW",
    static_cast<unsigned long>(kPhaseMs));
}
}

void setup() {
  pinMode(kPin,OUTPUT);
  digitalWrite(kPin,LOW);
  phaseStarted=millis();
  Serial.begin(115200);
  Serial.println("GPIO4_DIAG static 3.3V output; HIGH 5000ms / LOW 5000ms; starts LOW");
  printLevel(phaseStarted);
}

void loop() {
  const uint32_t now=millis();
  if(uint32_t(now-phaseStarted)>=kPhaseMs) {
    high=!high;
    digitalWrite(kPin,high?HIGH:LOW);
    phaseStarted=now;
    printLevel(now);
  }
  delay(1);
}
