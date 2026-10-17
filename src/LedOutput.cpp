#include "LedOutput.h"
#include <esp_heap_caps.h>
#include <soc/soc_memory_types.h>
bool PixiesBus::buffersInternal() {
  const auto* a=_method.getData();
  _method.SwapBuffers();
  const auto* b=_method.getData();
  _method.SwapBuffers();
  return a&&b&&esp_ptr_internal(a)&&esp_ptr_internal(b);
}
bool LedOutput::begin(uint16_t count) {
  if(count<1||count>pixies::kMaxLeds) return false;
  frame_=static_cast<pixies::Rgb*>(heap_caps_calloc(count,sizeof(pixies::Rgb),MALLOC_CAP_INTERNAL|MALLOC_CAP_8BIT));
  if(!frame_) return false;
  count_=count;
  bus_=new(std::nothrow) PixiesBus(count,PIXIES_LED_PIN);
  if(!bus_||!bus_->buffersInternal()) return false;
  bus_->Begin(); bus_->ClearTo(RgbColor(0)); bus_->Show();
  clock_.reset(millis()); ready=true; return true;
}
void LedOutput::tick(const pixies::Settings& s,uint32_t now) {
  if(!ready||paused_||!pixies::elapsed(now,lastFrame_,33)||!bus_->CanShow()) return;
  lastFrame_=now;
  power=pixies::render(s,clock_.advance(now),frame_,count_,PIXIES_CURRENT_MA);
  for(uint16_t i=0;i<count_;++i) bus_->SetPixelColor(i,RgbColor(frame_[i].r,frame_[i].g,frame_[i].b));
  bus_->Show(); ++frames;
}
void LedOutput::blank() {
  paused_=true;
  if(ready) {
    // Called once on an accepted update, not in the animation loop.
    bus_->ClearTo(RgbColor(0)); bus_->Show();
  }
}
