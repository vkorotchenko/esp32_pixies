#pragma once
#include <algorithm>
#include <cctype>
#include <cstring>
#include <string>
#include <vector>

namespace fake_string {
// One-shot allocation failure, including reserve() called by concat().
inline int reservesUntilFailure=-1;
}

// Host storage shim for the Arduino-ESP32 2.0.17 String API. In particular,
// concat must copy the source terminator too; std::string::append is NOT an
// adequate substitute. test_adapters.py also executes the unmodified pinned
// concat implementation against this storage interface under ASan/UBSan.
class String {
  std::vector<char> storage_{'\0'};
  unsigned length_=0;
 public:
  String()=default;
  String(const char* s) {
    if(s&&reserve(unsigned(strlen(s)))) { strcpy(wbuffer(),s); setLen(unsigned(strlen(s))); }
  }
  String(const std::string& s):String(s.c_str()) {}
  String(char c):String(std::string(1,c)) {}
  String(unsigned char n):String(std::to_string(n)) {}
  String(int n):String(std::to_string(n)) {}
  String(unsigned n):String(std::to_string(n)) {}
  String(unsigned long n):String(std::to_string(n)) {}
  const char* c_str() const { return storage_.data(); }
  char* wbuffer() { return storage_.data(); }
  unsigned len() const { return length_; }
  void setLen(unsigned n) { length_=n; }
  size_t length() const { return length_; }
  char operator[](size_t n) const { return storage_[n]; }
  bool reserve(unsigned n) {
    if(fake_string::reservesUntilFailure==0) {
      fake_string::reservesUntilFailure=-1;
      return false;
    }
    if(fake_string::reservesUntilFailure>0) --fake_string::reservesUntilFailure;
    if(storage_.size()<=n) storage_.resize(size_t(n)+1);
    return true;
  }
  bool concat(const char*,unsigned);
  bool concat(const char* s) { return concat(s,unsigned(strlen(s))); }
  bool startsWith(const char* s) const { const auto n=strlen(s); return n<=length_&&!memcmp(c_str(),s,n); }
  bool endsWith(const char* s) const { const auto n=strlen(s); return n<=length_&&!memcmp(c_str()+length_-n,s,n); }
  void toLowerCase() { for(unsigned i=0;i<length_;++i) storage_[i]=char(tolower(static_cast<unsigned char>(storage_[i]))); }
  void remove(unsigned at) { if(at<length_) { length_=at; storage_[at]=0; } }
  String& operator+=(const String& s) { concat(s.c_str(),unsigned(s.length())); return *this; }
  String& operator+=(const char* s) { concat(s,unsigned(strlen(s))); return *this; }
  String& operator+=(char c) { const char s[]{c,0}; concat(s,1); return *this; }
  void trim() {
    const std::string s(c_str(),length());
    const auto first=s.find_first_not_of(" \t\r\n"),last=s.find_last_not_of(" \t\r\n");
    *this=String(first==std::string::npos?"":s.substr(first,last-first+1));
  }
  bool equalsIgnoreCase(const String& other) const {
    if(length()!=other.length()) return false;
    for(size_t i=0;i<length();++i)
      if(tolower(static_cast<unsigned char>((*this)[i]))!=tolower(static_cast<unsigned char>(other[i]))) return false;
    return true;
  }
  bool operator==(const String& other) const {
    return length()==other.length()&&!memcmp(c_str(),other.c_str(),length());
  }
  bool operator!=(const String& other) const { return !(*this==other); }
  friend String operator+(String a,const String& b) { a+=b; return a; }
};

#ifndef PIXIES_PINNED_METHODS
inline bool String::concat(const char* source,unsigned size) {
  if(!source) return false;
  if(!size) return true;
  const unsigned end=length_+size;
  if(!reserve(end)) return false;
  // Model the pinned core's length+1 source read, not a success-shaped append.
  memmove(wbuffer()+length_,source,size_t(size)+1);
  length_=end;
  return true;
}
#endif
