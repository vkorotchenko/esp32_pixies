#pragma once
#ifdef PIXIES_CONTROL_TEST
class WebServer;
#else
// Narrow transport fake: compile the REAL bounded receiver. Responses include
// actual HTTP framing, including the core-2 explicit-length/sentinel behavior.
#include "ArduinoString.h"
#include <string>
#include <vector>
#include <memory>
#include <functional>
#include <algorithm>
#include <cctype>
#include <cstring>
#include <cstdint>
#include <cstdio>
#define CONTENT_LENGTH_UNKNOWN ((size_t)-1)
#define CONTENT_LENGTH_NOT_SET ((size_t)-2)
namespace fake_http {
struct Client {
  std::string input,response;
  size_t cursor=0;
  bool connected=true;
  int code=0;
  size_t maxRead=SIZE_MAX;
  unsigned failedReads=0;
  std::function<void()> afterRead;
};
inline std::shared_ptr<Client> pending;
inline uint32_t now=0;
}
inline uint32_t millis() { return fake_http::now; }
class WiFiClient {
 public:
  std::shared_ptr<fake_http::Client> state;
  WiFiClient()=default;
  explicit WiFiClient(std::shared_ptr<fake_http::Client> s):state(std::move(s)) {}
  explicit operator bool() const { return state&&state->connected; }
  bool connected() const { return state&&state->connected; }
  int available() const { return state?int(state->input.size()-state->cursor):0; }
  int read() { return available()?uint8_t(state->input[state->cursor++]):-1; }
  int read(uint8_t* b,size_t n) {
    if(state->failedReads) { --state->failedReads; return -1; }
    n=std::min({n,size_t(available()),state->maxRead});
    memcpy(b,state->input.data()+state->cursor,n); state->cursor+=n;
    if(state->afterRead) state->afterRead();
    return int(n);
  }
  void setTimeout(unsigned) {}
  void stop() { if(state) state->connected=false; }
};
class WiFiServer {
 public:
  WiFiClient available() { auto s=fake_http::pending; fake_http::pending.reset(); return WiFiClient(s); }
};
enum HTTPMethod { HTTP_GET,HTTP_POST,HTTP_PUT };
class WebServer;
class RequestHandler {
 public:
  virtual ~RequestHandler()=default;
  RequestHandler* next_=nullptr;
  RequestHandler* next() { return next_; }
  virtual bool canHandle(HTTPMethod,const String&)=0;
  virtual void handle(WebServer&)=0;
};
class FakeHandler:public RequestHandler {
  HTTPMethod method_;
  String path_;
  std::function<void()> fn_;
 public:
  FakeHandler(HTTPMethod m,String p,std::function<void()> fn):method_(m),path_(p),fn_(fn) {}
  bool canHandle(HTTPMethod m,const String& p) override { return m==method_&&p==path_; }
  void handle(WebServer&) override { fn_(); }
};
class WebServer {
 protected:
  struct Header { String key,value; };
  Header* _currentHeaders=nullptr;
  int _headerKeysCount=0,_clientContentLength=0;
  String _currentUri,_hostHeader,_responseHeaders;
  HTTPMethod _currentMethod=HTTP_GET;
  unsigned _currentVersion=0;
  size_t _contentLength=0;
  bool _chunked=false,_corsEnabled=false;
  WiFiServer _server;
  WiFiClient _currentClient;
  RequestHandler* _firstHandler=nullptr;
  RequestHandler* _currentHandler=nullptr;
  bool _collectHeader(const char* name,const char* value) {
    for(int i=0;i<_headerKeysCount;++i) if(_currentHeaders[i].key.equalsIgnoreCase(name)) {
      _currentHeaders[i].value=value; return true;
    }
    return false;
  }
  const char* _responseCodeToString(int) { return "Response"; }
  void _prepareHeader(String&,int,const char*,size_t);
  void _currentClientWrite(const char* bytes,size_t n) {
    if(!_currentClient.state->code&&n>=12&&!memcmp(bytes,"HTTP/1.",7))
      _currentClient.state->code=std::stoi(std::string(bytes+9,3));
    _currentClient.state->response.append(bytes,n);
  }
  void writeContent(const char* bytes,size_t n) {
    if(_chunked) {
      char size[32]; snprintf(size,sizeof size,"%zx\r\n",n);
      _currentClientWrite(size,strlen(size));
    }
    _currentClientWrite(bytes,n);
    if(_chunked) {
      _currentClientWrite("\r\n",2);
      if(!n) _chunked=false;
    }
  }
  void _handleRequest() { if(_currentHandler) _currentHandler->handle(*this); else send(404,"text/plain",""); }
 public:
  explicit WebServer(int) {}
  virtual ~WebServer() {
    delete[] _currentHeaders;
    while(_firstHandler) { auto* n=_firstHandler->next(); delete _firstHandler; _firstHandler=n; }
  }
  virtual void handleClient() {}
  void sendHeader(const String&,const String&,bool first=false);
  void send(int,const char*,const String&);
  void send_P(int,const char*,const char*,size_t);
  void setContentLength(size_t n) { _contentLength=n; }
  void sendContent(const String& data) { writeContent(data.c_str(),data.length()); }
  void sendContent_P(const char* data,size_t n) { writeContent(data,n); }
  void poisonResponseState() {
    _contentLength=0; _chunked=true; _currentVersion=0;
    _responseHeaders="X-Stale: previous-connection\r\n";
  }
  void collectHeaders(const char* names[],size_t n) {
    _headerKeysCount=int(n); _currentHeaders=new Header[n];
    for(size_t i=0;i<n;++i) _currentHeaders[i].key=names[i];
  }
  void on(const char* path,HTTPMethod method,std::function<void()> fn) {
    auto* h=new FakeHandler(method,path,fn);
    h->next_=_firstHandler; _firstHandler=h;
  }
};

