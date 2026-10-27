# Pixies companion

React Native Android/iPhone app using `react-native-ble-plx`, following the
PAO Console connection approach with a smaller, independent lighting interface.
It talks directly to ESP32-S3 over BLE; no hotspot connection, app account,
cloud service, or mandatory website password.

## Use

1. Install the Bluetooth-enabled Pixies firmware on the ESP once over USB.
2. Open the app on **Lights** and enable Bluetooth. It reconnects your last
   controller automatically. On first use, it scans for ten seconds and connects
   only if exactly one controller appears. Allow Bluetooth access and accept
   normal OS pairing if prompted. If several appear, use the top-right settings
   icon and choose **Connection**.
3. Choose a theme/effect, adjust sliders/count/palettes, then **Preview** or
   **Save**. Save remembers your settings without restarting the ESP.
   Only a changed LED count needs Save followed by a manual Restart; themes,
   effects, brightness and the other lighting controls do not.
   The LED-count slider uses 25-LED increments from 25 to 1000. An existing count
   outside those increments stays unchanged until you move the slider.
4. Optionally open **Settings → Wi-Fi**, scan/select a 2.4 GHz router (or enter a hidden
   SSID), and connect. Credentials are tested and stored by the ESP, not the app.
   The app reports the outcome/address while your phone stays on its normal network.
5. **Settings → Device settings** shows LED readiness/frame/current estimates,
   power settings and Restart.
   The optional website password is needed only for existing web administration/OTA.

The first clean device uses light-blue twinkling. Existing saved settings always
win after reboot or firmware update. Wi-Fi setup/loss never resets your lights.
Remote Internet light control is not implemented. Release downloads use your
phone's Internet connection; firmware transfer and normal controls use BLE.

Controllers appear as **pixies**. The app still selects and reconnects using the
underlying device ID, not the shared friendly name. The ESP's Wi-Fi hotspot and
local hostname retain their unique suffixes.

Save feedback stays in the existing status area instead of inserting a loading
row above the controls. A count-specific restart message appears only when the
saved LED count actually differs from the active count.

### Lights home and settings menu

**Lights** always opens first, even without Bluetooth, Internet, or a controller.
Its full form stays present, greyed out and disabled while disconnected.
Before the first read, values are clearly labeled defaults; afterward the app
retains the last authoritative values in memory, not unsent drafts.
Reconnecting reads the ESP again and never replays cached/default lighting.
Connection attempts and release checks run independently without navigating away.

The settings icon opens a dropdown for **Connection**, **Updates**, **Wi-Fi**,
and **Device settings**. Close any page with **Back to lights** or Android Back.
Update progress and verified APK state survive closing/switching settings.
The icon has an orange **!** whenever a connection or update needs attention.

The **Connection** menu item shows an orange **!** while disconnected or if remembering
the controller fails. The app stores only the last successful native device ID
in its private documents directory. It never substitutes another nearby device
when that remembered controller is unavailable. You can scan and choose another
controller, retry, cancel an attempt, or disconnect on this page.

Returning to the app or turning Bluetooth on retries a missing connection.
An unexpected disconnect also triggers a reconnection attempt; failed attempts
remain in **Connection** rather than repeatedly prompting for pairing.
Manual Disconnect pauses automatic connection until you reopen/foreground the
app or explicitly retry. Backgrounding cancels pending connection work.

The **Updates** menu item shows an orange **!** for a newer compatible app or controller
release, a pending APK installation, or a failed check/update. No published
release is an informational state, not an update alert. Checks never lock the
lighting controls. Both warning badges have accessible attention labels.

### Custom palettes

Each mobile palette has **1–5 colors**, with up to 10 custom palettes.
Tap a color swatch or **Add color** to choose any RGB color with the Red, Green,
and Blue sliders and live preview. **Done** applies it only to the palette editor;
**Cancel** (or Android Back) discards that picker change, including a new color.
Use **Add palette draft** or **Update palette draft**, then explicitly **Preview**
(RAM only) or **Save** (persistent) to send changes to the controller. Moving
the picker sliders never sends lighting commands.

Existing controller palettes with 6–8 colors load without losing any colors.
The app warns and blocks Preview/Save until you explicitly remove colors to
five or fewer in each oversized palette and update its draft (or delete that
palette). Nothing on the controller changes until Preview/Save.

### Power settings and warnings

In **Settings → Device settings**, enter the actual 5 V supply rating and watts
per LED at full brightness. Defaults are **60 W** and **0.3 W/LED**. Supply rating
accepts whole watts from 1 to 2000; LED power accepts 0.01..10 W in 0.001 W steps.
Both a decimal point and decimal comma work. **Save power settings** verifies
independent controller persistence and applies the limit without restarting or
changing saved lighting. It needs firmware with power-profile support.

