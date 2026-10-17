#include "OtaUpdater.h"
#include <esp_app_format.h>
#include <esp_image_format.h>
#include <algorithm>
#include <cstring>
size_t OtaUpdater::slotSize() const {
  const auto* p=esp_ota_get_next_update_partition(nullptr);
  return p ? p->size : 0;
}
bool OtaUpdater::begin(size_t length) {
  // This is also checked at EVERY chunk/end/select callback, not just the route.
  if(!guard||!guard()) return false;
  if(!pixies::otaStartAllowed(true,busy,length,slotSize())) { error="invalid_size_or_busy"; return false; }
  target_=esp_ota_get_next_update_partition(nullptr);
  const auto* running=esp_ota_get_running_partition();
  if(!target_||!running||target_==running||target_->address==running->address||
     target_->size!=0x700000||running->size!=0x700000||
     (target_->address!=0x10000&&target_->address!=0x710000)||
     (running->address!=0x10000&&running->address!=0x710000)||
     ESP.getFlashChipSize()!=16U*1024U*1024U) { error="partition_layout"; return false; }
  if(!transfer_.begin(length,target_->size)) { error="invalid_size"; return false; }
  prefixSize_=0; handle_=0; writing_=false; validated=false;
  busy=true; state="receiving"; error=""; leds_.blank(); return true;
}
bool OtaUpdater::startFlash() {
  esp_image_header_t header; esp_app_desc_t desc;
  memcpy(&header,prefix_,sizeof header);
  memcpy(&desc,prefix_+sizeof(esp_image_header_t)+sizeof(esp_image_segment_header_t),sizeof desc);
  static_assert(ESP_CHIP_ID_ESP32S3==9&&ESP_IMAGE_FLASH_SIZE_16MB==4,"Update pure image identity constants");
  const pixies::ImageIdentity identity{header.magic,header.segment_count,header.spi_size,
    header.hash_appended,uint16_t(header.chip_id),desc.magic_word,desc.secure_version};
  if(!pixies::supportedImage(identity)) { abort("unsupported_image"); return false; }
  if(!guard||!guard()) { abort("authorization_lost"); return false; }
  if(esp_ota_begin(target_,transfer_.expected,&handle_)!=ESP_OK) { abort("flash_begin_failed"); return false; }
  writing_=true; state="writing";
  if(esp_ota_write(handle_,prefix_,sizeof prefix_)!=ESP_OK) { abort("flash_write_failed"); return false; }
  return true;
}
bool OtaUpdater::chunk(const uint8_t* bytes,size_t n) {
  if(!guard||!guard()) { abort("authorization_lost"); return false; }
  if(!busy||!transfer_.chunk(n)) { abort("length_mismatch"); return false; }
  if(prefixSize_<sizeof prefix_) {
    const size_t take=std::min(n,sizeof prefix_-prefixSize_);
    memcpy(prefix_+prefixSize_,bytes,take); prefixSize_+=take; bytes+=take; n-=take;
    if(prefixSize_==sizeof prefix_&&!startFlash()) return false;
  }
  if(n&&writing_&&esp_ota_write(handle_,bytes,n)!=ESP_OK) { abort("flash_write_failed"); return false; }
  return true;
}
bool OtaUpdater::end() {
  if(!guard||!guard()) { abort("authorization_lost"); return false; }
  if(!busy||!writing_||!transfer_.complete(true)) { abort("truncated_image"); return false; }
  state="validating";
  const esp_err_t result=esp_ota_end(handle_); writing_=false; handle_=0;
  if(result!=ESP_OK) { abort("invalid_image"); return false; }
  esp_image_metadata_t metadata{};
  const esp_partition_pos_t pos{target_->address,target_->size};
  if(esp_image_verify(ESP_IMAGE_VERIFY_SILENT,&pos,&metadata)!=ESP_OK||
      metadata.image_len!=transfer_.received) { abort("invalid_image_length"); return false; }
  validated=true; state="validated"; return true;
}
bool OtaUpdater::select() {
  if(!guard||!guard()) { abort("authorization_lost"); return false; }
  if(!busy||!validated||!target_) return false;
  // Only this branch touches otadata, after complete validation and auth.
  if(esp_ota_set_boot_partition(target_)!=ESP_OK) { abort("boot_select_failed"); return false; }
  state="restarting"; return true;
}
void OtaUpdater::abort(const char* reason) {
  if(writing_) esp_ota_abort(handle_);
  handle_=0; writing_=false; validated=false; busy=false;
  transfer_.failed=true; error=reason; state="failed"; leds_.resume();
}
