#pragma once
#include <array>
#include <cstddef>
#include <cstdint>

namespace pixies::ble {
constexpr size_t kHeader=8, kMaxMessage=8192, kMaxPacket=244;
constexpr uint32_t kTimeoutMs=30000;
constexpr const char* kService="9a77e401-8c5b-4c3b-908a-6c749f662800";
constexpr const char* kRx="9a77e402-8c5b-4c3b-908a-6c749f662800";
constexpr const char* kTx="9a77e403-8c5b-4c3b-908a-6c749f662800";
enum class Result { Partial, Complete, Invalid, Busy };
uint16_t read16(const uint8_t*);
size_t packet(const uint8_t*,size_t,uint16_t,bool,size_t,uint8_t*,size_t);
class Receiver {
 public:
  Result push(const uint8_t*,size_t,uint32_t,bool response=false);
  bool expired(uint32_t now) const;
  void reset();
  uint16_t id() const { return id_; }
  size_t size() const { return used_; }
  char* data() { return reinterpret_cast<char*>(data_.data()); }
 private:
  std::array<uint8_t,kMaxMessage+1> data_{};
  size_t used_=0,total_=0;
  uint16_t id_=0;
  uint32_t started_=0;
};
}
