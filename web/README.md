# Embedded Pixies frontend

Plain JavaScript, CSS and HTML, with no runtime framework, remote font, CDN,
service worker, or Node server on the device. PlatformIO embeds only
`index.html`, `app.js` and `styles.css` into the application. Tests and this
document are not embedded. Firmware and UI therefore ship in one app-only
`firmware.bin`.

The implementation consumes [`../docs/API.md`](../docs/API.md) and
[`../docs/config.schema.json`](../docs/config.schema.json) as written. It adds
no routes. Use the firmware's accepted IP or `pixies-<id>.local` hostname over
HTTP, same origin. Do not proxy it onto an untrusted network.

## Controls and persistence

- Seasonal themes and all five effects are independent. Movement controls
  are disabled when the effect does not use them. Power, all four percentages,
  and custom palettes are included in every complete preview.
- Slider input coalesces for 220 ms, with at least 350 ms between preview
  requests and at most one preview in flight. No preview writes storage.
  Preview acknowledgements do not discard slider changes made in flight.
- Save drains the latest preview, then posts its real base revision. Only a
  valid checked Save response or authoritative readback can establish saved
  content. Storage failures are never automatically retried.
- Boot recovery is displayed separately from `dirty`: identical live/default
  content is not proof a missing/corrupt NVS record was written. Save remains
  available during recovery. A confirmed Save in this page checks persistence;
  the boot recovery diagnostic may remain visible until restart.
- Pixel count has an explicit **Set preview count** action so typing `250`
  does not send `2`, `25`, then `250`. An unsubmitted/invalid count remains
  visible and blocks Save rather than saving a different value. Active,
  requested and saved counts are always distinct. Save does not restart.
- Custom palette IDs are stable generated IDs; names can be edited without
  breaking selection. The editor supports 1–8 RGB colors, up to 10 palettes.
  Deleting a selected palette chooses Halloween in the same atomic PUT.
  Names, filenames and SSIDs are inserted as text, not HTML.

## Reconciliation and administration

The page retains its full draft on a revision conflict, uncertain mutation,
dropout, unexpected boot, or remote replacement of this page's unsaved preview.
No old mutation is replayed on reconnect. The device's current snapshot is
loaded, then the user chooses **Apply my draft** or **Use device settings**.
Applying a retained draft is an explicitly confirmed complete replacement
using the latest base revision. A second concurrent edit can still reject it.
There is no API for retrieving an arbitrary old saved configuration; discarding
a *local* draft is not advertised as reverting an acknowledged live preview.

Save response loss is reconciled by readback, with language distinguishing
currently saved content from the original lost response. If the content already
matched the saved state and the saved revision did not move, the UI explicitly
says the extra write cannot be proven from this API.

First claim is offered only when `/api/auth/session` permits it on the protected
hotspot. Admin creation precedes network setup. Staying AP-only requires no
network mutation. Home-network test acceptance is not called saved until status
reports a succeeded, connected, saved candidate. Admin expiry/401 clears the RAM
CSRF token and locks privileged controls, not ordinary lighting. Password
controls are cleared after valid submission. No secret is stored in browser
storage, a URL or a console log.

Restarts and updates ask whether to Save unsaved lighting first, explicitly
discard it for the next boot, or cancel. Wi-Fi reset and factory reset have
separate confirmations explaining what is preserved/erased. HTTP is not TLS;
the device and its networks must be trusted. The unique initial hotspot key is
obtained over USB serial, never from an API.

## OTA lifecycle

An `XMLHttpRequest` sends the actual File, not multipart/base64:
`application/octet-stream`, `X-Pixies-Request: 1`, `X-CSRF-Token`, and
`X-Firmware-Size`. The browser supplies Cookie, Origin and Content-Length.
The selected `.bin` must fit the slot size actually reported by the device;
the firmware performs the image/target/integrity checks.

Every poll and lighting/admin mutation pauses during the XHR because the
firmware's HTTP receiver handles one connection. Progress measures browser
bytes sent; 100% is followed by a validation wait. HTTP 202 means finalized,
selected and restart scheduled, **not boot success**. The page then reconnects
and requires a different boot ID plus the reported target/version. If the
version is unchanged, it says so; the API has no image hash or expected-version
metadata to prove the identity of a same-version image. A reload button loads
the matching new embedded website.

Rejected uploads restore controls after readback. Ambiguous disconnects wait
for device state/new boot without retrying. Restart verification times out at
75 seconds (120 seconds for updates) with an explicit unverified error;
read-only polling continues. A failed/no-longer-active uncertain operation can
be reconciled without pretending it booted. An expired verification wait can
be explicitly dismissed only after re-reading a non-busy, non-restarting device.
USB recovery remains necessary; there is no signed-image, TLS or automatic
boot-loop rollback claim.

## Repeatable tests

Node 24, no package installation or production server required:

```sh
npm test
npm run test:browser
```

`npm test` runs Node's built-in test runner over production helper functions:
strict complete-object bounds, palette IDs/names/colors/limits, effect usage,
credential byte limits, request headers/size/errors/timeouts/session expiry,
draft/revision/boot reconciliation, live/saved/count presentation, ambiguous
Save, raw-file XHR progress and failures. The original three contract tests
remain.

The optional browser command uses the **already installed** Chrome and Node's
built-in WebSocket to drive DevTools. On macOS it finds Google Chrome in
`/Applications`; elsewhere set `PIXIES_CHROME_PATH` if `google-chrome` is not
on PATH. It does not install Playwright or reuse your browser profile.
It creates a temporary isolated profile in `web/test/`, serves a synthetic
loopback-only device on an ephemeral port, and cleans up on completion.
The fake image is not real firmware and is never sent to hardware.
Fixture-only `/__test/*` routes do not exist in production.

Browser exercises include first claim, all primary lighting/palette flows,
safe text insertion, scan/connect, requested versus active/saved count,
Save and restart confirmations, revision conflict with no retry, storage failure,
Save response loss, network dropout, unexpected boot, session expiry,
current limiting, reset cancellation, rejected and accepted OTA, suspended
polling during XHR, new boot/version verification, keyboard range input, and
320/375/768/1280-pixel overflow checks. No uncaught browser exceptions are allowed.
For manual fixture exploration, run `node web/test/fixture-server.js` and open
`http://127.0.0.1:4173`; this is not a substitute for the actual firmware.

Embedded build checks:

```sh
~/.platformio/penv/bin/platformio run -e esp32s3_n16r8
python3 scripts/check_build.py .pio/build/esp32s3_n16r8/firmware.bin
git diff --check
```

These tests establish software/build behavior against synthetic HTTP fixtures.
They do **not** verify a physical light string, electrical safety, radio/captive
portal behavior, target-browser LAN timing, real flash writes, power-loss OTA,
or recovery on a carrier board. Exercise those on the actual device using the
project's hardware acceptance procedure before deployment.
