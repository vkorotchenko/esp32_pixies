#pragma once
#include <cstdint>
namespace fake_esp { inline unsigned restarts=0; }
struct FakeESP {
  uint64_t getEfuseMac() const { return 0x123456789abcULL; }
  uint32_t getFlashChipSize() const { return 16777216; }
  uint32_t getPsramSize() const { return 8388608; }
  uint32_t getFreeHeap() const { return 200000; }
  void restart() const { ++fake_esp::restarts; }
};
inline FakeESP ESP;
