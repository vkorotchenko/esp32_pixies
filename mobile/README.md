# Pixies companion

React Native Android/iPhone app using `react-native-ble-plx`, following the
PAO Console connection approach with a smaller, independent lighting interface.
It talks directly to ESP32-S3 over BLE; no hotspot connection, app account,
cloud service, or mandatory website password.

## Use

1. Install the Bluetooth-enabled Pixies firmware on the ESP once over USB.
2. Install this app, enable Bluetooth, tap **Scan controllers**, and select Pixies.
   Allow Bluetooth access and accept normal OS pairing if prompted.
3. Choose a theme/effect, adjust sliders/count/palettes, then **Preview** or
   **Save**. Only Save persists through restart. Count changes also need Restart.
4. Optionally open **Wi-Fi**, scan/select a 2.4 GHz router (or enter a hidden
   SSID), and connect. Credentials are tested and stored by the ESP, not the app.
   The app reports the outcome/address while your phone stays on its normal network.
5. **Device** shows real LED readiness/frame/current diagnostics and Restart.
   The optional website password is needed only for existing web administration/OTA.

The first clean device uses light-blue twinkling. Existing saved settings always
win after reboot or firmware update. Wi-Fi setup/loss never resets your lights.
Remote Internet light control is not implemented. Release downloads use your
phone's Internet connection; firmware transfer and normal controls use BLE.

## Phone-managed updates

The **Updates** card shows the installed app and connected firmware versions.
Check for a stable GitHub release. Android can download its signed APK even
without a controller connection; allow **Install unknown apps** for Pixies and
approve the Android installer. The app verifies size/hash, and Android preflight
checks package, higher version code and the installed certificate. The installer
opening is not confirmation that installation succeeded.

Firmware updates require a connected controller with BLE OTA capability.
The app verifies the image, sends ordered acknowledged chunks, and checks a new
boot ID plus the exact release version after reconnecting. Do not switch away,
remove power or move out of range. Cancellation/backgrounding aborts incomplete
work; after finalization, reconnect to establish what actually booted.

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
