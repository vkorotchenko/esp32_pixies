#pragma once
#include <Core.h>
#include <NeoPixelBus.h>
#include "config.h"
#if PIXIES_COLOR_GRB
using PixiesColorFeature=NeoGrbFeature;
#else
using PixiesColorFeature=NeoRgbFeature;
#endif
class PixiesBus : public NeoPixelBus<PixiesColorFeature,NeoEsp32Rmt0Ws2812xMethod> {
 public:
  using NeoPixelBus<PixiesColorFeature,NeoEsp32Rmt0Ws2812xMethod>::NeoPixelBus;
  bool buffersInternal();
};
class LedOutput {
 public:
  bool begin(uint16_t count);
  void tick(const pixies::Settings&,uint32_t now);
  void blank();
  void resume() { paused_=false; }
  pixies::Power power;
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
