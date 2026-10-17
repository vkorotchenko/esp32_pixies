#include "OtaUpdater.h"
#include <esp_app_format.h>
#include <esp_image_format.h>
#include <algorithm>
#include <cstring>
size_t OtaUpdater::slotSize() const {
  const auto* p=esp_ota_get_next_update_partition(nullptr);
  return p ? p->size : 0;
}
bool OtaUpdater::authorized(OtaOwner owner) const {
  const auto& check=owner==OtaOwner::Http?guard:bleGuard;
  return check&&check();
}
bool OtaUpdater::begin(size_t length,OtaOwner owner,const char* sha256) {
  // This is also checked at EVERY chunk/end/select callback, not just the route.
  if(!authorized(owner)) return false;
  if(!pixies::otaStartAllowed(true,busy,length,slotSize())) { error="invalid_size_or_busy"; return false; }
  if(owner==OtaOwner::Ble&&!sha256) { error="missing_checksum"; return false; }
  if(sha256) {
    if(strlen(sha256)!=64) { error="invalid_checksum"; return false; }
    for(size_t i=0;i<64;++i) {
      const char c=sha256[i];
      const int digit=c>='0'&&c<='9'?c-'0':c>='a'&&c<='f'?c-'a'+10:-1;
      if(digit<0) { error="invalid_checksum"; return false; }
      if(i%2) expectedHash_[i/2]|=uint8_t(digit);
      else expectedHash_[i/2]=uint8_t(digit<<4);
    }
  }
  target_=esp_ota_get_next_update_partition(nullptr);
  const auto* running=esp_ota_get_running_partition();
  if(!target_||!running||target_==running||target_->address==running->address||
     target_->size!=0x700000||running->size!=0x700000||
     (target_->address!=0x10000&&target_->address!=0x710000)||
     (running->address!=0x10000&&running->address!=0x710000)||
     ESP.getFlashChipSize()!=16U*1024U*1024U) { error="partition_layout"; return false; }
  if(!transfer_.begin(length,target_->size)) { error="invalid_size"; return false; }
  owner_=owner; hashing_=sha256!=nullptr;
  if(hashing_&&mbedtls_sha256_starts_ret(&hash_,0)!=0) { error="checksum_unavailable"; return false; }
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
  if(!pixies::supportedImage(identity)) { abort("unsupported_image",owner_); return false; }
  if(!authorized(owner_)) { abort("authorization_lost",owner_); return false; }
  if(esp_ota_begin(target_,transfer_.expected,&handle_)!=ESP_OK) { abort("flash_begin_failed",owner_); return false; }
  writing_=true; state="writing";
  if(esp_ota_write(handle_,prefix_,sizeof prefix_)!=ESP_OK) { abort("flash_write_failed",owner_); return false; }
  return true;
}
bool OtaUpdater::chunk(const uint8_t* bytes,size_t n,OtaOwner owner) {
  if(!owns(owner)) return false;
  if(!authorized(owner)) { abort("authorization_lost",owner); return false; }
  if(!bytes||!n||!transfer_.chunk(n)) { abort("length_mismatch",owner); return false; }
  if(hashing_&&mbedtls_sha256_update_ret(&hash_,bytes,n)!=0) { abort("checksum_failed",owner); return false; }
  if(prefixSize_<sizeof prefix_) {
    const size_t take=std::min(n,sizeof prefix_-prefixSize_);
    memcpy(prefix_+prefixSize_,bytes,take); prefixSize_+=take; bytes+=take; n-=take;
    if(prefixSize_==sizeof prefix_&&!startFlash()) return false;
  }
  if(n&&writing_&&esp_ota_write(handle_,bytes,n)!=ESP_OK) { abort("flash_write_failed",owner); return false; }
  return true;
}
bool OtaUpdater::end(OtaOwner owner) {
  if(!owns(owner)) return false;
  if(!authorized(owner)) { abort("authorization_lost",owner); return false; }
  if(!writing_||!transfer_.complete(true)) { abort("truncated_image",owner); return false; }
  if(hashing_) {
    uint8_t actual[32]{};
    if(mbedtls_sha256_finish_ret(&hash_,actual)!=0) { abort("checksum_failed",owner); return false; }
    uint8_t difference=0;
    for(size_t i=0;i<sizeof actual;++i) difference|=actual[i]^expectedHash_[i];
    if(difference) { abort("checksum_mismatch",owner); return false; }
  }
  state="validating";
  const esp_err_t result=esp_ota_end(handle_); writing_=false; handle_=0;
  if(result!=ESP_OK) { abort("invalid_image",owner); return false; }
  esp_image_metadata_t metadata{};
  const esp_partition_pos_t pos{target_->address,target_->size};
  if(esp_image_verify(ESP_IMAGE_VERIFY_SILENT,&pos,&metadata)!=ESP_OK||
      metadata.image_len!=transfer_.received) { abort("invalid_image_length",owner); return false; }
  validated=true; state="validated"; return true;
}
bool OtaUpdater::select(OtaOwner owner) {
  if(!owns(owner)) return false;
  if(!authorized(owner)) { abort("authorization_lost",owner); return false; }
  if(!validated||!target_) return false;
  // Only this branch touches otadata, after complete validation and auth.
  if(esp_ota_set_boot_partition(target_)!=ESP_OK) { abort("boot_select_failed",owner); return false; }
  state="restarting"; return true;
}
bool OtaUpdater::abort(const char* reason,OtaOwner owner) {
  if(!owns(owner)) return false;
  if(writing_) esp_ota_abort(handle_);
  handle_=0; writing_=false; validated=false; busy=false;
  transfer_.failed=true; error=reason; state="failed"; leds_.resume();
  return true;
}