#ifdef PIXIES_PINNED_METHODS
// These definitions are extracted at test time from the installed, pinned
// framework, not maintained copies of the behavior being tested.
#define F(s) (s)
#define FPSTR(s) (s)
#define memcpy_P memcpy
#define memccpy_P memccpy
#define log_w(...) ((void)0)
using PGM_P=const char*;
using PGM_VOID_P=const void*;
namespace mime {
enum { html };
inline const struct { const char* mimeType; } mimeTable[]={{"text/html"}};
inline const char* Content_Length="Content-Length";
}
#include PIXIES_PINNED_METHODS
#else
inline void WebServer::sendHeader(const String& name,const String& value,bool first) {
  const String line=name+": "+value+"\r\n";
  _responseHeaders=first?line+_responseHeaders:_responseHeaders+line;
}
inline void WebServer::_prepareHeader(String& response,int code,const char* type,size_t size) {
  response=String("HTTP/1.")+String(_currentVersion)+" "+String(code)+" Response\r\n";
  sendHeader("Content-Type",type?type:"text/html",true);
  if(_contentLength==CONTENT_LENGTH_NOT_SET) sendHeader("Content-Length",String(size));
  else if(_contentLength!=CONTENT_LENGTH_UNKNOWN) sendHeader("Content-Length",String(_contentLength));
  else if(_currentVersion) { _chunked=true; sendHeader("Transfer-Encoding","chunked"); }
  sendHeader("Connection","close");
  response+=_responseHeaders; response+="\r\n"; _responseHeaders="";
}
inline void WebServer::send(int code,const char* type,const String& data) {
  String header; _prepareHeader(header,code,type,data.length());
  _currentClientWrite(header.c_str(),header.length());
  if(data.length()) sendContent(data);
}
inline void WebServer::send_P(int code,const char* type,const char* data,size_t size) {
  String header; _prepareHeader(header,code,type,size); sendContent(header); sendContent_P(data,size);
}
#endif
#endif
