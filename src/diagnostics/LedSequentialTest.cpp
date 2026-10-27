#include <Arduino.h>
#include <esp_err.h>

#if defined(PIXIES_DIAGNOSTIC_FASTLED) == defined(PIXIES_DIAGNOSTIC_NEOPIXELBUS)
#error "Select exactly one sequential diagnostic LED library"
#endif

#if defined(PIXIES_DIAGNOSTIC_NEOPIXELBUS)
#include <NeoPixelBus.h>
#else
#include <FastLED.h>
#endif
#include "config.h"

// Linked only in this diagnostic: skip NVS and Arduino's erase-on-init-error recovery.
extern "C" esp_err_t __wrap_nvs_flash_init(void) {
  return ESP_OK;
}

namespace {
constexpr uint16_t kLedCount=50;
constexpr uint8_t kChannelLevel=16;
constexpr uint32_t kHoldMs=1000;
#if defined(PIXIES_DIAGNOSTIC_NEOPIXELBUS)
constexpr const char* kLibrary="NeoPixelBus 2.8.4";
NeoPixelBus<NeoRgbFeature,NeoEsp32Rmt0Ws2811Method> pixels(kLedCount,PIXIES_LED_PIN);
#else
constexpr const char* kLibrary="FastLED 3.9.20";
CRGB pixels[kLedCount];
#endif
uint16_t position=0;
uint32_t positionStarted=0;

void showPosition() {
#if defined(PIXIES_DIAGNOSTIC_NEOPIXELBUS)
  pixels.ClearTo(RgbColor(0));
  pixels.SetPixelColor(position,RgbColor(kChannelLevel,0,0));
  pixels.Show();
#else
  fill_solid(pixels,kLedCount,CRGB::Black);
  pixels[position]=CRGB(kChannelLevel,0,0);
  FastLED.show();
#endif
  Serial.printf("LED_SEQ position=%u/%u\n",unsigned(position+1),unsigned(kLedCount));
}
}

void setup() {
  Serial.begin(115200);
#if defined(PIXIES_DIAGNOSTIC_NEOPIXELBUS)
  pixels.Begin();
#else
  FastLED.addLeds<WS2811,PIXIES_LED_PIN,RGB>(pixels,kLedCount);
  FastLED.setBrightness(255);
  FastLED.setMaxPowerInVoltsAndMilliamps(5,500);
#endif
  Serial.printf("LED_SEQ standalone; library=%s; GPIO=%u; pixels=%u; RGB/800kHz; channel=%u/255; pattern=single-red; holdMs=%lu\n",
    kLibrary,unsigned(PIXIES_LED_PIN),unsigned(kLedCount),unsigned(kChannelLevel),
    static_cast<unsigned long>(kHoldMs));
#if defined(PIXIES_DIAGNOSTIC_NEOPIXELBUS)
  Serial.println("LED_SEQ method=NeoEsp32Rmt0Ws2811Method; order=RGB; protocol=WS2811/800kHz");
#endif
  Serial.println("LED_SEQ Bluetooth/Wi-Fi disabled; saved settings untouched; NVS init bypassed");
  showPosition();
  positionStarted=millis();
}

void loop() {
  const uint32_t now=millis();
  if(uint32_t(now-positionStarted)>=kHoldMs) {
    position=uint16_t((position+1)%kLedCount);
    showPosition();
    positionStarted=millis();
  }
  delay(1);
}
