#pragma once
#include <cstddef>
#include <cstring>
inline int mbedtls_base64_decode(unsigned char* out,size_t cap,size_t* written,
                                 const unsigned char* text,size_t length) {
  const char* alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  *written=0;
  if(!length||length%4) return -1;
  for(size_t i=0;i<length;i+=4) {
    unsigned word=0,padding=0;
    for(size_t j=0;j<4;++j) {
      const auto c=text[i+j];
      if(c=='=') { if(j<2||i+4!=length) return -1; ++padding; word<<=6; }
      else {
        const char* digit=c?std::strchr(alphabet,c):nullptr;
        if(!digit||padding) return -1;
        word=(word<<6)|unsigned(digit-alphabet);
      }
    }
    if(*written+3-padding>cap) return -1;
    for(unsigned j=0;j<3-padding;++j) out[(*written)++]=uint8_t(word>>(16-8*j));
  }
  return 0;
}
