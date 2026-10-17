#pragma once
#include <Core.h>
#include <esp_ota_ops.h>
#include <functional>
#include "LedOutput.h"
class OtaUpdater {
 public:
  explicit OtaUpdater(LedOutput& leds):leds_(leds) {}
  std::function<bool()> guard;
  bool begin(size_t);
  bool chunk(const uint8_t*,size_t);
  bool end();
  bool select();
  void abort(const char* reason="transfer_aborted");
  bool busy=false,validated=false;
  const char* state="idle";
  const char* error="";
  size_t expected() const { return transfer_.expected; }
  size_t received() const { return transfer_.received; }
  size_t slotSize() const;
 private:
  LedOutput& leds_;
  const esp_partition_t* target_=nullptr;
  esp_ota_handle_t handle_=0;
  bool writing_=false;
  pixies::OtaTransfer transfer_;
  uint8_t prefix_[288]{};
  size_t prefixSize_=0;
  bool startFlash();
};
