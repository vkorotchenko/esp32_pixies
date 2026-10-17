#include <unity.h>
#include <SettingsJson.h>
#include <cstdio>
#include <fstream>
#include <iterator>
#ifndef PIXIES_RECEIVER_SOURCE
#define PIXIES_RECEIVER_SOURCE "../../src/BoundedWebServer.cpp"
#endif
#include PIXIES_RECEIVER_SOURCE
void setUp() {
  fake_http::now=100; fake_http::pending.reset();
  fake_string::reservesUntilFailure=-1;
}
void tearDown() {}
std::shared_ptr<fake_http::Client> inject(const std::string& input) {
  auto client=std::make_shared<fake_http::Client>(); client->input=input; fake_http::pending=client; return client;
}
void pump(BoundedWebServer& server,const std::shared_ptr<fake_http::Client>& c,unsigned loops=100) {
  while(c->connected&&loops--) { server.handleClient(); ++fake_http::now; }
}
void assertWire(const std::shared_ptr<fake_http::Client>& c,int code,const std::string& body={}) {
  TEST_ASSERT_FALSE(c->connected);
  TEST_ASSERT_EQUAL(code,c->code);
  const auto end=c->response.find("\r\n\r\n");
  TEST_ASSERT_NOT_EQUAL(std::string::npos,end);
  const auto length=c->response.find("\r\nContent-Length: ");
  TEST_ASSERT_NOT_EQUAL(std::string::npos,length);
  TEST_ASSERT_LESS_THAN(end,length);
  TEST_ASSERT_EQUAL(std::string::npos,c->response.find("\r\nContent-Length: ",length+1));
  const size_t declared=std::stoul(c->response.substr(length+18));
  TEST_ASSERT_EQUAL(c->response.size()-end-4,declared);
  TEST_ASSERT_EQUAL(std::string::npos,c->response.find("Transfer-Encoding:"));
  TEST_ASSERT_EQUAL(std::string::npos,c->response.find("X-Stale:"));
  TEST_ASSERT_NOT_EQUAL(std::string::npos,c->response.find("\r\nConnection: close\r\n"));
  if(!body.empty()) TEST_ASSERT_EQUAL_STRING(body.c_str(),c->response.substr(end+4).c_str());
  if(code>=400) TEST_ASSERT_GREATER_THAN(0,declared);
}
std::string put(const std::string& body) {
  return "PUT /api/config HTTP/1.1\r\nHost: pixies.local\r\nContent-Length: "+
    std::to_string(body.size())+"\r\n\r\n"+body;
}
struct ConfigEndpoint {
  BoundedWebServer server;
  pixies::SettingsState settings;
  unsigned calls=0;
  std::string received;
  ConfigEndpoint() {
    server.on("/api/config",HTTP_PUT,[this]() {
      ++calls; received.assign(server.body().c_str(),server.body().length());
      DynamicJsonDocument doc(pixies::kJsonCapacity);
      pixies::Settings candidate; const char* field=nullptr;
      // Execute production syntax/schema validation and atomic preview, not a
      // boolean "applied" fake. Incomplete/failed transport must never call it.
      if(!pixies::completeJsonObject(server.body().c_str(),server.body().length())||
          deserializeJson(doc,server.body().c_str(),server.body().length())||
          !pixies::readSettings(doc["config"],candidate,field)||
          !settings.preview(candidate,doc["baseRevision"].as<uint32_t>())) {
        server.send(422,"application/json","{\"error\":{\"code\":\"validation\"}}"); return;
      }
      server.send(200,"application/json","{\"ok\":true}");
    });
  }
  std::string configBody(bool maximum=false) {
    pixies::Settings s;
    s.ledCount=1000; s.brightness=100;
    if(maximum) {
      s.on=false; s.speed=s.intensity=s.density=100; s.effect=pixies::Effect::Twinkle;
      s.customCount=pixies::kMaxPalettes;
      for(unsigned i=0;i<s.customCount;++i) {
        auto& p=s.custom[i];
        snprintf(p.id,sizeof p.id,"palette%017u",i);
        // Maximum-length names that also exercise JSON's escaped representation.
        for(size_t j=0;j<sizeof p.name-1;++j) p.name[j]=j%2?'\\':'"';
        p.count=pixies::kMaxColors;
        for(auto& color:p.colors) color={255,128,64};
      }
      strcpy(s.paletteId,s.custom.back().id);
    }
    DynamicJsonDocument doc(pixies::kJsonCapacity);
    doc["baseRevision"]=settings.revision;
    pixies::writeSettings(doc.createNestedObject("config"),s);
    std::string body; serializeJson(doc,body); return body;
  }
};
void bounds_before_allocation() {
  for(const auto& request:std::vector<std::string>{
    "POST /api/config HTTP/1.1\r\nHost: pixies.local\r\nContent-Length: 8193\r\n\r\n",
    "GET / HTTP/1.1\r\nHost: pixies.local\r\nX-Large: "+std::string(2049,'a')+"\r\n\r\n"}) {
    BoundedWebServer server; auto c=inject(request); pump(server,c);
    assertWire(c,413);
  }
}
void framing_rejections() {
  for(const char* extra:{"Transfer-Encoding: chunked\r\n","Content-Length: 1\r\nContent-Length: 1\r\n",
                         "Content-Length: -1\r\n","Origin: x\r\nOrigin: y\r\n","Origin: \r\nOrigin: y\r\n"}) {
    BoundedWebServer server; const char* collected[]{"Origin"}; server.collectHeaders(collected,1);
    auto c=inject(std::string("POST /api/config HTTP/1.1\r\nHost: pixies.local\r\n")+extra+"\r\n");
    pump(server,c); assertWire(c,400);
  }
}
void cooperative_body_and_timeout() {
  BoundedWebServer server; bool applied=false;
  server.on("/api/config",HTTP_PUT,[&](){ applied=true; TEST_ASSERT_EQUAL_STRING("{}",server.body().c_str()); server.send(200,"application/json","{}"); });
  auto c=inject("PUT /api/config HTTP/1.1\r\nHost: pixies.local\r\nContent-Length: 2\r\n\r\n{");
  pump(server,c,10); TEST_ASSERT_FALSE(applied); TEST_ASSERT_TRUE(c->connected);
  c->input+="}"; pump(server,c); TEST_ASSERT_TRUE(applied); assertWire(c,200,"{}");
  BoundedWebServer slow; auto s=inject("GET /"); slow.handleClient();
  fake_http::now+=5000; slow.handleClient(); assertWire(s,408);
}
void upload_guards_and_abort() {
  BoundedWebServer server; bool auth=false; unsigned writes=0,aborts=0;
  server.uploadStart=[&](size_t){ if(!auth) server.send(401,"application/json","{}"); return auth; };
  server.uploadChunk=[&](const uint8_t*,size_t){ ++writes; return true; };
  server.uploadAbort=[&](){ ++aborts; };
  auto c=inject("POST /api/update HTTP/1.1\r\nHost: pixies.local\r\nContent-Length: 1024\r\n\r\n");
  pump(server,c); assertWire(c,401,"{}"); TEST_ASSERT_EQUAL(0,writes); TEST_ASSERT_EQUAL(0,aborts);
  auth=true;
  c=inject("POST /api/update HTTP/1.1\r\nHost: pixies.local\r\nContent-Length: 1024\r\n\r\n"+std::string(400,'x'));
  pump(server,c,10); TEST_ASSERT_EQUAL(1,writes);
  c->connected=false; server.handleClient(); TEST_ASSERT_EQUAL(1,aborts);
}
void raw_ota_chunks_remain_binary_and_1024_bytes() {
  BoundedWebServer server; std::string received; std::vector<size_t> chunks;
  server.uploadStart=[](size_t size) { return size==1025; };
  server.uploadChunk=[&](const uint8_t* bytes,size_t n) {
    chunks.push_back(n); received.append(reinterpret_cast<const char*>(bytes),n); return true;
  };
  server.uploadEnd=[]() { return true; };
  server.on("/api/update",HTTP_POST,[&]() { server.send(202,"application/json","{\"state\":\"restarting\"}"); });
  std::string image(1025,0);
  for(size_t i=0;i<image.size();++i) image[i]=char(i%256);
  auto c=inject("POST /api/update HTTP/1.1\r\nHost: pixies\r\nContent-Length: 1025\r\n\r\n"+image);
  pump(server,c); assertWire(c,202);
  TEST_ASSERT_EQUAL(2,chunks.size()); TEST_ASSERT_EQUAL(1024,chunks[0]); TEST_ASSERT_EQUAL(1,chunks[1]);
  TEST_ASSERT_EQUAL(image.size(),received.size());
  TEST_ASSERT_EQUAL_MEMORY(image.data(),received.data(),image.size());
}
void successive_asset_config_and_auth_wire_lengths() {
  BoundedWebServer server;
  for(const char* file:{"index.html","app.js","styles.css"}) {
    std::ifstream input(std::string("web/")+file,std::ios::binary);
    TEST_ASSERT_TRUE(input.good());
    const std::string data((std::istreambuf_iterator<char>(input)),{});
    TEST_ASSERT_GREATER_THAN(0,data.size());
    const std::string path=!strcmp(file,"index.html")?"/":std::string("/")+file;
    const char* type=!strcmp(file,"index.html")?"text/html":!strcmp(file,"app.js")?"text/javascript":"text/css";
    server.on(path.c_str(),HTTP_GET,[&,data,type]() { server.send_P(200,type,data.data(),data.size()); });
    server.poisonResponseState();
    auto c=inject("GET "+path+" HTTP/1.1\r\nHost: pixies.local\r\n\r\n");
    pump(server,c); assertWire(c,200,data);
  }
  const std::string config="{\"schemaVersion\":1,\"config\":{\"ledCount\":200}}";
  server.on("/api/config",HTTP_GET,[&]() { server.send(200,"application/json",config.c_str()); });
  server.on("/api/auth/login",HTTP_POST,[&]() {
    server.send(401,"application/json","{\"error\":{\"code\":\"authentication\",\"message\":\"Admin login required\"}}");
  });
  server.on("/explicit",HTTP_GET,[&]() {
    server.setContentLength(3); server.send(200,"text/plain","old");
  });
  for(unsigned i=0;i<3;++i) {
    auto c=inject("GET /explicit HTTP/1.1\r\nHost: pixies.local\r\n\r\n");
    pump(server,c); assertWire(c,200,"old");
    c=inject("GET /api/config HTTP/1.1\r\nHost: pixies.local\r\n\r\n");
    pump(server,c); assertWire(c,200,config);
    c=inject("POST /api/auth/login HTTP/1.1\r\nHost: pixies.local\r\nContent-Length: 2\r\n\r\n{}");
    pump(server,c); assertWire(c,401);
  }
  bool deny=true;
  server.requestGate=[&]() {
    if(deny) server.send(403,"application/json","{\"error\":{\"code\":\"origin\"}}");
    return !deny;
  };
  auto c=inject("GET /api/config HTTP/1.1\r\nHost: pixies.local\r\n\r\n");
  pump(server,c); assertWire(c,403);
  deny=false;
  c=inject("GET /api/config HTTP/1.0\r\nHost: pixies.local\r\n\r\n");
  pump(server,c); assertWire(c,200,config);
  TEST_ASSERT_EQUAL(0,c->response.find("HTTP/1.0 200 "));
}
void successive_parser_errors_and_early_timeout_wire_lengths() {
  BoundedWebServer server;
  const std::pair<const char*,int> cases[]{
    {"invalid\r\n\r\n",400},
    {"GET / HTTP/9.9\r\n\r\n",400},
    {"DELETE / HTTP/1.1\r\n\r\n",405},
    {"GET /bad%20path HTTP/1.1\r\n\r\n",400},
    {"GET / HTTP/1.1\r\nBad-Header\r\n\r\n",400},
    {"GET / HTTP/1.1\r\n\r\n",400},
    {"GET / HTTP/1.1\r\nHost: pixies\r\nContent-Length: 1\r\n\r\n",400},
    {"POST / HTTP/1.1\r\nHost: pixies\r\n\r\n",411},
    {"POST / HTTP/1.1\r\nHost: pixies\r\nContent-Length: -1\r\n\r\n",400},
    {"POST / HTTP/1.1\r\nHost: pixies\r\nTransfer-Encoding: chunked\r\n\r\n",400},
    {"POST / HTTP/1.1\r\nHost: pixies\r\nContent-Length: 8193\r\n\r\n",413},
  };
  for(const auto& item:cases) {
    server.poisonResponseState();
    auto c=inject(item.first); pump(server,c); assertWire(c,item.second);
    TEST_ASSERT_EQUAL(0,c->response.find("HTTP/1.1 "));
  }
  auto c=inject("GET / HTTP/1.1\r\nX-Large: "+std::string(2049,'a'));
  pump(server,c); assertWire(c,413);
  // No parseHeaders()/dispatch() occurs at all on this path.
  server.poisonResponseState();
  c=inject(""); server.handleClient(); fake_http::now+=5000; server.handleClient();
  assertWire(c,408);
  TEST_ASSERT_EQUAL(0,c->response.find("HTTP/1.1 "));
  auto incomplete=inject("PUT /api/config HTTP/1.1\r\nHost: pixies\r\nContent-Length: 5\r\n\r\n{}");
  pump(server,incomplete,5); fake_http::now+=5000; server.handleClient(); assertWire(incomplete,408);
}
void concat_compatibility_includes_source_terminator() {
  String text("prefix");
  const char source[]{'a','b','X',0};
  TEST_ASSERT_TRUE(text.concat(source,2));
  TEST_ASSERT_EQUAL(8,text.length());
  // A std::string::append fake would hide precisely this pinned behavior.
  TEST_ASSERT_EQUAL('X',text.c_str()[text.length()]);
}
void json_chunk_boundaries_1023_1024_1025() {
  ConfigEndpoint endpoint;
  for(size_t size:{1023,1024,1025}) {
    std::string body=endpoint.configBody(); body.resize(size,' ');
    auto c=inject(put(body)); pump(endpoint.server,c); assertWire(c,200);
    TEST_ASSERT_EQUAL_STRING(body.c_str(),endpoint.received.c_str());
    TEST_ASSERT_EQUAL(1000,endpoint.settings.live.ledCount);
  }
  TEST_ASSERT_EQUAL(3,endpoint.calls);
  TEST_ASSERT_EQUAL(4,endpoint.settings.revision);
}
void fragmented_and_short_read_json_chunks() {
  ConfigEndpoint endpoint;
  const auto body=endpoint.configBody(true);
  auto c=inject(put(body).substr(0,put(body).size()-body.size()));
  pump(endpoint.server,c,3);
  const size_t fragments[]{1,17,1024,3,1023,511};
  size_t cursor=0,index=0;
  while(cursor<body.size()) {
    const size_t n=std::min(fragments[index++%6],body.size()-cursor);
    c->input.append(body,cursor,n); cursor+=n;
    c->maxRead=37; pump(endpoint.server,c,50);
    if(cursor<body.size()) {
      TEST_ASSERT_EQUAL(0,endpoint.calls);
      TEST_ASSERT_EQUAL(cursor,endpoint.server.body().length());
      TEST_ASSERT_EQUAL(0,endpoint.server.body().c_str()[cursor]);
    }
  }
  assertWire(c,200); TEST_ASSERT_EQUAL_STRING(body.c_str(),endpoint.received.c_str());
  TEST_ASSERT_EQUAL(10,endpoint.settings.live.customCount);
}
void maximum_config_and_exact_body_limit() {
  ConfigEndpoint endpoint;
  for(bool pad:{false,true}) {
    auto body=endpoint.configBody(true);
    TEST_ASSERT_GREATER_THAN(1025,body.size());
    if(pad) body.resize(pixies::kMaxBody,' ');
    auto c=inject(put(body)); pump(endpoint.server,c); assertWire(c,200);
    TEST_ASSERT_EQUAL_STRING(body.c_str(),endpoint.received.c_str());
    TEST_ASSERT_EQUAL(10,endpoint.settings.live.customCount);
    for(const auto& palette:endpoint.settings.live.custom) {
      TEST_ASSERT_EQUAL(8,palette.count);
      TEST_ASSERT_EQUAL(24,strlen(palette.id));
      TEST_ASSERT_EQUAL(32,strlen(palette.name));
    }
  }
}
void failed_or_bad_receive_never_mutates_config() {
  ConfigEndpoint endpoint;
  const auto before=endpoint.settings.live;
  auto body=endpoint.configBody(true);
  // Test first and subsequent concat failures, after the request reserve worked.
  for(unsigned failChunk:{1,2}) {
    auto c=inject(put(body)); unsigned chunks=0;
    c->afterRead=[&]() { if(++chunks==failChunk) fake_string::reservesUntilFailure=0; };
    pump(endpoint.server,c); assertWire(c,503);
    TEST_ASSERT_EQUAL(0,endpoint.calls);
    TEST_ASSERT_TRUE(pixies::equal(before,endpoint.settings.live));
    TEST_ASSERT_EQUAL(1,endpoint.settings.revision);
    TEST_ASSERT_EQUAL(0,endpoint.server.body().length());
  }
  endpoint.server.requestGate=[]() { fake_string::reservesUntilFailure=0; return true; };
  auto c=inject(put(body)); pump(endpoint.server,c); assertWire(c,503);
  endpoint.server.requestGate=nullptr;
  c=inject(put(std::string(pixies::kMaxBody+1,' ')));
  pump(endpoint.server,c); assertWire(c,413);
  c=inject(put(body)); c->failedReads=100;
  pump(endpoint.server,c,3); fake_http::now+=5000; endpoint.server.handleClient(); assertWire(c,408);
  const auto request=put(body);
  c=inject(request.substr(0,request.size()-500)); pump(endpoint.server,c,10);
  c->connected=false; endpoint.server.handleClient();
  TEST_ASSERT_EQUAL(0,endpoint.calls);
  TEST_ASSERT_TRUE(pixies::equal(before,endpoint.settings.live));
  c=inject(put("{\"config\":")); pump(endpoint.server,c); assertWire(c,422);
  TEST_ASSERT_TRUE(pixies::equal(before,endpoint.settings.live));
  TEST_ASSERT_TRUE(pixies::equal(before,endpoint.settings.persisted));
  TEST_ASSERT_EQUAL(1,endpoint.settings.revision);
  // A failed receive must not poison the next connection.
  c=inject(put(endpoint.configBody())); pump(endpoint.server,c); assertWire(c,200);
  TEST_ASSERT_EQUAL(2,endpoint.settings.revision);
}
int main() {
  // Preserve assertion diagnostics if Linux LeakSanitizer exits without flushing.
  std::setvbuf(stdout,nullptr,_IONBF,0);
#ifdef PIXIES_BOUNDARY_ONLY
  UNITY_BEGIN(); RUN_TEST(json_chunk_boundaries_1023_1024_1025); return UNITY_END();
#else
  UNITY_BEGIN(); RUN_TEST(bounds_before_allocation); RUN_TEST(framing_rejections);
  RUN_TEST(cooperative_body_and_timeout); RUN_TEST(upload_guards_and_abort);
  RUN_TEST(raw_ota_chunks_remain_binary_and_1024_bytes);
  RUN_TEST(successive_asset_config_and_auth_wire_lengths);
  RUN_TEST(successive_parser_errors_and_early_timeout_wire_lengths);
  RUN_TEST(concat_compatibility_includes_source_terminator);
  RUN_TEST(json_chunk_boundaries_1023_1024_1025);
  RUN_TEST(fragmented_and_short_read_json_chunks);
  RUN_TEST(maximum_config_and_exact_body_limit);
  RUN_TEST(failed_or_bad_receive_never_mutates_config);
  return UNITY_END();
#endif
}
