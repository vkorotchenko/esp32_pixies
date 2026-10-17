#pragma once
#include <array>
#include <cstddef>
#include <cstdint>

namespace pixies {
constexpr uint16_t kMaxLeds = 1000;
constexpr size_t kMaxPalettes = 10, kMaxColors = 8;
struct Rgb {
  uint8_t r = 0, g = 0, b = 0;
  bool operator==(const Rgb& o) const { return r == o.r && g == o.g && b == o.b; }
};
struct Palette {
  char id[25]{};
  char name[33]{};
  uint8_t count = 0;
  std::array<Rgb, kMaxColors> colors{};
};
enum class Effect : uint8_t { Steady, Twinkle, Candle, Breathe, Chase };
struct Settings {
  uint16_t ledCount = 200;
  bool on = true;
  uint8_t brightness = 25, speed = 50, intensity = 50, density = 50;
  Effect effect = Effect::Twinkle;
  char paletteId[25] = "builtin:light-blue";
  uint8_t customCount = 0;
  std::array<Palette, kMaxPalettes> custom{};
};
const Palette& halloween();
const Palette& christmas();
const Palette& lightBlue();
const Palette* selectedPalette(const Settings&);
const char* effectName(Effect);
bool parseEffect(const char*, Effect&);
bool validate(const Settings&, const char*& field);
bool equal(const Settings&, const Settings&);
// Revisions are per boot; a failed persistence operation must NOT call saved().
struct SettingsState {
  Settings live{}, persisted{};
  uint16_t activeCount = 200;
  uint32_t revision = 1, savedRevision = 1;
  void restore(const Settings& s);
  bool preview(const Settings& s, uint32_t baseRevision);
  void saved();
  bool dirty() const { return !equal(live, persisted); }
  bool restartRequired() const { return live.ledCount != activeCount; }
};
struct Power {
  uint32_t estimatedMa = 0, requestedMa = 0;
  uint16_t scalePermille = 1000;
  bool limited = false;
};
Power render(const Settings&, uint64_t elapsedMs, Rgb*, size_t activeCount, uint32_t budgetMa);
class Clock {
  uint32_t last_ = 0;
  uint64_t elapsed_ = 0;
 public:
  void reset(uint32_t now) { last_ = now; elapsed_ = 0; }
  uint64_t advance(uint32_t now) { elapsed_ += uint32_t(now - last_); last_ = now; return elapsed_; }
};
inline bool elapsed(uint32_t now, uint32_t since, uint32_t ms) {
  return uint32_t(now - since) >= ms;
}
// Small pure decisions shared by adapters and native tests.
enum class ConnectResult { Waiting, CommitCandidate, Connected, FailedCandidate, Fallback };
ConnectResult connectionDecision(bool candidate, bool connected, uint32_t ageMs);
bool passwordLength(size_t length);
bool canClaim(bool configured, bool apOpen, bool peerOnAp);
bool adminAllowed(bool sessionValid, bool originValid, bool csrfValid);
bool otaStartAllowed(bool authorized, bool busy, size_t declared, size_t slot);
struct OtaTransfer {
  size_t expected = 0, received = 0;
  bool failed = false;
  bool begin(size_t declared, size_t slot);
  bool chunk(size_t n);
  bool complete(bool imageValid) const;
};
uint32_t crc32(const uint8_t*, size_t);
struct RecordHeader { uint32_t magic, version, length, crc; };
constexpr uint32_t kRecordMagic=0x50585931;
bool validRecord(const RecordHeader&,const uint8_t* payload,size_t storedLength,size_t capacity);
struct ImageIdentity {
  uint8_t magic, segments, flashSize, hashAppended;
  uint16_t chip;
  uint32_t appMagic, secureVersion;
};
bool supportedImage(const ImageIdentity&);
struct LoginThrottle {
  uint32_t lastAttempt=0;
  uint8_t failures=0;
  bool attempted=false;
  uint32_t retryAfter(uint32_t now) const;
  void result(uint32_t now,bool success);
};
}  // namespace pixies
