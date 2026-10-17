#include "BleControl.h"
#include <algorithm>
#include <cstring>
#include <SemVer.h>
#include <esp_system.h>
#include <mbedtls/base64.h>

bool BleControl::begin(const char* name) {
  control_.ota.bleGuard=[this](){
    return secured_&&connection_!=BLE_HS_CONN_HANDLE_NONE&&
      connection_==otaHandle_&&generation_==otaGeneration_;
  };
  control_.clearBonds=[](){
    return NimBLEDevice::isInitialized()&&NimBLEDevice::deleteAllBonds()&&NimBLEDevice::getNumBonds()==0;
  };
  const auto failed=[this]() {
    if(NimBLEDevice::isInitialized()&&!NimBLEDevice::deinit(true))
      Serial.println("BLE initialization cleanup failed.");
    server_=nullptr; tx_=nullptr;
    if(queue_) { vQueueDelete(queue_); queue_=nullptr; }
    return false;
  };
  queue_=xQueueCreate(8,sizeof(Frame));
  if(!queue_||!NimBLEDevice::init(name)||!NimBLEDevice::setMTU(247)) return failed();
  NimBLEDevice::setSecurityAuth(true,false,true);
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);
  server_=NimBLEDevice::createServer();
  if(!server_) return failed();
  server_->setCallbacks(this,false); server_->advertiseOnDisconnect(true);
  auto* service=server_->createService(pixies::ble::kService);
  if(!service) return failed();
  auto* rx=service->createCharacteristic(pixies::ble::kRx,NIMBLE_PROPERTY::WRITE|NIMBLE_PROPERTY::WRITE_ENC,pixies::ble::kMaxPacket);
  tx_=service->createCharacteristic(pixies::ble::kTx,NIMBLE_PROPERTY::NOTIFY,pixies::ble::kMaxPacket);
  if(!rx||!tx_) return failed();
  rx->setCallbacks(this); tx_->setCallbacks(this);
  if(!server_->start()) return failed();
  NimBLEAdvertisementData advertisement,scan;
  if(!advertisement.setFlags(BLE_HS_ADV_F_DISC_GEN|BLE_HS_ADV_F_BREDR_UNSUP)||
     !advertisement.addServiceUUID(pixies::ble::kService)||!scan.setName(name)) return failed();
  auto* advertising=NimBLEDevice::getAdvertising();
  if(!advertising) return failed();
  advertising->enableScanResponse(true);
  if(!advertising->setAdvertisementData(advertisement)||!advertising->setScanResponseData(scan)||!advertising->start()) return failed();
  return true;
}
void BleControl::onConnect(NimBLEServer* server,NimBLEConnInfo& info) {
  uint16_t expected=BLE_HS_CONN_HANDLE_NONE;
  if(!connection_.compare_exchange_strong(expected,info.getConnHandle())) {
    server->disconnect(info); return;
  }
  generation_.fetch_add(1); subscribed_=false; secured_=false;
  Serial.printf("BLE connected: handle=%u, encrypted=%u, bonded=%u\n",
    info.getConnHandle(),info.isEncrypted(),info.isBonded());
  int securityResult=0;
  if(!NimBLEDevice::startSecurity(info.getConnHandle(),&securityResult)) {
    Serial.printf("BLE security could not start: rc=%d; disconnecting.\n",securityResult);
    server->disconnect(info);
  }
}
void BleControl::onDisconnect(NimBLEServer*,NimBLEConnInfo& info,int reason) {
  Serial.printf("BLE disconnected: handle=%u, reason=%d\n",info.getConnHandle(),reason);
  if(connection_==info.getConnHandle()) {
    connection_=BLE_HS_CONN_HANDLE_NONE; subscribed_=false; secured_=false; generation_.fetch_add(1);
  }
}
void BleControl::onAuthenticationComplete(NimBLEConnInfo& info) {
  Serial.printf("BLE security completed: handle=%u, encrypted=%u, bonded=%u, keyBytes=%u\n",
    info.getConnHandle(),info.isEncrypted(),info.isBonded(),info.getSecKeySize());
  if(connection_!=info.getConnHandle()) return;
  if(!info.isEncrypted()||!info.isBonded()) {
    secured_=false;
    Serial.println("BLE pairing was not completed; disconnecting.");
    server_->disconnect(info);
  } else secured_=true;
}
void BleControl::onSubscribe(NimBLECharacteristic*,NimBLEConnInfo& info,uint16_t value) {
  Serial.printf("BLE notifications: handle=%u, enabled=%u\n",info.getConnHandle(),value&1);
  if(connection_==info.getConnHandle()) subscribed_=(value&1)!=0;
}
void BleControl::onWrite(NimBLECharacteristic* characteristic,NimBLEConnInfo& info) {
  if(!info.isEncrypted()||connection_!=info.getConnHandle()) {
    Serial.printf("BLE write rejected: handle=%u, encrypted=%u, bonded=%u\n",
      info.getConnHandle(),info.isEncrypted(),info.isBonded());
    server_->disconnect(info); return;
  }
  // ATT encryption can be active while SMP is still exchanging bond keys.
  // Queue these writes; tick() executes nothing until authentication completes.
  const auto& value=characteristic->getValue();
  Frame frame{}; frame.generation=generation_; frame.size=value.size();
  if(!queue_||frame.size>sizeof frame.bytes) { overflow_=true; return; }
  memcpy(frame.bytes,value.data(),frame.size);
  if(xQueueSend(queue_,&frame,0)!=pdTRUE) overflow_=true;
  memset(frame.bytes,0,sizeof frame.bytes);
  uint8_t zeros[pixies::ble::kMaxPacket]{};
  characteristic->setValue(zeros,value.size());
  characteristic->setValue(zeros,0);
}
void BleControl::reply(uint16_t id,int status,JsonDocument& doc,uint32_t now) {
  if(!id||responseSize_) {
    Serial.println("BLE transaction overlap; disconnecting.");
    server_->disconnect(connection_); return;
  }
  const int prefix=snprintf(reinterpret_cast<char*>(response_.data()),response_.size(),"{\"status\":%d,\"body\":",status);
  if(doc.overflowed()||prefix<0||size_t(prefix)+measureJson(doc)+1>response_.size()) {
    const char* unavailable="{\"status\":503,\"body\":{\"error\":{\"code\":\"out_of_memory\",\"message\":\"Response unavailable; reload device state\"}}}";
    responseSize_=strlen(unavailable); memcpy(response_.data(),unavailable,responseSize_);
  } else {
    responseSize_=size_t(prefix)+serializeJson(doc,response_.data()+prefix,response_.size()-size_t(prefix)-1);
    response_[responseSize_++]='}';
  }
  responseOffset_=0; responseId_=id; txStarted_=now;
}
void BleControl::error(uint16_t id,const char* code,const char* message,uint32_t now) {
  StaticJsonDocument<256> doc;
  auto e=doc.createNestedObject("error"); e["code"]=code; e["message"]=message;
  reply(id,400,doc,now);
}
void BleControl::execute(uint32_t now) {
  DynamicJsonDocument request(pixies::kJsonCapacity),result(pixies::kJsonCapacity);
  const uint16_t id=receiver_.id();
  const char* keys[]{"op","args"};
  if(!pixies::completeJsonObject(receiver_.data(),receiver_.size())||
     deserializeJson(request,receiver_.data(),receiver_.size(),DeserializationOption::NestingLimit(8))||
     !request.is<JsonObject>()||request.size()!=2||!pixies::keysOnly(request.as<JsonObjectConst>(),keys,2)||
     !request["op"].is<const char*>()||!request["args"].is<JsonObject>()) {
    error(id,"invalid_json","Expected a complete {op,args} command",now);
  } else {
    const JsonString op=request["op"].as<JsonString>();
    if(op.size()>32||strlen(op.c_str())!=op.size()) error(id,"invalid_json","Invalid command name",now);
    else {
      const int status=!strncmp(op.c_str(),"ota.",4)
        ?otaCommand(op.c_str(),request["args"],result,now)
        :control_.execute(op.c_str(),request["args"],result);
      reply(id,status,result,now);
    }
  }
  receiver_.reset();
}
int BleControl::otaCommand(const char* op,JsonVariantConst args,JsonDocument& out,uint32_t now) {
  auto& ota=control_.ota;
  const auto fail=[&](int status,const char* code,const char* message) {
    out.clear(); auto e=out.createNestedObject("error"); e["code"]=code; e["message"]=message;
    return status;
  };
  const auto fields=[&](std::initializer_list<const char*> keys) {
    return args.is<JsonObjectConst>()&&args.size()==keys.size()&&
      pixies::keysOnly(args.as<JsonObjectConst>(),keys.begin(),keys.size());
  };
  if(!strcmp(op,"ota.begin")) {
    if(!fields({"size","sha256","version","target"})||!args["size"].is<uint32_t>()||
       args["size"].is<bool>()||!args["sha256"].is<const char*>()||
       !args["version"].is<const char*>()||!args["target"].is<const char*>())
      return fail(422,"validation","Expected size, sha256, version and target");
    int comparison=0;
    if(args["target"]!=PIXIES_TARGET||
       !pixies::compareVersion(args["version"],PIXIES_VERSION,comparison)||comparison<=0||
       args["version"].as<JsonString>().size()!=strlen(args["version"])||
       args["sha256"].as<JsonString>().size()!=64)
      return fail(422,"incompatible_update","Target must match and version must be newer");
    if(ota.busy||control_.restarting||control_.network.operationBusy()||
       !strcmp(control_.network.scanState,"running"))
      return fail(409,"busy","Finish other device operations before updating");
    otaGeneration_=generation_; otaHandle_=connection_;
    if(!ota.begin(args["size"].as<uint32_t>(),OtaOwner::Ble,args["sha256"]))
      return fail(422,"update_rejected",ota.error);
    snprintf(otaId_,sizeof otaId_,"%08lx%08lx",static_cast<unsigned long>(esp_random()),static_cast<unsigned long>(esp_random()));
    strcpy(otaVersion_,args["version"]); otaTouched_=now;
    out["transferId"]=otaId_; out["offset"]=0; out["chunkBytes"]=1024; return 200;
  }
  if(strcmp(op,"ota.chunk")&&strcmp(op,"ota.finish")&&strcmp(op,"ota.abort"))
    return fail(404,"not_found","Unknown update command");
  if(!ota.owns(OtaOwner::Ble)||otaGeneration_!=generation_||otaHandle_!=connection_||
     !args["transferId"].is<const char*>()||args["transferId"].as<JsonString>().size()!=16||
     strcmp(args["transferId"],otaId_))
    return fail(409,"transfer_lost","Update session is unavailable; start again explicitly");
  if(otaRestartPending_) return fail(409,"busy","Verified update is restarting");
  if(!strcmp(op,"ota.chunk")) {
    if(!fields({"transferId","offset","data"})||!args["offset"].is<uint32_t>()||
       args["offset"].is<bool>()||!args["data"].is<const char*>())
      return fail(422,"validation","Expected transferId, offset and base64 data");
    if(args["offset"].as<uint32_t>()!=ota.received()) {
      ota.abort("offset_mismatch",OtaOwner::Ble);
      return fail(409,"offset_mismatch","Chunk was not the exact next offset; transfer aborted");
    }
    const auto text=args["data"].as<JsonString>(); uint8_t bytes[1024]; size_t size=0;
    if(!text.size()||text.size()>1368||strlen(text.c_str())!=text.size()||
       mbedtls_base64_decode(bytes,sizeof bytes,&size,
         reinterpret_cast<const unsigned char*>(text.c_str()),text.size())!=0||!size) {
      ota.abort("invalid_chunk",OtaOwner::Ble);
      return fail(422,"invalid_chunk","Expected at most 1024 decoded bytes");
    }
    if(!ota.chunk(bytes,size,OtaOwner::Ble)) return fail(422,"update_failed",ota.error);
    otaTouched_=now; out["transferId"]=otaId_; out["offset"]=ota.received(); return 200;
  }
  if(!fields({"transferId"})) return fail(422,"validation","Expected only transferId");
  if(!strcmp(op,"ota.abort")) {
    ota.abort("canceled",OtaOwner::Ble); out["state"]="aborted"; return 200;
  }
  if(!ota.end(OtaOwner::Ble)||!ota.select(OtaOwner::Ble)) return fail(422,"update_failed",ota.error);
  otaRestartPending_=true;
  out["state"]="restarting"; out["version"]=otaVersion_; out["receivedBytes"]=ota.received();
  return 202;
}
void BleControl::tick(uint32_t now) {
  if(!server_||!queue_) return;
  const uint32_t generation=generation_;
  if(generation!=seenGeneration_) {
    if(otaRestartPending_) { otaRestartPending_=false; control_.restartLater(); }
    else if(control_.ota.owns(OtaOwner::Ble)) control_.ota.abort("disconnected",OtaOwner::Ble);
    seenGeneration_=generation; receiver_.reset(); response_.fill(0);
    responseSize_=responseOffset_=0; overflow_=false;
  }
  if(control_.ota.owns(OtaOwner::Ble)&&!otaRestartPending_&&
     pixies::elapsed(now,otaTouched_,60000)) control_.ota.abort("transfer_timeout",OtaOwner::Ble);
  const auto handle=connection_.load();
  if(overflow_.exchange(false)) {
    Serial.println("BLE receive queue full; disconnecting.");
    server_->disconnect(handle); return;
  }
  if(handle==BLE_HS_CONN_HANDLE_NONE) {
    Frame discarded{};
    while(xQueueReceive(queue_,&discarded,0)==pdTRUE) {
      if(discarded.generation==generation_.load()&&connection_!=BLE_HS_CONN_HANDLE_NONE) {
        if(xQueueSendToFront(queue_,&discarded,0)!=pdTRUE) overflow_=true;
        memset(&discarded,0,sizeof discarded); break;
      }
      memset(&discarded,0,sizeof discarded);
    }
    return;
  }
  if(!secured_) return;
  if(responseSize_) {
    if(pixies::elapsed(now,txStarted_,pixies::ble::kTimeoutMs)) {
      Serial.println("BLE response timed out; disconnecting.");
      server_->disconnect(handle); return;
    }
    if(subscribed_&&generation==generation_.load()&&pixies::elapsed(now,sentAt_,5)) {
      uint8_t bytes[pixies::ble::kMaxPacket];
      const size_t cap=std::min(size_t(server_->getPeerMTU(handle)-3),sizeof bytes);
      const size_t n=pixies::ble::packet(response_.data(),responseSize_,responseId_,true,responseOffset_,bytes,cap);
      if(n&&tx_->notify(bytes,n,handle)) {
        responseOffset_+=n-pixies::ble::kHeader; sentAt_=now;
        if(responseOffset_==responseSize_) {
          response_.fill(0); responseSize_=responseOffset_=0;
          if(otaRestartPending_) { otaRestartPending_=false; control_.restartLater(); }
        }
      }
    }
    return;
  }
  if(receiver_.expired(now)) {
    error(receiver_.id(),"message_timeout","Incomplete command expired; retry with a new transaction",now);
    receiver_.reset(); return;
  }
  Frame frame{};
  unsigned budget=8;
  while(budget--&&xQueueReceive(queue_,&frame,0)==pdTRUE) {
    if(frame.generation!=generation||generation!=generation_.load()) { memset(&frame,0,sizeof frame); continue; }
    const auto result=receiver_.push(frame.bytes,frame.size,now);
    if(result==pixies::ble::Result::Complete) {
      execute(now); memset(&frame,0,sizeof frame); return;
    }
    if(result!=pixies::ble::Result::Partial) {
      const auto id=frame.size>=4?pixies::ble::read16(frame.bytes+2):0;
      error(id,"invalid_frame","Invalid, overlapping, or out-of-order command",now);
      receiver_.reset(); memset(&frame,0,sizeof frame); return;
    }
    memset(&frame,0,sizeof frame);
  }
}
