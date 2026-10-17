#include "BoundedWebServer.h"
#include <cstring>
#include <cstdlib>
#include <algorithm>
void BoundedWebServer::finish() {
  if(streamStarted_&&uploadAbort) uploadAbort();
  streamStarted_=false;
  _currentClient.stop();
  if(body_.length()) memset(const_cast<char*>(body_.c_str()),0,body_.length());
  body_="";
  memset(headers_,0,sizeof headers_);
  for(int i=0;i<_headerKeysCount;++i) _currentHeaders[i].value="";
  _hostHeader=""; _currentUri=""; _currentHandler=nullptr;
  active_=headersDone_=upload_=false; headerSize_=received_=expected_=0;
}
void BoundedWebServer::reject(int code,const char* reason) {
  sendHeader("Cache-Control","no-store");
  sendHeader("Connection","close");
  send(code,"application/json",String("{\"error\":{\"code\":\"")+reason+"\",\"message\":\"Request rejected\"}}");
  finish();
}
bool BoundedWebServer::parseHeaders() {
  char* save=nullptr;
  char* line=strtok_r(headers_,"\r\n",&save);
  if(!line||strlen(line)>256) { reject(400,"bad_request"); return false; }
  char* space=strchr(line,' ');
  if(!space) { reject(400,"bad_request"); return false; }
  *space++=0;
  char* version=strchr(space,' ');
  if(!version) { reject(400,"bad_request"); return false; }
  *version++=0;
  if(strcmp(version,"HTTP/1.1")&&strcmp(version,"HTTP/1.0")) { reject(400,"bad_request"); return false; }
  _currentVersion=version[7]-'0';
  if(!strcmp(line,"GET")) _currentMethod=HTTP_GET;
  else if(!strcmp(line,"POST")) _currentMethod=HTTP_POST;
  else if(!strcmp(line,"PUT")) _currentMethod=HTTP_PUT;
  else { reject(405,"method_not_allowed"); return false; }
  if(space[0]!='/'||strchr(space,'?')||strchr(space,'#')||strchr(space,'%')) {
    reject(400,"bad_path"); return false;
  }
  _currentUri=space;
  unsigned count=0; bool hasLength=false,hasHost=false;
  bool seenCollected[8]{};
  while((line=strtok_r(nullptr,"\r\n",&save))) {
    if(++count>24||strlen(line)>512||line[0]==' '||line[0]=='\t') {
      reject(400,"bad_headers"); return false;
    }
    char* colon=strchr(line,':');
    if(!colon) { reject(400,"bad_headers"); return false; }
    *colon++=0;
    String name(line),value(colon); value.trim();
    for(size_t i=0;i<name.length();++i) {
      const char c=name[i];
      if(!isalnum(static_cast<unsigned char>(c))&&c!='-') { reject(400,"bad_headers"); return false; }
    }
    if(name.equalsIgnoreCase("Transfer-Encoding")||name.equalsIgnoreCase("Expect")) {
      reject(400,"unsupported_transfer"); return false;
    }
    if(name.equalsIgnoreCase("Content-Length")) {
      if(hasLength||!value.length()||value.length()>8) { reject(400,"bad_length"); return false; }
      for(size_t i=0;i<value.length();++i) if(value[i]<'0'||value[i]>'9') {
        reject(400,"bad_length"); return false;
      }
      hasLength=true; expected_=strtoul(value.c_str(),nullptr,10);
    }
    if(name.equalsIgnoreCase("Host")) {
      if(hasHost) { reject(400,"bad_headers"); return false; }
      hasHost=true; _hostHeader=value;
    }
    // Reject duplicate security headers rather than choose an interpretation.
    for(int i=0;i<_headerKeysCount;++i) if(_currentHeaders[i].key.equalsIgnoreCase(name)) {
      if(i>=8||seenCollected[i]) { reject(400,"bad_headers"); return false; }
      seenCollected[i]=true;
    }
    _collectHeader(name.c_str(),value.c_str());
  }
  if(!hasHost) { reject(400,"bad_host"); return false; }
  if(_currentMethod==HTTP_GET&&expected_) { reject(400,"unexpected_body"); return false; }
  if(_currentMethod!=HTTP_GET&&!hasLength) { reject(411,"length_required"); return false; }
  upload_=_currentMethod==HTTP_POST&&_currentUri=="/api/update";
  if(!upload_&&expected_>pixies::kMaxBody) { reject(413,"body_too_large"); return false; }
  _clientContentLength=int(expected_);
  if(requestGate&&!requestGate()) { finish(); return false; }
  if(upload_) {
    if(!uploadStart||!uploadStart(expected_)) { finish(); return false; }
    streamStarted_=true;
  } else if(expected_&&!body_.reserve(expected_)) { reject(503,"out_of_memory"); return false; }
  return true;
}
void BoundedWebServer::dispatch() {
  _currentHandler=nullptr;
  for(RequestHandler* h=_firstHandler;h;h=h->next()) if(h->canHandle(_currentMethod,_currentUri)) {
    _currentHandler=h; break;
  }
  _handleRequest();
  finish();
}
void BoundedWebServer::handleClient() {
  const uint32_t now=millis();
  if(!active_) {
    _currentClient=_server.available();
    if(!_currentClient) return;
    // We bypass WebServer::handleClient(), including its response framing reset.
    // Initialize before reading anything: even a header timeout/overflow sends
    // a body, and a previous connection may have set an explicit length.
    _contentLength=CONTENT_LENGTH_NOT_SET;
    _chunked=false; _responseHeaders=""; _clientContentLength=0;
    _currentVersion=1; _currentMethod=HTTP_GET;
    active_=true; started_=lastByte_=now;
    _currentClient.setTimeout(50);
  }
  if((!_currentClient.connected()&&!_currentClient.available())||
      pixies::elapsed(now,lastByte_,5000)||pixies::elapsed(now,started_,upload_?180000:15000)) {
    if(_currentClient.connected()) reject(408,"request_timeout"); else finish();
    return;
  }
  // Bound work per loop iteration; effects/network continue during slow clients.
  unsigned headerBudget=512;
  while(!headersDone_&&_currentClient.available()&&headerBudget--) {
    const int c=_currentClient.read();
    if(c<0) break;
    if(c==0||headerSize_==sizeof(headers_)-1) { reject(413,"headers_too_large"); return; }
    headers_[headerSize_++]=char(c); headers_[headerSize_]=0; lastByte_=now;
    if(headerSize_>=4&&!memcmp(headers_+headerSize_-4,"\r\n\r\n",4)) {
      headersDone_=true;
      if(!parseHeaders()) return;
    }
  }
  if(!headersDone_) return;
  if(received_<expected_&&_currentClient.available()) {
    uint8_t buf[1024];
    // Core-2 String::concat reads length+1 bytes, including the terminator.
    const size_t capacity=sizeof buf-(upload_?0:1);
    const size_t n=std::min({capacity,expected_-received_,size_t(_currentClient.available())});
    const int got=_currentClient.read(buf,n);
    if(got>0) {
      lastByte_=now; received_+=size_t(got);
      if(upload_) {
        if(!uploadChunk||!uploadChunk(buf,size_t(got))) { memset(buf,0,sizeof buf); finish(); return; }
      } else {
        buf[got]=0;
        if(!body_.concat(reinterpret_cast<const char*>(buf),unsigned(got))) {
          memset(buf,0,sizeof buf); reject(503,"out_of_memory"); return;
        }
      }
      memset(buf,0,sizeof buf);
    }
  }
  if(received_==expected_) {
    if(upload_) {
      if(_currentClient.available()>0) { reject(400,"extra_upload_data"); return; }
      if(!uploadEnd||!uploadEnd()) { finish(); return; }
      streamStarted_=false;
    }
    dispatch();
  }
}
