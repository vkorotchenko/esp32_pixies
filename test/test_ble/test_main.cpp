#include <unity.h>
#include <BleProtocol.h>
#include <cstring>
#include <string>
#include <climits>
using namespace pixies::ble;
void setUp() {}
void tearDown() {}
void round_trip_at_minimum_and_larger_mtu() {
  for(size_t size:{size_t(1),size_t(1024),kMaxMessage})
    for(size_t cap:{size_t(20),size_t(182),kMaxPacket}) {
      std::string input(size,'x'); input[0]='{'; input.back()='}';
      Receiver receiver; uint8_t bytes[kMaxPacket]; size_t offset=0;
      while(offset<size) {
        const auto n=packet(reinterpret_cast<const uint8_t*>(input.data()),size,17,false,offset,bytes,cap);
        TEST_ASSERT_GREATER_THAN(kHeader,n);
        const auto result=receiver.push(bytes,n,100+uint32_t(offset));
        offset+=n-kHeader;
        TEST_ASSERT_EQUAL(offset==size?Result::Complete:Result::Partial,result);
      }
      TEST_ASSERT_EQUAL(size,receiver.size()); TEST_ASSERT_EQUAL(17,receiver.id());
      TEST_ASSERT_EQUAL_MEMORY(input.data(),receiver.data(),size);
      receiver.reset(); TEST_ASSERT_EQUAL(0,receiver.size());
      for(size_t i=0;i<size;++i) TEST_ASSERT_EQUAL(0,receiver.data()[i]);
    }
}
void reject_bad_frames_and_recover() {
  uint8_t bytes[kMaxPacket]; const uint8_t input[]{'{','"','x','"',':','1','}'};
  const auto n=packet(input,sizeof input,7,false,0,bytes,12);
  Receiver receiver;
  TEST_ASSERT_EQUAL(Result::Invalid,receiver.push(bytes,kHeader,0));
  bytes[0]=2; TEST_ASSERT_EQUAL(Result::Invalid,receiver.push(bytes,n,0)); bytes[0]=1;
  bytes[1]=1; TEST_ASSERT_EQUAL(Result::Invalid,receiver.push(bytes,n,0)); bytes[1]=0;
  TEST_ASSERT_EQUAL(Result::Partial,receiver.push(bytes,n,0));
  TEST_ASSERT_EQUAL(Result::Invalid,receiver.push(bytes,n,1));
  bytes[2]=8; TEST_ASSERT_EQUAL(Result::Busy,receiver.push(bytes,n,1)); bytes[2]=7;
  TEST_ASSERT_FALSE(receiver.expired(kTimeoutMs-1)); TEST_ASSERT_TRUE(receiver.expired(kTimeoutMs));
  receiver.reset();
  TEST_ASSERT_EQUAL(Result::Partial,receiver.push(bytes,n,UINT32_MAX-9));
  TEST_ASSERT_FALSE(receiver.expired(10));
  TEST_ASSERT_TRUE(receiver.expired(kTimeoutMs));
  receiver.reset();
  bytes[6]=1; bytes[7]=32;
  TEST_ASSERT_EQUAL(Result::Invalid,receiver.push(bytes,n,0));
  TEST_ASSERT_EQUAL(0,packet(input,sizeof input,0,false,0,bytes,sizeof bytes));
}
void wire_vector_and_direction() {
  const uint8_t input[]{'{','}'};
  const uint8_t expected[]{1,1,0x34,0x12,0,0,2,0,'{','}'};
  uint8_t bytes[20];
  TEST_ASSERT_EQUAL(sizeof expected,packet(input,2,0x1234,true,0,bytes,sizeof bytes));
  TEST_ASSERT_EQUAL_MEMORY(expected,bytes,sizeof expected);
  Receiver receiver;
  TEST_ASSERT_EQUAL(Result::Invalid,receiver.push(bytes,sizeof expected,0));
  TEST_ASSERT_EQUAL(Result::Complete,receiver.push(bytes,sizeof expected,0,true));
}
int main() {
  UNITY_BEGIN(); RUN_TEST(round_trip_at_minimum_and_larger_mtu);
  RUN_TEST(reject_bad_frames_and_recover); RUN_TEST(wire_vector_and_direction);
  return UNITY_END();
}
