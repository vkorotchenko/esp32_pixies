#pragma once
#include <Schedule.h>
class ClockService {
 public:
  void tick(uint32_t now,bool stationConnected=false);
  bool sync(int64_t utc,const char* source,uint32_t now);
  bool synced() const { return synced_; }
  int64_t utc() const { return synced_?epoch_+int64_t((elapsedMs_-sampleMs_)/1000):0; }
  uint64_t syncAgeSeconds() const { return (elapsedMs_-sampleMs_)/1000; }
  const char* source() const { return source_; }
 private:
  uint32_t lastMs_=0;
  uint64_t elapsedMs_=0,sampleMs_=0;
  int64_t epoch_=0;
  bool synced_=false,station_=false;
  const char* source_="none";
};
