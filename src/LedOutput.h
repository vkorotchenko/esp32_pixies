#pragma once
#include <Core.h>
#include <NeoPixelBus.h>
#include "config.h"
#if PIXIES_COLOR_GRB
using PixiesColorFeature=NeoGrbFeature;
#else
using PixiesColorFeature=NeoRgbFeature;
#endif
#if PIXIES_LED_WS2811
using PixiesOutputMethod=NeoEsp32Rmt0Ws2811Method;
#else
using PixiesOutputMethod=NeoEsp32Rmt0Ws2812xMethod;
#endif
class PixiesBus : public NeoPixelBus<PixiesColorFeature,PixiesOutputMethod> {
 public:
  using NeoPixelBus<PixiesColorFeature,PixiesOutputMethod>::NeoPixelBus;
  bool buffersInternal();
};
class LedOutput {
 public:
  bool begin(uint16_t count);
  void tick(const pixies::Settings&,uint32_t now,bool effectiveOn);
  void blank();
  void resume() { paused_=false; }
  pixies::Power power;
  pixies::PowerSettings powerSettings;
  bool powerReady=false;
  uint32_t powerBudgetMa() const {
    return powerReady ? pixies::powerBudgetMa(powerSettings,PIXIES_CURRENT_MA) : 0;
  }
  uint32_t frames=0;
  bool ready=false;
 private:
  // RMT method owns its internal transport buffer; only RGB staging is here.
  PixiesBus* bus_=nullptr;
  pixies::Rgb* frame_=nullptr;
  uint16_t count_=0;
  uint32_t lastFrame_=0;
  bool paused_=false;
  pixies::Clock clock_;
};
