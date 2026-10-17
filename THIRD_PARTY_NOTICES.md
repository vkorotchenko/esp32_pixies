# Third-party software

Pixies application code is independently written under the existing Apache-2.0
project license (`LICENSE`). No MoonBoard GPL application source/parser, BLE
protocol, or pin configuration was copied.

| Component | Version used | License / source |
|---|---|---|
| NeoPixelBus | 2.8.4 | LGPL-3.0; [source and COPYING](https://github.com/Makuna/NeoPixelBus/tree/2.8.4) |
| ArduinoJson | 6.21.5 | MIT; [source and license](https://github.com/bblanchon/ArduinoJson/tree/v6.21.5) |
| NimBLE-Arduino | 2.5.1 | Apache-2.0; [source and license](https://github.com/h2zero/NimBLE-Arduino/tree/2.5.1) |
| React / React Native | 19.2.3 / 0.84.1 | MIT; [React](https://github.com/facebook/react) and [React Native](https://github.com/facebook/react-native) |
| react-native-ble-plx | 3.5.1 | Apache-2.0; [source and license](https://github.com/dotintent/react-native-ble-plx/tree/3.5.1) |
| react-native-file-access | 4.0.4 | MIT; [source and license](https://github.com/alpha0010/react-native-file-access/tree/v4.0.4) |
| buffer / react-native-safe-area-context / community slider | Locked in `mobile/package-lock.json` | MIT; retain the installed packages' notices. |
| Arduino-ESP32 | 2.0.17 family, platform-resolved patch package | LGPL-2.1 portions, Espressif/ESP-IDF Apache-2.0 and bundled component licenses; [source](https://github.com/espressif/arduino-esp32/tree/2.0.17) |
| ESP-IDF / mbedTLS | Bundled by the pinned Arduino platform | Apache-2.0 and individual bundled notices; retain the exact installed SDK licenses. |
| PlatformIO Espressif32 | 7.1.3 | Apache-2.0; [platform source](https://github.com/platformio/platform-espressif32/tree/v7.1.3) |
| Unity (host tests only) | PlatformIO-resolved 2.6.1 | MIT; [source](https://github.com/ThrowTheSwitch/Unity/tree/v2.6.1) |
| @resvg/resvg-js / pngjs (icon generation only) | 2.6.2 / 7.0.0 | MPL-2.0 / MIT; exact development inputs in `package-lock.json`. These tools are not bundled in the app. |

Dependency source and license texts are restored under `.pio/libdeps` and the
PlatformIO framework packages; they are not vendored or relicensed as Apache-2.0.
ArduinoJson Copyright © 2014-2023, Benoit BLANCHON. NeoPixelBus's source files
retain their individual author/copyright notices; see its upstream `COPYING`
and source headers.

## Before distributing binaries

The release pipeline attaches `pixies-firmware-materials.zip`: Pixies source,
unchanged installed library source and licenses, the complete resolved Arduino
framework/SDK, firmware objects/archives/ELF/map, and resolved PlatformIO package
versions. Its instructions explain rebuilding with replacement libraries and
installing the resulting application through browser OTA or USB, without a
firmware signing key. `pixies-mobile-materials.zip` retains installed npm
dependency license and notice files; the source archive includes both npm locks.
Packaging checks the firmware source/version/commit/hash association and refuses
missing materials. Neither archive includes the private Android signing key.

Review these materials and applicable SDK/toolchain terms before the first
public binary release. Archive generation preserves build inputs and notices;
it is not a legal-compliance determination.

Do not treat this notice table alone as satisfying LGPL distribution terms.
Retain the exact dependency versions/sources, copyright and license texts, all
modifications (none made here), and applicable notices with the distribution.
For LGPL components, provide corresponding library source and the materials
needed to relink/replace them (for example, application object files and
reproducible toolchain/build/link inputs), or another license-compliant delivery
method. Evaluate any applicable installation-information obligations.

Record the resolved framework/tool package versions alongside a release, since
the platform declares compatible package ranges. Review bundled SDK/component
notices and distribution requirements before publishing a binary. This project
does not waive those licenses or claim that a combined proprietary binary is
covered by the application license alone.
