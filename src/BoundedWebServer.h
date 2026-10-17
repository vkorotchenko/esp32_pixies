#pragma once
#include <WebServer.h>
#include <functional>
#include <SettingsJson.h>

// Stock core-2 WebServer buffers an arbitrary Content-Length and blocks while
// reading it. Keep its routing/response support, but receive a small HTTP subset
// cooperatively, with bounds enforced BEFORE allocation. No keepalive/chunking.
class BoundedWebServer : public WebServer {
 public:
  BoundedWebServer():WebServer(80) {}
  void handleClient() override;
  const String& body() const { return body_; }
  std::function<bool(size_t)> uploadStart;
  std::function<bool(const uint8_t*,size_t)> uploadChunk;
  std::function<bool()> uploadEnd;
  std::function<void()> uploadAbort;
  std::function<bool()> requestGate;
 private:
  char headers_[2049]{};
  size_t headerSize_=0,received_=0,expected_=0;
  String body_;
  bool active_=false,headersDone_=false,upload_=false,streamStarted_=false;
  uint32_t started_=0,lastByte_=0;
  bool parseHeaders();
  void finish();
  void reject(int,const char*);
  void dispatch();
};
