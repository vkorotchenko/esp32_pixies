#pragma once
#include "SettingsStore.h"
#include <WebServer.h>
class Admin {
 public:
  explicit Admin(SettingsStore& store):store_(store) {}
  void begin();
  bool configured=false;
  bool claim(const String& password);
  bool login(const String& password,uint32_t now);
  bool authenticated(WebServer&,uint32_t now) const;
  bool csrf(WebServer&) const;
  void logout();
  void expire(uint32_t now);
  String csrfToken() const { return csrf_; }
  void cookie(WebServer&);
  uint32_t retryAfter(uint32_t now) const;
 private:
  SettingsStore& store_;
  AdminVerifier verifier_;
  String session_,csrf_;
  uint32_t sessionAt_=0;
  pixies::LoginThrottle throttle_;
  bool derive(const String&,const AdminVerifier&,uint8_t*) const;
  void newSession(uint32_t);
};
