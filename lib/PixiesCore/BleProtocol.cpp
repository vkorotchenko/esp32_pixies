#include "BleProtocol.h"
#include "Core.h"
#include <algorithm>
#include <cstring>

namespace pixies::ble {
uint16_t read16(const uint8_t* p) { return uint16_t(p[0])|(uint16_t(p[1])<<8); }
static void write16(uint8_t* p,size_t n) { p[0]=uint8_t(n); p[1]=uint8_t(n>>8); }
size_t packet(const uint8_t* data,size_t size,uint16_t id,bool response,size_t offset,uint8_t* out,size_t cap) {
  if(!data||!out||!id||!size||size>kMaxMessage||offset>=size||cap<=kHeader) return 0;
  cap=std::min(cap,kMaxPacket);
  const size_t n=std::min(size-offset,cap-kHeader);
  out[0]=1; out[1]=response?1:0; write16(out+2,id);
  write16(out+4,offset); write16(out+6,size);
  memcpy(out+kHeader,data+offset,n); return n+kHeader;
}
bool Receiver::expired(uint32_t now) const { return id_&&pixies::elapsed(now,started_,kTimeoutMs); }
void Receiver::reset() {
  memset(data_.data(),0,data_.size()); used_=total_=0; id_=0; started_=0;
}
Result Receiver::push(const uint8_t* p,size_t n,uint32_t now,bool response) {
  if(expired(now)) reset();
  if(!p||n<=kHeader||n>kMaxPacket||p[0]!=1||p[1]!=(response?1:0)) return Result::Invalid;
  const auto id=read16(p+2), offset=read16(p+4), total=read16(p+6);
  const size_t payload=n-kHeader;
  if(!id||!total||total>kMaxMessage||offset>total||payload>size_t(total-offset)) return Result::Invalid;
  if(id_&&id!=id_) return Result::Busy;
  if(!id_) {
    if(offset) return Result::Invalid;
    id_=id; total_=total; started_=now;
  }
  if(offset!=used_||total!=total_) return Result::Invalid;
  memcpy(data_.data()+used_,p+kHeader,payload); used_+=payload;
  data_[used_]=0;
  return used_==total_?Result::Complete:Result::Partial;
}
}
