#pragma once
#include "WiFi.h"
#include <map>
#include <functional>
enum HTTPMethod { HTTP_GET,HTTP_POST,HTTP_PUT };
namespace fake_web {
inline String path,body,host="192.168.4.1",response;
inline std::map<std::string,String> headers;
inline HTTPMethod method=HTTP_GET;
inline int code=0;
inline bool authenticated=false;
}
class WebServer {
 public:
  explicit WebServer(int) {}
  virtual ~WebServer()=default;
  virtual void handleClient() {}
  HTTPMethod method() const { return fake_web::method; }
  String uri() const { return fake_web::path; }
  String hostHeader() const { return fake_web::host; }
  String header(const char* name) const { return fake_web::headers[name]; }
  WiFiClient client() const { return {}; }
  void collectHeaders(const char*[],size_t) {}
  void sendHeader(const String&,const String&,bool=false) {}
  void send(int code,const char*,const String& body) { fake_web::code=code; fake_web::response=body; }
  void send_P(int code,const char* type,const char* body,size_t) { send(code,type,body); }
  void begin() {}
  void on(const char* path,HTTPMethod method,std::function<void()> fn) { routes_[{path,method}]=fn; }
  void onNotFound(std::function<void()> fn) { notFound_=fn; }
  void dispatch() {
    const auto found=routes_.find({fake_web::path.c_str(),fake_web::method});
    if(found!=routes_.end()) found->second(); else if(notFound_) notFound_();
  }
 private:
  std::map<std::pair<std::string,HTTPMethod>,std::function<void()>> routes_;
  std::function<void()> notFound_;
};
