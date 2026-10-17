#pragma once
#include <cstdint>
#include <cstddef>
#include "TestEsp.h"
using esp_err_t=int;
using esp_ota_handle_t=uint32_t;
constexpr int ESP_OK=0;
struct esp_partition_t { uint32_t address,size; };
struct esp_partition_pos_t { uint32_t offset,size; };
namespace fake_ota {
inline esp_partition_t running{0x10000,0x700000}, target{0x710000,0x700000};
inline unsigned begins=0,writes=0,ends=0,selects=0,aborts=0;
inline size_t bytes=0,verifiedLength=1024;
inline int beginError=0,writeError=0,endError=0,verifyError=0,selectError=0;
inline void reset() {
  begins=writes=ends=selects=aborts=0; bytes=0; verifiedLength=1024;
  beginError=writeError=endError=verifyError=selectError=0;
}
}
inline const esp_partition_t* esp_ota_get_next_update_partition(const void*) { return &fake_ota::target; }
inline const esp_partition_t* esp_ota_get_running_partition() { return &fake_ota::running; }
inline int esp_ota_begin(const esp_partition_t*,size_t,esp_ota_handle_t* h) { ++fake_ota::begins; *h=1; return fake_ota::beginError; }
inline int esp_ota_write(esp_ota_handle_t,const void*,size_t n) { ++fake_ota::writes; fake_ota::bytes+=n; return fake_ota::writeError; }
inline int esp_ota_end(esp_ota_handle_t) { ++fake_ota::ends; return fake_ota::endError; }
inline int esp_ota_set_boot_partition(const esp_partition_t*) { ++fake_ota::selects; return fake_ota::selectError; }
inline int esp_ota_abort(esp_ota_handle_t) { ++fake_ota::aborts; return 0; }