Firmware limits estimated output to **80% of the supply rating**, with the existing
**9 A at 5 V** ceiling as an additional cap. At 60 W the effective ceiling is 45 W;
at 20 W it is 16 W. Lights warns about conservative full-white demand at your
selected brightness, including 1 mA standby per physical LED and the larger
active/draft count until restart. Effects can use less than this estimate.

Invalid stored power settings disable RGB until repaired. If standby alone
exceeds the budget, software dimming cannot make the supply sufficient. These
are modeled estimates, not current measurements or a substitute for fuses, wiring
ratings, correct voltage and power injection. Check the actual hardware ratings.

## Phone-managed updates

**Settings → Updates** shows the installed app and connected firmware versions.
The app checks for a stable GitHub release on opening and foregrounding; you can
also tap **Check for updates**. Downloads and installation always require your
approval: startup never flashes the ESP or opens Android's installer.
Android can download its signed APK even
without a controller connection; allow **Install unknown apps** for Pixies and
approve the Android installer. The app verifies size/hash, and Android preflight
checks package, higher version code and the installed certificate. The installer
opening is not confirmation that installation succeeded.

Firmware updates require a connected controller with BLE OTA capability.
The app verifies the image, sends ordered acknowledged chunks, and checks a new
boot ID plus the exact release version after reconnecting. Do not switch away,
remove power or move out of range. Cancellation/backgrounding aborts incomplete
work; after finalization, reconnect to establish what actually booted. Changing
settings pages inside Pixies does not discard an update or a verified pending APK.

Firmware 0.2.2 and earlier needs one USB/browser upgrade to 0.3.0+ first.
The old development-signed APK also needs a one-time uninstall/reinstall to
switch to the dedicated production certificate. Future production APKs update
in place with that same key. iPhone app distribution remains an Apple signing/
distribution task; BLE firmware updating is shared by Android and iPhone.

## Development

Requires Node 24 and npm. Android requires JDK 17, Android SDK 36/build tools
36.0.0 and NDK 27.1.12297006; iOS requires full Xcode, CocoaPods, and iOS 15.1+.
Android minimum is API 24. BLE needs real phones for acceptance; a simulator build
is only compilation evidence.

```sh
cd mobile
npm ci
npm run typecheck
npm run lint
npm test -- --runInBand
```

Debug development with Metro:

```sh
npm start
# Another terminal:
npm run android
# Or, after installing iOS pods:
npm run ios
```

For iOS dependencies: `cd ios && pod install && cd ..`. Open
`ios/Pixies.xcworkspace`, choose your development signing team and physical iPhone.
Use a Release build for a bundled, Metro-independent install. No Apple signing
credentials or production Android keystore belong in this repository.

## Standalone Android install

```sh
# Optional: point JAVA_HOME / ANDROID_HOME at your existing local toolchains.
npm run apk -- -PpixiesDevelopmentSigning=true -PreactNativeArchitectures=arm64-v8a
```

Output: `android/app/build/outputs/apk/release/app-release.apk`. This arm64
development APK embeds its JS and does not need Metro or Internet. It uses the
standard public React Native **development** signing key, not a production/store
key. Install only builds you trust and permit installation from the chosen source
on your phone. For a genuinely production-signed build, run
`make android-release` from the repository root. There is no automatic
development-key fallback. See [release and key backup instructions](../README.md#releases-and-phone-updates).

The original icon source is `assets/pixies-icon.svg`. Run root `npm ci` and
`make icons` to regenerate Android legacy/round/adaptive/monochrome and iOS
opaque app icons.

The **Bluetooth mobile app** GitHub Actions workflow runs app checks and packages
the arm64 APK as `pixies-android-arm64`. It also compiles an unsigned bundled iOS
Simulator app on macOS; that is **not** an IPA installable on an iPhone. Actual
iPhone deployment requires your Xcode/signing setup.

## Permissions and failures

Android 12+ requests Bluetooth scan/connect only; older Android also requires
location for BLE scanning. iOS requests Bluetooth access. There is no need for
phone Wi-Fi/location permission to scan routers: the ESP performs the Wi-Fi scan.

No-PIN OS pairing encrypts the link but does not establish device ownership or
protect pairing from an active MITM. Nearby phones can attempt pairing. The app
never saves passwords or lighting settings to phone storage, and never logs
credential-bearing command bodies.

After a disconnect, reconnect and load the ESP's actual state; commands are not
automatically replayed. Save failure remains unsaved. After an ESP factory reset,
forget its old phone Bluetooth bond if needed, then pair again. If no device is
found, verify the new firmware is installed; the older web-only image does not
advertise this service.

Protocol and exact commands: [BLE v1](../docs/BLE.md).
