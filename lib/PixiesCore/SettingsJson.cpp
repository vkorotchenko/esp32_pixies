#include "SettingsJson.h"
#include <cstring>
#include <cstdio>
namespace pixies {
bool completeJsonObject(const char* s,size_t n) {
  // ArduinoJson intentionally permits bytes after a complete value. Enforce one
  // entire object before letting it parse syntax, types and nesting.
  bool quoted=false,escape=false,started=false,ended=false;
  unsigned depth=0;
  for(size_t i=0;i<n;++i) {
    const unsigned char c=static_cast<unsigned char>(s[i]);
    if(!c) return false;
    if(quoted) {
      if(c<32) return false;
      if(escape) escape=false;
      else if(c=='\\') escape=true;
      else if(c=='"') quoted=false;
      continue;
    }
    const bool white=c==' '||c=='\t'||c=='\r'||c=='\n';
    if(ended) { if(!white) return false; continue; }
    if(!started) {
      if(white) continue;
      if(c!='{') return false;
      started=true;
    }
    if(c=='"') quoted=true;
    else if(c=='{'||c=='[') { if(++depth>7) return false; }
    else if(c=='}'||c==']') {
      if(!depth) return false;
      if(!--depth) ended=true;
    }
  }
  return started&&ended&&!quoted;
}
bool keysOnly(JsonObjectConst obj,const char* const* keys,size_t n) {
  for (JsonPairConst pair:obj) {
    bool found=false;
    for(size_t i=0;i<n;++i) if(!strcmp(pair.key().c_str(),keys[i])) found=true;
    if(!found) return false;
  }
  return true;
}
static bool copyText(JsonVariantConst v,char* dest,size_t cap) {
  if(!v.is<const char*>()) return false;
  JsonString s=v.as<JsonString>();
  if (!s.size()||s.size()>=cap||strlen(s.c_str())!=s.size()) return false;
  memcpy(dest,s.c_str(),s.size()+1);
  return true;
}
static bool number(JsonVariantConst v,unsigned max,unsigned& out) {
  if(!v.is<unsigned>() || v.is<bool>()) return false;
  out=v.as<unsigned>(); return out<=max;
}
static int hex(char c) {
  if(c>='0'&&c<='9') return c-'0';
  if(c>='a'&&c<='f') return c-'a'+10;
  if(c>='A'&&c<='F') return c-'A'+10;
  return -1;
}
bool readSettings(JsonVariantConst value,Settings& out,const char*& field) {
  const char* const keys[]{"ledCount","on","brightness","speed","intensity","density","effect","paletteId","customPalettes"};
  field="config";
  if(!value.is<JsonObjectConst>()) return false;
  auto obj=value.as<JsonObjectConst>();
  if(obj.size()!=9||!keysOnly(obj,keys,9)) return false;
  Settings tmp;
  unsigned n;
  field="ledCount";
  if(!number(obj["ledCount"],1000,n)||n<1) return false;
  tmp.ledCount=uint16_t(n);
  field="on";
  if(!obj["on"].is<bool>()) return false;
  tmp.on=obj["on"].as<bool>();
  struct Control { const char* name; uint8_t* value; };
  const Control controls[]{{"brightness",&tmp.brightness},{"speed",&tmp.speed},{"intensity",&tmp.intensity},{"density",&tmp.density}};
  for(const auto& c:controls) {
    field=c.name;
    if(!number(obj[c.name],100,n)) return false;
    *c.value=uint8_t(n);
  }
  field="effect";
  if(!obj["effect"].is<const char*>()||!parseEffect(obj["effect"],tmp.effect)) return false;
  field="paletteId";
  if(!copyText(obj["paletteId"],tmp.paletteId,sizeof tmp.paletteId)) return false;
  field="customPalettes";
  if(!obj["customPalettes"].is<JsonArrayConst>()) return false;
  auto palettes=obj["customPalettes"].as<JsonArrayConst>();
  if(palettes.size()>kMaxPalettes) return false;
  const char* const pkeys[]{"id","name","colors"};
  for(JsonVariantConst v:palettes) {
    if(!v.is<JsonObjectConst>()) return false;
    auto p=v.as<JsonObjectConst>();
    if(p.size()!=3||!keysOnly(p,pkeys,3)) return false;
    auto& dest=tmp.custom[tmp.customCount++];
    if(!copyText(p["id"],dest.id,sizeof dest.id)||!copyText(p["name"],dest.name,sizeof dest.name)||
       !p["colors"].is<JsonArrayConst>()) return false;
    auto colors=p["colors"].as<JsonArrayConst>();
    if(colors.size()<1||colors.size()>kMaxColors) return false;
    for(JsonVariantConst c:colors) {
      if(!c.is<const char*>()) return false;
      const JsonString str=c.as<JsonString>();
      if(str.size()!=7||str.c_str()[0]!='#') return false;
      const char* s=str.c_str();
      uint32_t rgb=0;
      for(int i=1;i<7;++i) { int h=hex(s[i]); if(h<0) return false; rgb=(rgb<<4)|unsigned(h); }
      dest.colors[dest.count++]={uint8_t(rgb>>16),uint8_t(rgb>>8),uint8_t(rgb)};
    }
  }
  if(!validate(tmp,field)) return false;
  out=tmp; return true;
}
void writePalette(JsonObject obj,const Palette& p,bool builtin) {
  obj["id"]=p.id; obj["name"]=p.name;
  if(builtin) obj["builtin"]=true;
  auto colors=obj.createNestedArray("colors");
  for(size_t i=0;i<p.count;++i) {
    char color[8];
    snprintf(color,sizeof color,"#%02X%02X%02X",p.colors[i].r,p.colors[i].g,p.colors[i].b);
    colors.add(color);
  }
}
void writeSettings(JsonObject obj,const Settings& s) {
  obj["ledCount"]=s.ledCount; obj["on"]=s.on; obj["brightness"]=s.brightness;
  obj["speed"]=s.speed; obj["intensity"]=s.intensity; obj["density"]=s.density;
  obj["effect"]=effectName(s.effect); obj["paletteId"]=s.paletteId;
  auto palettes=obj.createNestedArray("customPalettes");
  for(size_t i=0;i<s.customCount;++i) writePalette(palettes.createNestedObject(),s.custom[i],false);
}
}
