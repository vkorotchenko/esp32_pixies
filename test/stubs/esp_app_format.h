#pragma once
#include <cstdint>
constexpr int ESP_CHIP_ID_ESP32S3=9,ESP_IMAGE_FLASH_SIZE_16MB=4;
struct __attribute__((packed)) esp_image_header_t {
  uint8_t magic,segment_count,spi_mode,spi_speed:4,spi_size:4;
  uint32_t entry;
  uint8_t wp,drive[3];
  uint16_t chip_id;
  uint8_t minRev;
  uint16_t minFull,maxFull;
  uint8_t reserved[4],hash_appended;
};
struct esp_image_segment_header_t { uint32_t address,length; };
struct esp_app_desc_t { uint32_t magic_word,secure_version; uint8_t padding[248]; };
static_assert(sizeof(esp_image_header_t)==24&&sizeof(esp_app_desc_t)==256,"ESP test wire structures");
