#pragma once
#include <cstdint>
inline uint32_t esp_random() { static uint32_t next=1; return next=next*1664525U+1013904223U; }
