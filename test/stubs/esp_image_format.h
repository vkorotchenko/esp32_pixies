#pragma once
#include "esp_ota_ops.h"
constexpr int ESP_IMAGE_VERIFY_SILENT=1;
struct esp_image_metadata_t { uint32_t image_len=0; };
inline int esp_image_verify(int,const esp_partition_pos_t*,esp_image_metadata_t* out) {
  out->image_len=fake_ota::verifiedLength; return fake_ota::verifyError;
}
