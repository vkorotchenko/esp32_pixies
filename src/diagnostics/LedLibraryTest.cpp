#include <Arduino.h>
#include "config.h"

#if defined(PIXIES_DIAGNOSTIC_ADAFRUIT) == defined(PIXIES_DIAGNOSTIC_FASTLED)
#error "Select exactly one diagnostic LED library"
#endif

#if defined(PIXIES_DIAGNOSTIC_400KHZ) && !defined(PIXIES_DIAGNOSTIC_ADAFRUIT)
#error "The 400kHz diagnostic requires Adafruit NeoPixel"
#endif

#ifndef PIN_NEOPIXEL
#error "The diagnostic board must define its physical onboard RGB LED pin"
#endif

#if defined(PIXIES_DIAGNOSTIC_ADAFRUIT)
#include <Adafruit_NeoPixel.h>
#else
#include <FastLED.h>
#endif

namespace {
constexpr uint16_t kLedCount=50;
constexpr uint8_t kChannelLevel=16;
constexpr uint8_t kOnboardPin=PIN_NEOPIXEL;
constexpr uint8_t kOnboardLevel=8;
constexpr uint32_t kPhaseMs=4000;
constexpr uint32_t kFrameMs=33;
#if defined(PIXIES_DIAGNOSTIC_400KHZ)
constexpr uint16_t kSignalKHz=400;
#else
constexpr uint16_t kSignalKHz=800;
#endif
static_assert(kOnboardPin!=PIXIES_LED_PIN,"Onboard indicator conflicts with the external LED string");
const char* const kPhases[]{"red","green","blue","off"};
uint8_t phase=0;
uint32_t phaseStarted=0,lastFrame=0,frames=0;

#if defined(PIXIES_DIAGNOSTIC_ADAFRUIT)
constexpr const char* kLibrary="Adafruit NeoPixel 1.15.5";
constexpr const char* kOnboardColor=kSignalKHz==400?"yellow":"purple";
constexpr uint8_t kOnboardRed=kOnboardLevel,kOnboardGreen=kSignalKHz==400?kOnboardLevel:0;
constexpr uint8_t kOnboardBlue=kSignalKHz==400?0:kOnboardLevel;
Adafruit_NeoPixel pixels(kLedCount,PIXIES_LED_PIN,NEO_RGB+(kSignalKHz==400?NEO_KHZ400:NEO_KHZ800));
Adafruit_NeoPixel onboard(1,kOnboardPin,NEO_GRB+NEO_KHZ800);
#else
constexpr const char* kLibrary="FastLED 3.9.20";
constexpr const char* kOnboardColor="cyan";
constexpr uint8_t kOnboardRed=0,kOnboardGreen=kOnboardLevel;
constexpr uint8_t kOnboardBlue=kOnboardLevel;
CRGB pixels[kLedCount];
CRGB onboard[1];
#endif

void writeFrame(uint8_t selected) {
  const uint8_t red=selected==0?kChannelLevel:0;
  const uint8_t green=selected==1?kChannelLevel:0;
  const uint8_t blue=selected==2?kChannelLevel:0;
#if defined(PIXIES_DIAGNOSTIC_ADAFRUIT)
  for(uint16_t i=0;i<kLedCount;++i) pixels.setPixelColor(i,red,green,blue);
  pixels.show();
#else
  fill_solid(pixels,kLedCount,CRGB(red,green,blue));
  FastLED.show();
#endif
  ++frames;
}

void printPhase() {
  Serial.printf("LED_DIAG library=%s; phase=%s; frames=%lu\n",
    kLibrary,kPhases[phase],static_cast<unsigned long>(frames));
}
}

void setup() {
  Serial.begin(115200);
#if defined(PIXIES_DIAGNOSTIC_ADAFRUIT)
  if(!pixels.begin()||pixels.numPixels()!=kLedCount||!onboard.begin()||onboard.numPixels()!=1) {
    for(;;) {
      Serial.println("LED_DIAG ERROR: external or onboard LED initialization failed; test stopped");
      delay(1000);
    }
  }
  onboard.setPixelColor(0,kOnboardRed,kOnboardGreen,kOnboardBlue);
  onboard.show();
#else
  FastLED.addLeds<WS2811,PIXIES_LED_PIN,RGB>(pixels,kLedCount);
  FastLED.addLeds<WS2812B,kOnboardPin,GRB>(onboard,1);
  onboard[0]=CRGB(kOnboardRed,kOnboardGreen,kOnboardBlue);
  FastLED.setBrightness(255);
  FastLED.setMaxPowerInVoltsAndMilliamps(5,500);
#endif
  writeFrame(3);
  Serial.printf("LED_DIAG standalone; GPIO=%u; pixels=%u; RGB/%ukHz; channel=%u/255; phaseMs=%lu\n",
    unsigned(PIXIES_LED_PIN),unsigned(kLedCount),unsigned(kSignalKHz),unsigned(kChannelLevel),
    static_cast<unsigned long>(kPhaseMs));
  Serial.printf("LED_DIAG onboard; GPIO=%u; color=%s; RGB=(%u,%u,%u)\n",
    unsigned(kOnboardPin),kOnboardColor,unsigned(kOnboardRed),
    unsigned(kOnboardGreen),unsigned(kOnboardBlue));
  Serial.println("LED_DIAG Bluetooth/Wi-Fi disabled; saved settings untouched");
  phaseStarted=millis();
  printPhase();
}

void loop() {
  const uint32_t now=millis();
  if(uint32_t(now-phaseStarted)>=kPhaseMs) {
    phase=uint8_t((phase+1)%4);
    phaseStarted=now;
    printPhase();
  }
  if(uint32_t(now-lastFrame)>=kFrameMs) {
    lastFrame=now;
    writeFrame(phase);
  }
  delay(1);
}
