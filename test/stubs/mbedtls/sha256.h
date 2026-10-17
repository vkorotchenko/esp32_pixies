#pragma once
#include <cstddef>
#ifdef __APPLE__
#include <CommonCrypto/CommonDigest.h>
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
struct mbedtls_sha256_context { CC_SHA256_CTX value; };
inline void mbedtls_sha256_init(mbedtls_sha256_context*) {}
inline void mbedtls_sha256_free(mbedtls_sha256_context*) {}
inline int mbedtls_sha256_starts_ret(mbedtls_sha256_context* c,int) { return CC_SHA256_Init(&c->value)==1?0:-1; }
inline int mbedtls_sha256_update_ret(mbedtls_sha256_context* c,const unsigned char* b,size_t n) {
  return CC_SHA256_Update(&c->value,b,static_cast<CC_LONG>(n))==1?0:-1;
}
inline int mbedtls_sha256_finish_ret(mbedtls_sha256_context* c,unsigned char* b) { return CC_SHA256_Final(b,&c->value)==1?0:-1; }
#pragma clang diagnostic pop
#else
#include <openssl/evp.h>
struct mbedtls_sha256_context { EVP_MD_CTX* value=nullptr; };
inline void mbedtls_sha256_init(mbedtls_sha256_context* c) { c->value=nullptr; }
inline void mbedtls_sha256_free(mbedtls_sha256_context* c) { EVP_MD_CTX_free(c->value); c->value=nullptr; }
inline int mbedtls_sha256_starts_ret(mbedtls_sha256_context* c,int) {
  if(!c->value) c->value=EVP_MD_CTX_new();
  return c->value&&EVP_DigestInit_ex(c->value,EVP_sha256(),nullptr)==1?0:-1;
}
inline int mbedtls_sha256_update_ret(mbedtls_sha256_context* c,const unsigned char* b,size_t n) {
  return EVP_DigestUpdate(c->value,b,n)==1?0:-1;
}
inline int mbedtls_sha256_finish_ret(mbedtls_sha256_context* c,unsigned char* b) {
  unsigned n=0; return EVP_DigestFinal_ex(c->value,b,&n)==1&&n==32?0:-1;
}
#endif
