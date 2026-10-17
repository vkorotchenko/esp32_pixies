#pragma once
#include <cstdint>
#include <cstddef>
struct NeoGrbFeature {};
struct NeoRgbFeature {};
struct NeoEsp32Rmt0Ws2812xMethod {};
template<class Feature,class Method> class NeoPixelBus {
 public:
  NeoPixelBus(uint16_t,uint8_t) {}
};
