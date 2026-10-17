#pragma once
#ifndef PIXIES_LED_PIN
#define PIXIES_LED_PIN 4
#endif
#ifndef PIXIES_COLOR_GRB
#define PIXIES_COLOR_GRB 1
#endif
#ifndef PIXIES_CURRENT_MA
#define PIXIES_CURRENT_MA 9000
#endif
#ifndef PIXIES_RECOVERY_PIN
#define PIXIES_RECOVERY_PIN -1
#endif
#define PIXIES_VERSION "0.1.0"
#define PIXIES_TARGET "esp32s3_n16r8"
// Carrier unconfirmed: a deliberately opted-in, active-low recovery input.
// Never assign PSRAM/USB/strapping pins without verifying the actual carrier.
static_assert(PIXIES_LED_PIN >= 0 && PIXIES_LED_PIN <= 48, "Invalid LED pin");
static_assert(PIXIES_LED_PIN != 35 && PIXIES_LED_PIN != 36 && PIXIES_LED_PIN != 37,
              "N16R8 Octal PSRAM reserves GPIO35/36/37");
static_assert(PIXIES_LED_PIN != 19 && PIXIES_LED_PIN != 20, "Native USB pins");
static_assert(PIXIES_LED_PIN != 0 && PIXIES_LED_PIN != 3 &&
              PIXIES_LED_PIN != 45 && PIXIES_LED_PIN != 46, "Strapping pins");
static_assert(PIXIES_CURRENT_MA >= 1000 && PIXIES_CURRENT_MA <= 9000,
              "Current budget must be 1000..9000 mA");
static_assert(PIXIES_RECOVERY_PIN != PIXIES_LED_PIN, "Recovery conflicts with LEDs");
static_assert(PIXIES_RECOVERY_PIN >= -1 && PIXIES_RECOVERY_PIN <= 48, "Invalid recovery pin");
static_assert(PIXIES_RECOVERY_PIN != 35 && PIXIES_RECOVERY_PIN != 36 && PIXIES_RECOVERY_PIN != 37 &&
              PIXIES_RECOVERY_PIN != 19 && PIXIES_RECOVERY_PIN != 20 &&
              PIXIES_RECOVERY_PIN != 3 && PIXIES_RECOVERY_PIN != 45 && PIXIES_RECOVERY_PIN != 46,
              "Recovery pin conflicts with PSRAM/USB/strapping");
