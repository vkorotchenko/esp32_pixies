#pragma once
#include <cstdint>
namespace pixies {
inline bool versionParts(const char* value,uint32_t (&parts)[3]) {
  if(!value) return false;
  for(unsigned i=0;i<3;++i) {
    const char* start=value; uint32_t number=0; unsigned digits=0;
    while(*value>='0'&&*value<='9') {
      if(++digits>6) return false;
      number=number*10+uint32_t(*value++-'0');
    }
    if(!digits||(digits>1&&*start=='0')) return false;
    parts[i]=number;
    if(i<2) { if(*value++!='.') return false; }
    else if(*value) return false;
  }
  return true;
}
inline bool compareVersion(const char* left,const char* right,int& comparison) {
  uint32_t a[3]{},b[3]{};
  if(!versionParts(left,a)||!versionParts(right,b)) return false;
  comparison=0;
  for(unsigned i=0;i<3;++i) if(a[i]!=b[i]) {
    comparison=a[i]>b[i]?1:-1; break;
  }
  return true;
}
}
