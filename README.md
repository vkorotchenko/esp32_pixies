# ESP32 Pixies

Local, offline-capable controller for one 5V WS2811 serial pixel string. PlatformIO
Arduino firmware for **ESP32-S3-WROOM-1-N16R8**, a React Native Android/iPhone
Bluetooth companion, palette/effect controls, explicit Save, optional local Wi-Fi,
and phone-managed BLE firmware and Android app updates.

**Connection:** use the [mobile app](mobile/README.md) over Bluetooth Low Energy.
No hotspot join, app account, or custom PIN is required. The website remains an
optional local-network/fallback interface.

The app opens on **Lights** while it reconnects the remembered controller and
checks for updates. On first use, it auto-connects only if one controller appears
in the scan. Lights stays visible with greyed-out, disabled controls offline.
The top-right settings icon opens **Connection**, **Updates**, **Wi-Fi**, and
**Device settings**. Orange **!** badges mark connection/update attention on the
icon and relevant menu item; missing Bluetooth or Internet never changes pages.
Firmware and Android app installation still require your approval.

**Lights | Schedule** tabs let you save one ON/OFF window for each weekday.
The controller runs the saved schedule without the app remaining open.
Cold boot needs fresh phone or Wi-Fi/NTP time; expired timezone rules pause
automation OFF. See [weekly scheduling](mobile/README.md#weekly-schedule).

**Hardware status:** USB programming and startup were verified on the target
module. Android BLE connection and lighting-control access are verified. The
identified string uses WS2811 pixels; the WS2811/RGB output profile still needs
physical color and full-string acceptance. A successful build is not a wiring,
signal, radio, or OTA acceptance result.

## Build and test

Use the root Makefile for builds and releases:

```sh
make help
make firmware           # Build only; never uploads to a controller.
make android-dev        # Explicit development signing.
make android-release    # Dedicated production signing; no development fallback.
make dist               # Validate and package firmware, APK, manifest and hashes.
make test
```

`version.json` owns the shared product version and increasing Android version
code. Run `make version-sync` after editing it. Override `PIO`, `PYTHON` or
`ARCHITECTURES` when needed; Android currently defaults to `arm64-v8a`.
Run `npm ci` at the root before `make icons`; mobile builds need
`cd mobile && npm ci`. See [mobile build prerequisites](mobile/README.md).

Requires Python/PlatformIO Core 6.2.0, a native C++17 compiler for tests, and Node
24. Web tests need no npm dependencies or production Node server; the native app
has its own dependency manifest and build steps in `mobile/`.

```sh
pio test -e native
npm test
python3 scripts/check_build.py
pio run -e esp32s3_n16r8
python3 scripts/check_build.py .pio/build/esp32s3_n16r8/firmware.bin
```

If `pio` is not on PATH, use `~/.platformio/penv/bin/platformio` in its place.
Only install PlatformIO if missing, preferably in a task-local virtualenv:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install platformio==6.2.0
.venv/bin/pio run -e esp32s3_n16r8
```

Pinned inputs: `espressif32@7.1.3` (Arduino core 2.0.17 family),
`NeoPixelBus@2.8.4`, `ArduinoJson@6.21.5`, `NimBLE-Arduino@2.5.1`. The platform's framework/tool package
patch build may vary within its compatible range; inspect the build's package
list when reproducing a binary. CI uses the same build/test commands.

The project board manifest deliberately replaces the misleading base N8/no-PSRAM
profile: 16MB Quad flash, `qio_opi` memory, 8MB Octal PSRAM, 80MHz flash.
`BOARD_HAS_PSRAM` is enabled. Status reports detected vs expected memory. The
default USB configuration is native USB CDC (`ARDUINO_USB_MODE=1`,
`ARDUINO_USB_CDC_ON_BOOT=1`); **confirm the actual carrier's USB wiring**. A
USB-UART carrier may need a different console configuration.

Partition layout (stable across browser updates):

| Partition | Offset | Size |
|---|---:|---:|
| NVS | `0x9000` | `0x5000` |
| OTA metadata | `0xE000` | `0x2000` |
| app0 | `0x10000` | `0x700000` (7MiB) |
| app1 | `0x710000` | `0x700000` (7MiB) |

Unused tail is intentional; no filesystem is needed. The post-build gate checks
alignment, overlap, flash bounds, app size, chip/flash header, app descriptor,
exact segment/image length and appended SHA256. Three web assets are embedded
in `firmware.bin`, so a single application upload updates UI and firmware.

## Hardware verification gate

N16R8 identifies a **module**, not the carrier pinout. Do not flash/wire based
only on this profile. Confirm the carrier's schematic, exposed GPIOs, USB port,
BOOT/RESET switches, module marking, memory detection and safe power path first.

Build flags in `platformio.ini` / `include/config.h`:

- `PIXIES_LED_PIN=4`: **provisional**, verify before wiring.
- `PIXIES_LED_WS2811=1`: dedicated WS2811 800kbit/s RMT timing; set 0 for
  the previous WS2812x timing.
- `PIXIES_COLOR_GRB=0`: RGB profile; set 1 for GRB. Verify the actual string's
  channel order with a low-brightness red/green/blue test.
- `PIXIES_CURRENT_MA=9000`: conservative estimated LED budget, configurable
  downward to 1000mA; not a current sensor or electrical protection.
- `PIXIES_RECOVERY_PIN=-1`: physical switch disabled until carrier verified.

GPIO35/36/37 are occupied by Octal PSRAM. Native USB GPIO19/20 and strapping
GPIO0/3/45/46 must not be blindly used for LEDs. Compile-time guards reject these
common conflicts; they do not replace checking all carrier/module reserved pins.

Use a suitable 3.3V-to-5V logic buffer, common ground, a series data resistor
(typically 330–470Ω close to the first pixel), and appropriate bulk/input
decoupling. Never apply 5V to an ESP32 GPIO. Feed power directly to the LED
string with appropriate fused wiring and distributed injection, not through USB
or a controller PCB trace. Prevent unintended USB/5V backfeed.

The confirmed 5V/60W supply is nominally 12A total. An unrestricted 200-pixel
white frame can approach 12A **before** controller/wiring losses. Do not use it
as a test pattern. Software estimates cannot detect shorts, undervoltage, bad
connections or undersized wiring. Measure current/voltage and inspect thermal
behavior; use suitable real protection.

### LED diagnostics

Send **`ledstatus`** followed by a newline over the local USB console at 115200.
It returns the same LED diagnostics as HTTP/BLE status, without network or
administration data: driver readiness, GPIO, compiled protocol/order, active and
requested counts, rendered frames, live lighting controls, and modeled current.
Run it twice a few seconds apart to check frame progress without joining Wi-Fi.
Neither the command nor a firmware update changes saved settings.

Increasing frame counts confirm software submission, not a valid electrical
waveform or successful pixel reception. WS2811 timing and channel order are
separate settings; swapped colors alone do not explain an otherwise dark string.
If only the first pixel responds, verify the data level and first pixel's output
before treating a driver/profile change as a proven fix. Confirm the purchased
voltage variant rather than relying on a listing that offers both 5V and 12V.

### Standalone LED library comparison

The opt-in diagnostic builds replace the app temporarily with an independent
LED driver. They use GPIO4 and 50 RGB pixels, cycling dim red, green, blue and
Off every four seconds. Each active channel is 16/255; no white
test frame is sent. The tests neither read nor write saved settings, and they
do not start Bluetooth or Wi-Fi. The phone app cannot connect during the test.

A dim onboard RGB LED marks diagnostic startup: purple for Adafruit at 800kHz,
cyan for FastLED at 800kHz, and yellow for Adafruit at 400kHz.
It stays on during the external string's Off phase.
It uses the board variant's physical `PIN_NEOPIXEL`:
GPIO48 in the current profile. Confirm that pin against your actual carrier;
the module designation alone does not identify its onboard LED wiring.

The 400kHz test uses the low-speed timing in the
[WS2811 datasheet](https://cdn-shop.adafruit.com/datasheets/WS2811.pdf):
0-bit high/low times of 0.5/2.0us and 1-bit times of 1.2/1.3us. The chip's SET
pin selects 400kHz when tied to VDD, or 800kHz when left floating. Selecting a
test does not change that hardware connection. The onboard LED always uses
800kHz, independently of the external string.

Build the alternatives without flashing:

```sh
make diagnostic-adafruit
make diagnostic-adafruit-400
make diagnostic-fastled
```

After confirming the connected controller's USB port and hardware, upload one
test at a time. Replace `/dev/cu.usbmodem2101` with its actual port:

```sh
pio run -e led_diag_adafruit -t upload --upload-port /dev/cu.usbmodem2101
pio run -e led_diag_adafruit_400 -t upload --upload-port /dev/cu.usbmodem2101
pio run -e led_diag_fastled -t upload --upload-port /dev/cu.usbmodem2101
```

The USB console at 115200 prints the library and each color phase. Observe one
complete cycle before switching libraries; console progress alone does not
prove that the pixels receive the signal. Disconnect power before changing
wiring or extending the string. Software brightness limits do not protect
against misdecoded data, wiring faults or an incorrect supply voltage.

Restore the normal app without erasing NVS:

```sh
pio run -e esp32s3_n16r8 -t upload --upload-port /dev/cu.usbmodem2101
```

### Single-pixel sequential diagnostic

Build the opt-in test without flashing:

```sh
make diagnostic-sequential
```

After independent review and controller/port verification, upload and monitor:

```sh
pio run -e led_diag_sequential -t upload --upload-port /dev/cu.usbmodem2101
pio device monitor --port /dev/cu.usbmodem2101 --baud 115200
```

FastLED 3.9.20 drives GPIO4 with 50 RGB/WS2811 pixels at 800kHz. Exactly one
external pixel is dim red `(16,0,0)` and all other 49 are black. It holds each
position for 1000ms, walking 1 through 50, then wrapping to 1 continuously.
There is no cumulative fill, white frame, or increase in channel level.
This test does not configure an onboard indicator.

The 115200-baud header identifies the library, GPIO, count, `pattern=single-red`,
channel level and `holdMs=1000`. Each step prints `LED_SEQ position=1/50` through
`LED_SEQ position=50/50`, followed by `LED_SEQ position=1/50` on wrap.
The isolated environment leaves production defaults and existing diagnostics unchanged.
It starts no Bluetooth/Wi-Fi and accesses no app settings. Like the static GPIO
test below, its diagnostic-only `--wrap=nvs_flash_init` returns `ESP_OK`, bypassing
Arduino's NVS initialization and erase-on-init-error recovery. Do not erase flash.

One pixel at a time greatly reduces dynamic load. If the tail still fails,
power distribution or a bad data path remains possible; this does not prove
the absence of a power problem or identify a defective pixel.

#### Compare with NeoPixelBus

The third-library variant uses NeoPixelBus 2.8.4, not FastLED, with explicit
`NeoRgbFeature` RGB order and the ESP32-S3-supported `NeoEsp32Rmt0Ws2811Method`
(RMT channel 0, WS2811 at nominal 800kHz). It keeps the same GPIO4, 50-pixel,
single-red `(16,0,0)` walk, 1000ms hold, position output and diagnostic-only NVS
bypass. Its 115200-baud header identifies NeoPixelBus and the RMT method.

Build without flashing, then upload only after independent review and
controller/port verification:

```sh
make diagnostic-sequential-neopixelbus
pio run -e led_diag_sequential_neopixelbus -t upload --upload-port /dev/cu.usbmodem2101
```

Use the same monitor command above and observe positions 1 through 50, then 1.
The existing FastLED sequential environment remains `led_diag_sequential`.

### GPIO4 static-voltage diagnostic

This opt-in test starts explicitly LOW, then repeats GPIO4 HIGH for 5000ms and
LOW for 5000ms indefinitely. It uses only Arduino GPIO calls, with no pixel
libraries, embedded web assets, Wi-Fi/BLE, or NVS reads/writes. The normal app
is unavailable during the test; production build defaults remain unchanged.

For this diagnostic only, `--wrap=nvs_flash_init` redirects Arduino startup's
NVS initialization to a no-op returning `ESP_OK`. The installed Arduino core
has no NVS-only skip-init setting; returning success also bypasses its
NVS-error recovery branch, which could otherwise erase the NVS partition.
The framework and normal app startup are not modified. Recheck the linked
startup path if the framework is upgraded.

Build only:

```sh
make diagnostic-gpio4
```

After confirming the controller and port, upload without erasing flash/NVS and
monitor at 115200 (replace the port if needed):

```sh
pio run -e gpio4_diag_static -t upload --upload-port /dev/cu.usbmodem2101
pio device monitor --port /dev/cu.usbmodem2101 --baud 115200
```

Each transition prints `GPIO4_DIAG t_ms=...; GPIO4=HIGH` (or `LOW`) and
`phase_ms=5000`. With GPIO4 connected to LV1, converter LV powered at 3.3V,
HV at 5V, and common ground, measure **signal channels**, not LV/HV supply rails,
relative to ESP GND: LOW should be approximately 0V on both LV1 and HV1; HIGH
should be approximately 3.3V on LV1 and 5V on HV1.
**GPIO4 is a 3.3V output only: never apply 5V to GPIO4.**
Disconnect power before changing wiring. This is a static path test, not proof
of WS2811 waveform timing. Restore the normal app with the command above,
without erasing NVS.

## First boot and offline operation

1. With verified hardware, upload the Bluetooth-enabled firmware once over USB.
   Normal updates preserve NVS; do not erase flash to change lighting.
2. Install the native app, tap **Scan controllers**, and select your Pixies.
   Accept the phone's Bluetooth permission/pairing prompt if shown.
3. Select a theme/effect, adjust the controls, and tap **Preview** or **Save**.
   Preview is RAM-only; Save restores your choices after restart. A clean device
   starts light-blue twinkling at 25% brightness.
4. Wi-Fi is optional. The app asks the ESP to scan 2.4 GHz networks, submits the
   chosen credentials over encrypted BLE, and reports the verified result/IP.
   Your phone stays on its normal network. Lighting keeps running without a router.
5. The app needs no administration password. If browser administration/OTA is
   wanted, optionally set a website password in the app's Device screen.

The installed app includes its JavaScript bundle; normal operation requires
neither Metro nor Internet. Local Wi-Fi setup does **not** create remote Internet
access, a cloud account, or a port-forwarding rule. That is a separate future feature.
See [BLE commands and framing](docs/BLE.md).

### Optional website/hotspot fallback

1. After confirming hardware, install by the carrier's normal USB procedure
   (`pio run -e esp32s3_n16r8 -t upload`, only with explicit operator approval).
2. Open the **local USB console**, 115200. The device prints
   `Pixies-<12-hex-id>`, its unique generated WPA key, and `http://192.168.4.1`.
   If the initial message was missed, send the line **`setup`** over USB to print
   the AP information again. Do not publish/capture that key in logs.
3. Join that protected AP. Its WPA key is random per boot, kept in RAM, never
   returned by HTTP. There is no universal setup/admin password.
4. Open `http://192.168.4.1` directly. Captive DNS helps some phones, but auto-open
   behavior is OS-dependent. Disable automatic switching to another network if
   the phone complains about no Internet.
5. Claim a 12..64-byte admin password from the protected AP. **You may stay on
   this AP and control lights without selecting a home router.**
6. Optionally enter home Wi-Fi credentials. The controller checks the candidate
   asynchronously, requiring an IP and stable association before checked NVS
   persistence replaces the previous working credentials. Poll status for the
   outcome, not just the POST's 202 response.
7. After success the AP closes. Join the home LAN and use the unique
   `http://pixies-<id>.local`, or the nonsecret IP printed locally over USB.
   mDNS, guest network isolation, and captive behavior are not universal.

Saved effects start without waiting for networking. Saved-router attempts are
bounded to 15 seconds; router loss leads to a protected fallback AP and retries
with 30-second backoff, **not** factory reset. Failed candidate connections keep
the old credentials. All web assets work without Internet access.

## Lighting, Save and power

Clean-device defaults: 200 pixels, on, brightness 25%, light blue `#ADD8E6`, twinkle;
speed/intensity/density 50%. Supported count 1..1000. Halloween and Christmas
red/white/green and Light blue are immutable. Up to ten custom named palettes, each 1..8 colors.
Themes and effects are independent. Effects: steady, twinkle, candle, breathe,
chase; see [the exact API](docs/API.md) for modulation controls.

Preview changes only RAM. **Save** persists the entire validated configuration,
including on/off, without rebooting the ESP. Themes, effects, brightness and
other lighting controls do not need a restart. The app's count slider selects
25..1000 LEDs in 25-LED increments; existing counts such as 1 or 333 stay unchanged
until you move it. The firmware and web API still support every count from 1..1000.
**Only a changed LED count needs
Save followed by a manual restart** (paired BLE or authenticated HTTP).
Status separately reports active,
requested and saved counts, plus live/saved restart requirements and revisions.
Reboot always restores saved settings; unsaved previews disappear.
Valid saved settings take precedence after firmware updates too. The new built-in
uses `builtin:light-blue`, which cannot collide with a legacy custom palette ID.

The renderer uses fixed-lifetime RGB buffers, deterministic per-pixel variation,
a wrap-safe elapsed clock and RMT channel 0. Both NeoPixelBus transport buffers
are checked for internal memory before starting RMT. The adapter checks readiness
and schedules frames at 33ms intervals; it never allocates per animation frame.
Allocation/initialization failure is visible as `led.ready:false`.

**Device settings → Power protection** stores the supply rating (default **60 W**)
and full-brightness power per LED (default **0.3 W**) on the ESP. The embedded
website exposes the same settings behind its admin login. Power Save is independent
of lighting Save and applies immediately without a restart.

Every effect uses calibrated proportional limiting: the smaller of **80% of
supply wattage** and the compiled **9 A at 5 V (45 W)** ceiling. A 20 W supply
therefore permits 16 W; the default 60 W supply remains capped at 45 W.
The model adds **1 mA standby per physical pixel** to the configured RGB power,
rounded up. Default calibration reproduces 20 mA per full-scale R/G/B channel.
Status exposes rendered-frame requested/limited mA and scaling.

Warnings use conservative full-white demand at the selected brightness, not an
animation average, and retain the active count while a smaller count awaits
restart. If standby alone exceeds the budget, RGB goes black but the physical
supply/string must change. A corrupt or unreadable existing power record disables
RGB until you verify and save a replacement; a missing record uses the default
profile without replacing saved lighting. Older firmware still supports lighting,
but the app explicitly disables unsupported power editing.

These are estimates, not measurements, fuses, or an electrical cutoff. Black
pixels still consume standby power. Verify actual ratings and use suitable wiring.
At 1000 pixels wire transmission alone takes about 30ms. Target goals are ≥30FPS
at 200 / ≥20FPS at 1000 and <250ms normal-LAN p95 acknowledgements; hardware
measurement is required before stating they are achieved.

## Admin, recovery and trust boundary

- HTTP administration protects power settings, Wi-Fi changes/scans, restart, logout, both
  resets and **every** firmware upload phase. Lighting controls are deliberately
  trusted-LAN operations, with same-origin/custom-header protection.
- BLE configuration uses bonded, encrypted no-PIN pairing instead of a web login.
  Another nearby phone can initiate pairing: this deliberately trusts the local
  radio environment and is not an ownership/account or MITM-resistant scheme.
  Wi-Fi credentials are never returned in status/configuration or stored by the app.
- Salted PBKDF2-HMAC-SHA256 verifier uses bundled mbedTLS, random RAM sessions,
  login throttling, HttpOnly/SameSite cookies and CSRF. Credentials use a
  separate NVS namespace from settings. Writes are checked and read back;
  version/length/CRC/validation failures expose a recovery reason and defaults.
- Wi-Fi reset preserves admin, lighting, and Bluetooth bonds. Factory reset
  deliberately clears all four. HTTP operations require login/CSRF; BLE uses its
  encrypted paired connection. Both require exact confirmation strings.
- Optional **active-low physical recovery switch**: after verifying its carrier
  wiring, configure `PIXIES_RECOVERY_PIN`. Input sampling begins three seconds
  after boot; hold LOW for ten continuous seconds for factory recovery.
  GPIO0/BOOT may be explicitly selected only after carrier confirmation:
  press it **after normal boot**. Holding it while resetting retains the ROM
  download-mode behavior and does not run this gesture. Default is disabled.
- With physical recovery disabled, lost admin credentials require the documented
  **USB ROM recovery/erase-and-reflash procedure** for the actual carrier.
  A full flash erase removes saved lighting, Wi-Fi/admin, and OTA state.
  Reinstall the bootloader, partition table and app through PlatformIO after
  erasing. This is intentionally destructive and must be operator-approved.

**Security limitations:** HTTP is not TLS. LAN observers/attackers can see
traffic; AP WPA does not provide end-to-end HTTPS. NVS encryption is not enabled
automatically. Authenticated OTA is not signed firmware, secure boot,
anti-rollback, or a defense against a compromised admin/LAN/physical attacker.
Do not expose this device through Internet forwarding. No credentials in
build flags, source, URLs, ordinary exports, or browser persistent storage.

## Releases and phone updates

The app's **Settings → Updates** page works without an ESP connection for Android updates.
It checks published releases automatically without blocking Lights. Tap
**Update Android app** to download a verified APK, then approve Android's
installer. Allow **Install unknown apps** for Pixies if Android requests it.
Opening that installer does not mean installation succeeded; the running app
version confirms the result. iPhone app updates require Apple distribution.

Connect to a controller to update its firmware over encrypted, bonded BLE.
The app verifies the downloaded image's length and SHA-256, streams acknowledged
chunks, and reconnects to the same controller. Success requires a new boot ID
and the exact requested version. Keep the app open, controller powered, and
phone nearby. Cancel before finalization if necessary; interrupted transfers
do not select incomplete images. Saved settings remain intact; unsaved previews
are lost when the ESP restarts.

**First upgrade:** firmware 0.2.2 and earlier need one USB or authenticated
browser upgrade to 0.3.0+ before BLE OTA works. Switching an existing
development-signed Android app to the dedicated production key needs a one-time
uninstall/reinstall. This does not intentionally erase the ESP's saved settings.

### Prepare a reviewed release

```sh
make release-patch       # x.y.z -> x.y.(z+1)
make release-minor       # x.y.z -> x.(y+1).0
make release-major       # x.y.z -> (x+1).0.0
```

These commands dispatch **Prepare release** on `main`. It requires the current
version to be published, increments the Android code, opens a release PR, and
explicitly starts both CI workflows. It never merges. Review the PR and
distribution notices before merging it. A version-changing merge starts
**Publish release**, which builds both products, uses the main-only `release`
signing environment, validates the complete artifacts, stages and verifies all
assets, then publishes them together. A failed job does not publish a partial
release. After publication, the phone can discover the new version.

**Initial release:** merging this feature's `version.json` onto `main` publishes
the version and Android code currently recorded in `version.json`. Do that
deliberately; no existing public release is needed for this first version.
The bump workflow handles subsequent versions. Retry a
failed publication through its manual workflow on the same main commit; published
versions and tags cannot be overwritten with other source.

`make dist` writes `dist/release/`: firmware, production APK, `release.json`,
`SHA256SUMS`, firmware source/relink materials, and mobile dependency notices.
It requires committed source and a configured production certificate. For
local packaging experiments only, the two Python packaging helpers accept
`--allow-dirty`; those manifests are intentionally rejected by the app and
publisher. HTTPS, hashes and GitHub trust are not signed ESP firmware, secure
boot, or automatic rollback.

### Preserve Android signing

The private production key stays outside Git at
`~/.config/esp32_pixies/signing/release.p12`; its password is in macOS login
Keychain under service `esp32-pixies-android-release`, account `pixies-release`.
**Back up both securely.** Losing either can prevent compatible future updates.
Never put them in source, logs, release assets, or phone downloads.
`android-signing.sha256` is the public certificate fingerprint, not a secret.

`make signing-setup` configures or reuses that key and the four `release`
environment secrets; it refuses accidental certificate replacement.
Linux/CI builds use `ANDROID_KEYSTORE_PATH`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, and `ANDROID_KEY_PASSWORD` in the build environment.
Release builds fail rather than silently using the public development key.

## Browser OTA and USB recovery

Use the **application-only** `.pio/build/esp32s3_n16r8/firmware.bin`.
Login, choose that file, upload. Do not upload a merged flash image, bootloader
or partition table. Firmware and UI update together. The exact raw upload
headers/format and response handling are in [docs/API.md](docs/API.md).

LEDs deliberately go black during OTA. The inactive partition is written in
bounded chunks; declared/received/parsed image lengths, target header and IDF
image integrity/finalization checks must pass before selecting the boot slot.
Failure resumes the live preview. Saved NVS is preserved. Conflicting changes
are blocked, and restart occurs only after the success response.

Interrupted or invalid transfers do not select an incomplete image. This is
**not automatic rollback after a valid image starts and boot-loops**. Rollback
has not been enabled or promised without compatible bootloader support.
USB remains the recovery path. Partition/layout changes require USB installation,
not browser OTA; retain this partition table across ordinary updates.

## Source map and acceptance still needed

- `lib/PixiesCore`: pure settings, strict JSON schema adapter, render/current
  limiting, record/image checks, throttling and connection decisions.
- `src`: checked Preferences storage, RMT output, cooperative Wi-Fi/AP/DNS,
  bounded WebServer receiver, shared admin/API and inactive-slot OTA.
- `test`: pure tests and real storage/HTTP/OTA adapters with narrow native fakes.
  These test branch decisions, not physical flash reliability or radio behavior.
- `web`: minimal integration UI and Node header/upload tests. The frontend
  specialist should replace assets while retaining this contract and adding
  full UI logic tests. `docs/config.schema.json` is the settings schema.

Physical acceptance checklist: verify carrier/pins/memory; low-brightness RGB
order test; all effects at 200 pixels and offline; measured supply current and
voltage; saved vs unsaved behavior across power loss; 1000-pixel buffering and
physical timing; async scans/candidate failures/router loss; AP-only operation;
login/session/CSRF behavior; successful/failed/unauthorized/truncated/wrong-chip
OTA, interrupt/power-loss testing and USB recovery. Do not describe simulated
maximum length as a tested 1000-pixel physical string.
