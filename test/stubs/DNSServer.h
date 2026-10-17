#pragma once
#include "WiFi.h"
class DNSServer {
 public:
  void start(unsigned,const char*,IPAddress) {}
  void stop() {}
  void processNextRequest() {}
};
