PYTHON ?= python3
PIO ?= $(HOME)/.platformio/penv/bin/platformio
ARCHITECTURES ?= arm64-v8a
REPO := vkorotchenko/esp32_pixies

.PHONY: help version-sync check test firmware diagnostic-adafruit diagnostic-adafruit-400 diagnostic-fastled diagnostic-sequential diagnostic-sequential-neopixelbus diagnostic-gpio4 android-dev android-release materials dist icons signing-setup release-major release-minor release-patch
help:
	@printf '%s\n' 'make check/test      Validate versions / run source tests' \
	  'make firmware        Build the ESP32-S3 application (never flash)' \
	  'make diagnostic-adafruit Build the standalone Adafruit LED test (never flash)' \
	  'make diagnostic-adafruit-400 Build the 400kHz WS2811 LED test (never flash)' \
	  'make diagnostic-fastled  Build the standalone FastLED test (never flash)' \
	  'make diagnostic-sequential Build the single-pixel walk (never flash)' \
	  'make diagnostic-sequential-neopixelbus Build the NeoPixelBus single-pixel walk (never flash)' \
	  'make diagnostic-gpio4    Build the GPIO4 static-voltage test (never flash)' \
	  'make android-dev     Build a development-signed standalone APK' \
	  'make android-release Build a production-signed standalone APK' \
	  'make dist            Build and verify both release artifacts' \
	  'make signing-setup   Create/configure the private release key (macOS)' \
	  'make icons           Regenerate launcher/app icons' \
	  'make release-patch   Open a patch release PR through GitHub Actions' \
	  'make release-minor   Open a minor release PR through GitHub Actions' \
	  'make release-major   Open a major release PR through GitHub Actions'
version-sync:
	$(PYTHON) scripts/release.py sync
check:
	$(PYTHON) scripts/release.py check
	$(PYTHON) scripts/check_build.py
test: check
	$(PYTHON) -m unittest discover -s scripts/tests
	$(PIO) test -e native
	npm test
	cd mobile && npm run typecheck && npm run lint && npm test -- --runInBand
firmware: check
	$(PIO) run -e esp32s3_n16r8
diagnostic-adafruit: check
	$(PIO) run -e led_diag_adafruit
diagnostic-adafruit-400: check
	$(PIO) run -e led_diag_adafruit_400
diagnostic-fastled: check
	$(PIO) run -e led_diag_fastled
diagnostic-sequential: check
	$(PIO) run -e led_diag_sequential
diagnostic-sequential-neopixelbus: check
	$(PIO) run -e led_diag_sequential_neopixelbus
diagnostic-gpio4: check
	$(PIO) run -e gpio4_diag_static
android-dev: check
	cd mobile && npm run apk -- -PpixiesDevelopmentSigning=true -PreactNativeArchitectures=$(ARCHITECTURES)
android-release: check
	$(PYTHON) scripts/signing.py build --architectures $(ARCHITECTURES)
materials:
	$(PYTHON) scripts/release_materials.py firmware --pio $(PIO)
	$(PYTHON) scripts/release_materials.py mobile
dist: firmware android-release
	$(MAKE) materials
	$(PYTHON) scripts/release.py package
icons:
	node scripts/generate-icons.mjs
signing-setup:
	$(PYTHON) scripts/signing.py setup
release-major release-minor release-patch:
	gh workflow run prepare-release.yml --repo $(REPO) --ref main -f bump=$(patsubst release-%,%,$@)
