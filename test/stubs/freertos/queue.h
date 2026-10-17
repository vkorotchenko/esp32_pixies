#pragma once
#include "FreeRTOS.h"
#include <algorithm>
#include <cstring>
#include <deque>
#include <vector>

struct FakeQueue {
  size_t capacity,itemSize;
  std::deque<std::vector<uint8_t>> items;
};
using QueueHandle_t=FakeQueue*;
namespace fake_rtos {
inline std::vector<QueueHandle_t> queues;
inline void reset() { for(auto* q:queues) delete q; queues.clear(); }
}
inline QueueHandle_t xQueueCreate(size_t capacity,size_t itemSize) {
  auto* q=new FakeQueue{capacity,itemSize,{}};
  fake_rtos::queues.push_back(q); return q;
}
inline void vQueueDelete(QueueHandle_t q) {
  auto& queues=fake_rtos::queues;
  queues.erase(std::remove(queues.begin(),queues.end(),q),queues.end()); delete q;
}
inline BaseType_t xQueueSend(QueueHandle_t q,const void* item,unsigned) {
  if(q->items.size()==q->capacity) return pdFALSE;
  const auto* bytes=static_cast<const uint8_t*>(item);
  q->items.emplace_back(bytes,bytes+q->itemSize); return pdTRUE;
}
inline BaseType_t xQueueSendToFront(QueueHandle_t q,const void* item,unsigned wait) {
  if(xQueueSend(q,item,wait)!=pdTRUE) return pdFALSE;
  auto value=std::move(q->items.back()); q->items.pop_back();
  q->items.push_front(std::move(value)); return pdTRUE;
}
inline BaseType_t xQueueReceive(QueueHandle_t q,void* item,unsigned) {
  if(q->items.empty()) return pdFALSE;
  memcpy(item,q->items.front().data(),q->itemSize); q->items.pop_front(); return pdTRUE;
}
