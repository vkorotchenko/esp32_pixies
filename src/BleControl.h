#pragma once
#include "DeviceControl.h"
#include <BleProtocol.h>
#include <NimBLEDevice.h>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>

class BleControl : private NimBLEServerCallbacks, private NimBLECharacteristicCallbacks {
 public:
  explicit BleControl(DeviceControl& control):control_(control) {}
  bool begin(const char*);
  void tick(uint32_t);
 private:
  struct Frame {
    uint32_t generation;
    uint16_t size;
    uint8_t bytes[pixies::ble::kMaxPacket];
  };
  DeviceControl& control_;
  NimBLEServer* server_=nullptr;
  NimBLECharacteristic* tx_=nullptr;
  QueueHandle_t queue_=nullptr;
  std::atomic<uint16_t> connection_{BLE_HS_CONN_HANDLE_NONE};
  std::atomic<uint32_t> generation_{0};
  std::atomic<bool> subscribed_{false},secured_{false},overflow_{false};
  uint32_t seenGeneration_=0,sentAt_=0,txStarted_=0;
  pixies::ble::Receiver receiver_;
  std::array<uint8_t,pixies::ble::kMaxMessage> response_{};
  size_t responseSize_=0,responseOffset_=0;
  uint16_t responseId_=0;
  uint32_t otaGeneration_=0,otaTouched_=0;
  uint16_t otaHandle_=BLE_HS_CONN_HANDLE_NONE;
  char otaId_[17]{},otaVersion_[24]{};
  bool otaRestartPending_=false;
  void onConnect(NimBLEServer*,NimBLEConnInfo&) override;
  void onDisconnect(NimBLEServer*,NimBLEConnInfo&,int) override;
  void onAuthenticationComplete(NimBLEConnInfo&) override;
  void onWrite(NimBLECharacteristic*,NimBLEConnInfo&) override;
  void onSubscribe(NimBLECharacteristic*,NimBLEConnInfo&,uint16_t) override;
  void reply(uint16_t,int,JsonDocument&,uint32_t);
  void error(uint16_t,const char*,const char*,uint32_t);
  void execute(uint32_t);
  int otaCommand(const char*,JsonVariantConst,JsonDocument&,uint32_t);
};
