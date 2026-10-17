#include "Admin.h"
#include <mbedtls/pkcs5.h>
#include <mbedtls/md.h>
#include <esp_system.h>
#include <cstring>
namespace {
String randomHex(size_t bytes) {
  char out[65]; static constexpr char hex[]="0123456789abcdef";
  for(size_t i=0;i<bytes;++i) { const uint8_t v=esp_random(); out[i*2]=hex[v>>4]; out[i*2+1]=hex[v&15]; }
  out[bytes*2]=0; return String(out);
}
bool constantEqual(const uint8_t* a,const uint8_t* b,size_t n) {
  volatile uint8_t difference=0;
  for(size_t i=0;i<n;++i) difference|=a[i]^b[i];
  return difference==0;
}
}
void Admin::begin() { configured=store_.loadAdmin(verifier_); }
bool Admin::derive(const String& password,const AdminVerifier& verifier,uint8_t* hash) const {
  mbedtls_md_context_t ctx; mbedtls_md_init(&ctx);
  int rc=mbedtls_md_setup(&ctx,mbedtls_md_info_from_type(MBEDTLS_MD_SHA256),1);
  if(!rc) rc=mbedtls_pkcs5_pbkdf2_hmac(&ctx,reinterpret_cast<const uint8_t*>(password.c_str()),password.length(),
    verifier.salt,sizeof verifier.salt,verifier.iterations,32,hash);
  mbedtls_md_free(&ctx); return rc==0;
}
bool Admin::claim(const String& password) {
  if(configured||!pixies::passwordLength(password.length())) return false;
  AdminVerifier temp;
  esp_fill_random(temp.salt,sizeof temp.salt);
  const bool ok=derive(password,temp,temp.hash)&&store_.saveAdmin(temp);
  if(ok) { verifier_=temp; configured=true; newSession(millis()); }
  temp={}; return ok;
}
void Admin::newSession(uint32_t now) { session_=randomHex(32); csrf_=randomHex(32); sessionAt_=now; }
uint32_t Admin::retryAfter(uint32_t now) const {
  return throttle_.retryAfter(now);
}
bool Admin::login(const String& password,uint32_t now) {
  if(!configured||retryAfter(now)) return false;
  uint8_t hash[32]{};
  const bool ok=password.length()<=64&&derive(password,verifier_,hash)&&constantEqual(hash,verifier_.hash,32);
  memset(hash,0,sizeof hash);
  throttle_.result(now,ok);
  if(ok) newSession(millis());
  return ok;
}
bool Admin::authenticated(WebServer& server,uint32_t now) const {
  if(!session_.length()||pixies::elapsed(now,sessionAt_,1800000)) return false;
  const String cookie=server.header("Cookie");
  const String target="pixies_session="+session_;
  // Match the whole cookie, not a substring in another cookie's name/value.
  int pos=0;
  while(pos<int(cookie.length())) {
    int end=cookie.indexOf(';',pos); if(end<0) end=cookie.length();
    String part=cookie.substring(pos,end); part.trim();
    if(part.length()==target.length()&&constantEqual(reinterpret_cast<const uint8_t*>(part.c_str()),
        reinterpret_cast<const uint8_t*>(target.c_str()),target.length())) return true;
    pos=end+1;
  }
  return false;
}
bool Admin::csrf(WebServer& server) const {
  String v=server.header("X-CSRF-Token");
  return csrf_.length()==64&&v.length()==64&&constantEqual(reinterpret_cast<const uint8_t*>(v.c_str()),
    reinterpret_cast<const uint8_t*>(csrf_.c_str()),64);
}
void Admin::cookie(WebServer& server) {
  server.sendHeader("Set-Cookie","pixies_session="+session_+"; Path=/; HttpOnly; SameSite=Strict; Max-Age=1800");
}
void Admin::logout() { session_=""; csrf_=""; }
void Admin::expire(uint32_t now) {
  if(session_.length()&&pixies::elapsed(now,sessionAt_,1800000)) logout();
}
