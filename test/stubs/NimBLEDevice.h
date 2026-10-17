#pragma once
// Drive the production BLE callbacks with the SDK's separate encryption/bond
// states. No radio, encryption, or pairing implementation is simulated here.
#include <cstdint>
#include <vector>

constexpr uint16_t BLE_HS_CONN_HANDLE_NONE=0xffff;
constexpr int BLE_HS_IO_NO_INPUT_OUTPUT=3;
constexpr unsigned BLE_HS_ADV_F_DISC_GEN=2,BLE_HS_ADV_F_BREDR_UNSUP=4;
namespace NIMBLE_PROPERTY { constexpr unsigned WRITE=1,WRITE_ENC=2,NOTIFY=4; }
class NimBLEServer;
class NimBLECharacteristic;
struct NimBLEConnInfo {
  uint16_t handle=7;
  bool encrypted=false,bonded=false;
  uint16_t getConnHandle() const { return handle; }
  bool isEncrypted() const { return encrypted; }
  bool isBonded() const { return bonded; }
  uint8_t getSecKeySize() const { return encrypted?16:0; }
};
class NimBLEServerCallbacks {
 public:
  virtual ~NimBLEServerCallbacks()=default;
  virtual void onConnect(NimBLEServer*,NimBLEConnInfo&) {}
  virtual void onDisconnect(NimBLEServer*,NimBLEConnInfo&,int) {}
  virtual void onAuthenticationComplete(NimBLEConnInfo&) {}
};
class NimBLECharacteristicCallbacks {
 public:
  virtual ~NimBLECharacteristicCallbacks()=default;
  virtual void onSubscribe(NimBLECharacteristic*,NimBLEConnInfo&,uint16_t) {}
  virtual void onWrite(NimBLECharacteristic*,NimBLEConnInfo&) {}
};
class NimBLECharacteristic {
 public:
  NimBLECharacteristicCallbacks* callbacks=nullptr;
  std::vector<uint8_t> value;
  std::vector<std::vector<uint8_t>> notifications;
  void setCallbacks(NimBLECharacteristicCallbacks* c) { callbacks=c; }
  const std::vector<uint8_t>& getValue() const { return value; }
  void setValue(const uint8_t* data,size_t size) { value.assign(data,data+size); }
  bool notify(const uint8_t* data,size_t size,uint16_t) {
    notifications.emplace_back(data,data+size); return true;
  }
};
class NimBLEService {
 public:
  NimBLECharacteristic rx,tx;
  unsigned created=0;
  NimBLECharacteristic* createCharacteristic(const char*,unsigned,size_t) {
    return created++==0?&rx:&tx;
  }
};
class NimBLEServer {
 public:
  NimBLEServerCallbacks* callbacks=nullptr;
  NimBLEService service;
  std::vector<uint16_t> disconnected;
  void setCallbacks(NimBLEServerCallbacks* c,bool) { callbacks=c; }
  void advertiseOnDisconnect(bool) {}
  NimBLEService* createService(const char*) { return &service; }
  bool start() { return true; }
  void disconnect(uint16_t handle) { disconnected.push_back(handle); }
  void disconnect(const NimBLEConnInfo& info) { disconnect(info.getConnHandle()); }
  uint16_t getPeerMTU(uint16_t) const { return 247; }
};
class NimBLEAdvertisementData {
 public:
  bool setFlags(unsigned) { return true; }
  bool addServiceUUID(const char*) { return true; }
  bool setName(const char*) { return true; }
};
class NimBLEAdvertising {
 public:
  void enableScanResponse(bool) {}
  bool setAdvertisementData(const NimBLEAdvertisementData&) { return true; }
  bool setScanResponseData(const NimBLEAdvertisementData&) { return true; }
  bool start() { return true; }
};
class NimBLEDevice {
 public:
  static inline bool initialized=false;
  static inline NimBLEServer server;
  static inline NimBLEAdvertising advertising;
  static bool isInitialized() { return initialized; }
  static bool init(const char*) { initialized=true; return true; }
  static bool deinit(bool) { initialized=false; return true; }
  static bool setMTU(uint16_t) { return true; }
  static void setSecurityAuth(bool,bool,bool) {}
  static void setSecurityIOCap(int) {}
  static bool startSecurity(uint16_t,int* result=nullptr) { if(result) *result=0; return true; }
  static bool deleteAllBonds() { return true; }
  static unsigned getNumBonds() { return 0; }
  static NimBLEServer* createServer() { return &server; }
  static NimBLEAdvertising* getAdvertising() { return &advertising; }
  static void resetForTest() { initialized=false; server=NimBLEServer{}; }
};
