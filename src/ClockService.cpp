#include "ClockService.h"
#ifdef ARDUINO
#include <Arduino.h>
#include <time.h>
#include <esp_sntp.h>
#include <atomic>
namespace {
std::atomic<int32_t> pendingNtp{0};
void timeSample(struct timeval* tv) {
  if(tv->tv_sec>=pixies::kUtcStart&&tv->tv_sec<pixies::kUtcEnd)
    pendingNtp.store(int32_t(tv->tv_sec));
}
}
#endif
void ClockService::tick(uint32_t now,bool connected) {
  elapsedMs_+=uint32_t(now-lastMs_); lastMs_=now;
#ifdef ARDUINO
  if(connected&&!station_) {
    sntp_set_time_sync_notification_cb(timeSample);
    configTzTime("UTC0","pool.ntp.org","time.nist.gov");
  }
  const auto sample=pendingNtp.exchange(0);
  if(sample) sync(sample,"ntp",now);
#endif
  station_=connected;
  if(synced_&&utc()>=pixies::kUtcEnd) synced_=false;
}
bool ClockService::sync(int64_t utc,const char* source,uint32_t now) {
  if(utc<pixies::kUtcStart||utc>=pixies::kUtcEnd) return false;
  elapsedMs_+=uint32_t(now-lastMs_); lastMs_=now;
  epoch_=utc; sampleMs_=elapsedMs_; synced_=true; source_=source;
  return true;
}
