#pragma once
#include <Core.h>
#include <esp_ota_ops.h>
#include <functional>
#include <mbedtls/sha256.h>
#include "LedOutput.h"
enum class OtaOwner { Http, Ble };
class OtaUpdater {
 public:
  explicit OtaUpdater(LedOutput& leds):leds_(leds) { mbedtls_sha256_init(&hash_); }
  ~OtaUpdater() { mbedtls_sha256_free(&hash_); }
  std::function<bool()> guard,bleGuard;
  bool begin(size_t,OtaOwner owner=OtaOwner::Http,const char* sha256=nullptr);
  bool chunk(const uint8_t*,size_t,OtaOwner owner=OtaOwner::Http);
  bool end(OtaOwner owner=OtaOwner::Http);
  bool select(OtaOwner owner=OtaOwner::Http);
  bool abort(const char* reason="transfer_aborted",OtaOwner owner=OtaOwner::Http);
  bool owns(OtaOwner owner) const { return busy&&owner_==owner; }
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
  OtaOwner owner_=OtaOwner::Http;
  mbedtls_sha256_context hash_{};
  uint8_t expectedHash_[32]{};
  bool hashing_=false;
  bool authorized(OtaOwner owner) const;
  bool startFlash();
};
