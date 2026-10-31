# Local API v1 — frontend integration contract

This describes the implemented firmware, not a proposed future API. The website
is served by the device at `/`, `/app.js`, `/styles.css`; all three assets are
inside the application image. Use relative URLs, same-origin HTTP, and no CDN.
`config.schema.json` describes the complete lighting object.

## Weekly scheduling

This optional feature advertises `status.capabilities.weeklySchedule: 1`.
It does not add fields to the strict lighting configuration. The website has
no schedule editor; the mobile **Lights | Schedule** tabs provide the editor.

| Route | Exact JSON body | Authorization |
|---|---|---|
| `GET /api/schedule` | none | Existing trusted local-network read gate |
| `PUT /api/schedule` | `{bootId,baseRevision,schedule}` | Admin session, CSRF, same-origin request gate |
| `POST /api/time/sync` | `{bootId,utcSeconds}` | Admin session, CSRF, same-origin request gate |
| `PUT /api/lights` | `{bootId,baseRevision,on}` | Existing lighting trusted-LAN mutation gate |
| `POST /api/schedule/resume` | `{bootId}` | Admin session, CSRF, same-origin request gate |

All mutations reject OTA/restart busy state. A wrong boot ID returns
`409 boot_conflict`; stale revisions return `409 revision_conflict`.
Schedule Save uses its own revision; lights.set uses the lighting revision.
Unknown fields, incomplete objects, coercions, embedded NULs and invalid
timezone/minute bounds are rejected. Schedule commands/results have a 4096-byte
bound; the transport still allows 8192 bytes for other operations.

Schedule GET, Save, sync and resume return
`{bootId,revision,schedule,runtime}`. The complete saved object follows
[schedule.schema.json](schedule.schema.json): version 1, global enable, a nullable
timezone, and exactly seven Monday–Sunday rows, each with `enabled`,
`onMinute` and `offMinute` (0–1439). Enabled schedules require timezone rules.
Each enabled row must have different ON/OFF minutes.

The timezone contains a named ASCII ID (1–64 bytes), UTC coverage
`[fromUtc,untilUtc)`, initial signed seconds **east of UTC**, and at most
16 strictly ordered transitions strictly inside coverage. UTC values stay
within 2020–2037. The phone exports two calendar years of its actual named-zone
rules plus three days of lookback using Temporal and host Intl data.
It never invents fixed-offset DST rules. Traveling does not replace the saved
controller zone: **Use phone timezone**, then **Save schedule**, explicitly
changes or refreshes it. Coverage is not a promise against future timezone-law
changes; refresh after a law change and before expiry.

ON is inclusive; OFF is exclusive. OFF before ON ends the following calendar
day, including Sunday into Monday. A disabled day starts no interval but does
not cut off a previous overnight interval. Intervals form a union: overlapping
internal endpoints do not toggle output or expire manual overrides. Equal
enabled endpoints are invalid, not 24-hour operation. An enabled schedule with
all days disabled is OFF. DST gaps clamp missing endpoints to the first valid
instant and discard resulting zero-length intervals; folds use earliest ON
and latest OFF, continuously through the repeated period.

`runtime` (also compact `status.scheduling`, without the saved table) contains:

- `enabled`, `healthy`, `recovery`, `automaticOn`, `effectiveOn`, `pauseReason`;
- `overrideActive`, `overrideOn`, nullable `overrideUntilUtc`;
- nullable `nextBoundaryUtc`, `timezoneId`, `ruleExpiryUtc`;
- `clock: {synced,utcSeconds,source,syncAgeSeconds}`. Unsynced UTC/age are null.

Every boot starts UNSYNCED. Fresh phone UTC or asynchronous Wi-Fi SNTP establishes
time; elapsed animation/timeouts remain monotonic. Clock state is not persisted.
A powered controller retains time across loss of phone/Wi-Fi. Offline cold boot
needs a phone connection or configured Wi-Fi/NTP; there is no battery-backed RTC.
Enabled automation is OFF while unsynced or outside timezone coverage, with a
visible pause reason. Corrupt/unavailable schedule storage pauses automation
visibly but leaves manual controls available.

Explicit `lights.set` arms a RAM override even when the requested ON value
equals the stored manual intent but differs from effective scheduled output.
It changes the normal lighting revision without saving lighting or schedule.
The override ends at the next **effective** state boundary. Forward clock jumps
expire crossed boundaries; backward corrections recompute the future boundary.
Manual actions made before sync survive initial sync until that boundary.
Without a future boundary the override remains until Resume, schedule Save,
or reboot. Disabling/saving the schedule clears override and disabling returns
to ordinary manual intent. Legacy `config.set` arms override only when ON changes;
palette-only edits and `config.save` do not.

Schedule Save checks the separate CRC/versioned `px-settings/schedule` record
and readback before activation. A failed Save leaves the prior live schedule.
Lighting saves do not migrate or replace scheduling. Missing schedule storage
means disabled legacy behavior; factory reset clears and verifies this key.
Ticks, automatic boundaries and clock synchronization never write NVS or change
lighting settings, dirty flags or revisions. Rendering uses effective ON while
retaining power limiting and OTA blanking. Reboot, missed ticks and clock
corrections evaluate current state without replaying historical events.

## Transport and security headers

Every **POST or PUT**, including login, claim and ordinary lighting controls:

```http
Origin: http://<current-device-authority>
X-Pixies-Request: 1
Content-Type: application/json
```

Browsers set `Origin` themselves. The only alternate content type is the raw OTA
upload described below. Exactly `application/json` is accepted for JSON (do not
append a charset). No `OPTIONS`/CORS support. Do not set `Origin` in frontend JS.

Accepted Host values are the IP of the interface receiving the request,
`pixies-<12-hex-device-id>` and its `.local` name, optionally `:80`. The Origin
must be exactly `http://` plus that authority normalized to lowercase without
`:80`. Use normal canonical browser URLs; trailing-dot hosts are not supported.
Host validation also applies to GET API requests (DNS-rebinding protection).

Authenticated mutations **also require** `X-CSRF-Token: <RAM session token>`.
Use `credentials: "same-origin"`; do not handle the session cookie in JS.
One admin session exists device-wide. A new login invalidates the previous one.

- Cookie: `pixies_session=<64 hex characters>; Path=/; HttpOnly;
  SameSite=Strict; Max-Age=1800`. It is deliberately **not Secure**, since this
  device serves HTTP, not HTTPS. Absolute session lifetime 30 minutes, no renewal
  on polling. Sessions and CSRF tokens are random and RAM-only.
- Login/claim response contains the CSRF token. On page reload obtain it from
  `GET /api/auth/session`. Keep it **only in JS memory**; no local/session storage,
  URLs, logs, or exported state. Clear it on 401/logout.
- Lighting preview and Save deliberately need no admin login on the trusted LAN,
  but retain the origin/custom-header guard. Power settings, Wi-Fi, scan, restart, both resets,
  logout, and every upload phase require admin authentication.
- No endpoint exports home passwords, AP WPA keys, admin passwords, or verifiers.

HTTP requests are connection-close, Content-Length delimited, not chunked.
JSON body limit **8192 bytes**, header block **2048 bytes**, 24 header lines,
512 bytes per line, 256-byte request line. Unsupported transfer encoding,
duplicate collected security headers/length/Host, queries, escaped paths,
fragments, and request bodies on GET are rejected. No multipart upload.
JSON must be an object with exactly the documented fields; unknown/missing
fields and invalid collections reject the entire update.
No pipelining. Idle receive timeout 5 seconds; total JSON/header time 15 seconds;
OTA total transfer time 180 seconds.

## Errors

All API/parser errors use:

```json
{"error":{"code":"validation","message":"Invalid configuration; nothing applied","field":"ledCount"}}
```

`field` is optional. Never treat a failed response as a successful Save or reset.
Client code should handle any non-2xx, not just the examples here:

| HTTP | Representative codes | Frontend behavior |
|---|---|---|
| 400 | `invalid_json`, `bad_request`, `bad_headers`, `bad_path`, `bad_length`, `length_mismatch`, `unsupported_transfer` | Correct the payload/transport. |
| 401 | `authentication`, `update_failed` if session is lost | Clear CSRF; log in again. |
| 403 | `origin`, `csrf`, `bad_host`, `claim_forbidden` | Do not auto-retry a destructive action. |
| 404 | `not_found` | Unknown API route or route/method combination. |
| 405 | `method_not_allowed` | Only GET/POST/PUT are parsed. |
| 408 | `request_timeout` | Slow/truncated receive aborted; reconnect. |
| 409 | `busy`, `revision_conflict` | Wait, or reload authoritative config. |
| 411 | `length_required` | Content-Length required on mutations. |
| 413 | `body_too_large`, `headers_too_large`, `image_size` | Bound the upload/body. |
| 415 | `content_type` | Use exact documented content type. |
| 422 | `validation`, `confirmation`, `update_rejected`, `update_failed` | Show rejection; previous live config retained. |
| 429 | `rate_limited` | Honor `Retry-After` seconds. |
| 500 | `storage_failed`, `update_failed` | Save/reset/update not confirmed. |
| 503 | `out_of_memory` | Device cannot allocate the bounded request/response. |

Disconnects may have no response; reload status/config instead of claiming success.

## Lighting state

`GET /api/config` → 200 (also the exact response to a successful PUT or Save):

```json
{
  "schemaVersion": 1,
  "bootId": "0123456789abcdef",
  "revision": 1,
  "savedRevision": 1,
  "dirty": false,
  "activeLedCount": 200,
  "requestedLedCount": 200,
  "savedLedCount": 200,
  "restartRequired": false,
  "savedRestartRequired": false,
  "config": {
    "ledCount": 200,
    "on": true,
    "brightness": 25,
    "speed": 50,
    "intensity": 50,
    "density": 50,
    "effect": "twinkle",
    "paletteId": "builtin:light-blue",
    "customPalettes": []
  }
}
```

These are also the defaults. `bootId` changes each boot; revisions are per-boot
uint32 values, initially 1. Each successful preview increments `revision`.
Save sets `savedRevision = revision`. `dirty` compares actual live/saved content,
not just revisions. Reload after reconnect/boot or a 409; never blindly replay
an old preview. Concurrent edits use optimistic base revision, not partial merge.

`PUT /api/config` previews **the complete configuration** in RAM:

```json
{
  "baseRevision": 1,
  "config": {
    "ledCount": 250, "on": true, "brightness": 25,
    "speed": 50, "intensity": 50, "density": 50,
    "effect": "twinkle", "paletteId": "porch",
    "customPalettes": [
      {"id":"porch","name":"Porch","colors":["#FF8000","#00AA00"]}
    ]
  }
}
```

Range/shape rules:

- `ledCount`: integer 1..1000; default 200. Only applied to the driver at boot.
- `on`: JSON boolean, saved exactly on explicit Save.
- `brightness`, `speed`, `intensity`, `density`: integer percentages 0..100.
- `effect`: exactly `steady`, `twinkle`, `candle`, `breathe`, or `chase`.
- `paletteId`: built-in ID or an ID in `customPalettes`. Theme/effect independent.
- At most 10 custom palettes. Each ID unique, 1..24 lowercase ASCII letters,
  digits, `_` or `-`; built-in IDs reserved. Names 1..32 printable ASCII bytes.
  Each palette has 1..8 `#RRGGBB` strings, case-insensitive input, uppercase output.
- No `builtin` field in a configuration's custom palettes. Removing a selected
  palette requires choosing a valid replacement in the **same** PUT.
- Integers must not be strings, floats, nulls, or booleans. Unknown fields reject.
- Steady ignores speed/intensity/density; breathe uses speed; twinkle/candle/chase
  use all three. Higher speed is faster. Intensity is modulation depth; density
  is percentage of active/modulated positions. Candle noise is interpolated.
- Non-Steady effects light at most `floor(activeLedCount / 2)` LEDs per frame.
  Every-other-LED groups alternate each speed-controlled cycle; odd counts
  rotate the extra unlit position so no LED is permanently excluded.
  Steady can light the full active string. Brightness and power limits remain
  unchanged for every effect.

`POST /api/save` body `{"baseRevision":2}` persists the complete current preview.
No implicit Save during sliders, network changes, OTA or restart. After a
successful count Save, use authenticated `/api/restart` explicitly. Restart
restores the **saved**, not unsaved requested, count and all saved controls.
`restartRequired` compares live count with active; `savedRestartRequired`
compares saved count with active. All three counts remain visible.

`GET /api/palettes` → 200:

```json
{"palettes":[
  {"id":"halloween","name":"Halloween","builtin":true,"colors":["#00FF00","#FFA500"]},
  {"id":"christmas","name":"Christmas","builtin":true,"colors":["#FF0000","#FFFFFF","#00FF00"]},
  {"id":"porch","name":"Porch","colors":["#FF8000","#00AA00"],"builtin":false}
]}
```

The two built-ins are immutable; custom entries reflect the current live preview.

## Power profile

Power configuration is separate from the unchanged nine-field lighting schema.
`GET /api/status` contains `power` (absent on firmware before this feature):

```json
{"revision":1,"supplyWatts":60,"ledMilliWatts":300,"headroomPercent":20,
 "volts":5,"maximumMa":9000,"budgetMa":9000,"ready":true,"recovery":"none"}
```

Authenticated **`PUT /api/power`** requires the normal session, CSRF, origin and
custom-header guards. Exact body:

```json
{"baseRevision":1,"power":{"supplyWatts":20,"ledMilliWatts":300}}
```

`baseRevision` is the independent `power.revision`, not the lighting revision.
Supply rating is an integer 1..2000 W; full-brightness LED RGB power is an integer
10..10000 mW (default 300 mW). Reject booleans, fractions, unknown or missing fields.
A successful checked write returns **200 with the complete status envelope**,
increments only the power revision and applies without restart. It neither
previews nor saves lighting/counts. Concurrent/stale edits return 409; unconfirmed
persistence returns 500 and retains the previous live limits. OTA/restart blocks
the operation. Read status after an ambiguous response; never replay automatically.

The fixed 5 V budget is
`min(maximumMa, floor(supplyWatts * 1000 * 80 / (100 * 5)))`.
Every effect includes 1 mA standby per active pixel plus calibrated RGB demand.
For a full-white warning, use
`count * 5 + ceil(count * ledMilliWatts * brightness / 100)` milliwatts,
with the larger active/draft count while restart is pending. Compare this against
`budgetMa * 5`, not just the supply's nominal rating.

Power uses its own checked NVS record. `recovery` is `none`, `missing`,
`invalid_record`, or `storage_unavailable`. Missing uses the 60 W / 300 mW profile;
an unreadable existing record makes `ready:false`, `budgetMa:0` and RGB black
until a valid profile is explicitly saved. Factory reset removes the power record;
ordinary lighting saves, Wi-Fi resets and OTA preserve it. `led.standbyExceedsBudget`
warns when even black-pixel standby exceeds the budget: dimming cannot fix that.
Software cannot disconnect physical standby power or replace electrical protection.

## Admin session

`GET /api/auth/session` → 200:

```json
{"configured":false,"authenticated":false,"claimAllowed":true,
 "csrfToken":null,"sessionLifetimeSeconds":1800}
```

Authenticated responses set `authenticated:true` and `csrfToken` to a 64-hex
string. `claimAllowed` is evaluated for the actual receiving interface: only an
AP client on the protected device hotspot can claim an unconfigured admin.

| Route | Exact JSON body | Success |
|---|---|---|
| `POST /api/auth/claim` | `{"password":"<user-chosen 12..64 byte password>"}` | 200 session object + Set-Cookie. AP-only and unconfigured-only. |
| `POST /api/auth/login` | `{"password":"<password>"}` | 200 session object + new cookie. |
| `POST /api/auth/logout` | `{}` | 200 unauthenticated session object + expired cookie. Requires current CSRF. |

Verifier is PBKDF2-HMAC-SHA256, random 16-byte salt, 60,000 iterations, 32-byte
output, mbedTLS implementation. Login attempts are separated by at least 1.5s;
after five failed attempts the minimum interval is 60s. Global to this device,
reset on boot. No universal default password or remote initial claim.

## Wi-Fi and administrative actions

All routes in this section require the session cookie; POST additionally CSRF.
Wi-Fi provisioning is asynchronous; a 202 means accepted, **not saved**.

| Route | Exact body | Success |
|---|---|---|
| `POST /api/wifi/scan` | `{}` | 202 `{"state":"running"}`; 409 if connecting/scanning. |
| `GET /api/wifi/scan` | None | 200 scan result below; no CSRF required for this read. |
| `POST /api/wifi/connect` | `{"ssid":"<1..32 bytes>","password":"<router password>"}` | 202 `{"state":"connecting"}`. |
| `POST /api/wifi/reset` | `{"confirm":"wifi-reset"}` | 200 `{"state":"setup_ap","apIp":"192.168.4.1"}`; preserves admin and lighting. |
| `POST /api/restart` | `{"confirm":"restart"}` | 202 `{"restarting":true}`; restores saved lighting on boot. |
| `POST /api/factory-reset` | `{"confirm":"factory-reset"}` | 202 `{"restarting":true}`; clears saved lighting, Wi-Fi and admin. |

Wi-Fi password is empty for an open network, 8..63 bytes for WPA passphrase, or
exactly 64 hex digits for a raw WPA PSK. Passwords are POST-only. SSIDs are
untrusted text: use `textContent`, never `innerHTML`. No JSONP or GET credentials.

```json
{"state":"complete","networks":[
  {"ssid":"Example router","rssi":-61,"channel":6,"open":false}
],"truncated":false}
```

Scan states: `idle`, `running`, `complete`, `failed`. Up to 20 entries returned.
Candidate states: `idle`, `connecting`, `succeeded`, `failed`. A candidate must
obtain an IP and remain connected for a second, then pass checked persistence,
before replacing the previous working credentials. On failure they are retained
and retried, with `network.error` set. A protected AP opens during candidate tests
and fallback; closes after two seconds of a successful stable home connection.
The phone may need to join the router network; use `.local` or the USB-reported IP.
Direct AP UI/control does not require choosing a router.

## Status

`GET /api/status` → 200; example with all field names:

```json
{
  "schemaVersion":1,"bootId":"0123456789abcdef","uptimeMs":12345,"freeHeapBytes":200000,
  "firmware":{"version":"0.5.0","target":"esp32s3_n16r8",
    "flashBytes":16777216,"psramBytes":8388608,
    "expectedFlashBytes":16777216,"expectedPsramBytes":8388608,"memoryMatches":true},
  "settings":{"revision":2,"savedRevision":1,"dirty":true,
    "activeLedCount":200,"requestedLedCount":250,"savedLedCount":200,
    "restartRequired":true,"savedRestartRequired":false,"recovery":"missing"},
  "led":{"ready":true,"gpio":4,"protocol":"WS2811","order":"RGB","maxCount":1000,"budgetMa":9000,
    "estimatedMa":1900,"requestedMa":1900,"limited":false,"scalePermille":1000,
    "frames":100,"pausedForUpdate":false,"standbyExceedsBudget":false,"activeLedCount":200,"requestedLedCount":250,
    "on":true,"brightness":25,"effect":"twinkle","paletteId":"builtin:light-blue"},
  "power":{"revision":1,"supplyWatts":60,"ledMilliWatts":300,"headroomPercent":20,
    "volts":5,"maximumMa":9000,"budgetMa":9000,"ready":true,"recovery":"missing"},
  "network":{"state":"setup_ap","hostname":"pixies-0123456789ab.local",
    "connected":false,"ip":"","ssid":"","apOpen":true,
    "apSsid":"Pixies-0123456789ab","apIp":"192.168.4.1",
    "wifiSaved":false,"candidateState":"idle","scanState":"idle","error":""},
  "admin":{"configured":false,"credentialRecovery":"none","claimAllowed":true},
  "update":{"state":"idle","busy":false,"receivedBytes":0,"expectedBytes":0,
    "slotBytes":7340032,"error":"","bleOtaProtocol":1},
  "restarting":false
}
```

Network states: `unconfigured`, `setup_ap`, `connecting`, `connected`,
`reconnecting`, `fallback_ap`. Credential-check failure errors:
`connection_failed`, `storage_failed`, `ap_start_failed` (empty string on no
error). Settings recovery: `none`, `missing`, `invalid_record`,
`storage_unavailable`. Credential recovery: `none`, `invalid_wifi_record`,
`invalid_admin_record`, `storage_unavailable`. A recovery reason means defaults
were used, not that an invalid record was silently overwritten.

`estimatedMa` is a conservative model **of the last rendered frame**, not a
measurement; idle current remains even with black pixels. During OTA these
figures may be stale; use `pausedForUpdate`. `scalePermille` is the current
limiter multiplier **in addition to** requested brightness.

`led.protocol` and `led.order` report the compiled output profile, not an
autodetected string. `led.activeLedCount` and `led.requestedLedCount` mirror the
settings counts; the other lighting fields reflect the current RAM preview.
The local USB `ledstatus` command returns only this `led` object.
`frames` counts software submissions, not confirmed physical pixel updates.

## Firmware upload — exact wire format

Only `.pio/build/esp32s3_n16r8/firmware.bin`, the **app-only** image:

```http
POST /api/update HTTP/1.1
Host: pixies-0123456789ab.local
Origin: http://pixies-0123456789ab.local
Cookie: pixies_session=<browser-managed-session>
X-Pixies-Request: 1
X-CSRF-Token: <csrfToken>
Content-Type: application/octet-stream
X-Firmware-Size: 825000
Content-Length: 825000

<exact raw bytes of firmware.bin, NOT multipart/FormData or base64>
```

Browser integration:

```js
const response = await fetch("/api/update", {
  method: "POST", credentials: "same-origin",
  headers: {
    "Content-Type": "application/octet-stream",
    "X-Pixies-Request": "1",
    "X-CSRF-Token": csrfToken,
    "X-Firmware-Size": String(file.size)
  },
  body: file
}); // Browser supplies Content-Length and Origin.
```

For upload progress use `XMLHttpRequest.upload.onprogress`, same headers,
`xhr.send(file)`. Browser files must have known size, 288..7,340,032 bytes.
Do not manually set Content-Length in JS. No merged image, bootloader,
partition table, filesystem image, chunked stream, or compression.

The inactive slot alone is written. Header requires ESP32-S3 chip ID, 16MB flash,
1..16 segments, appended SHA256, app descriptor and supported secure-version 0.
IDF then checks chip revision, checksum/hash and complete image. Actual received,
declared and parsed image lengths must match **before** boot partition selection.
All begin/chunk/end/select phases repeat the shared admin/origin/CSRF guard.
Malformed, truncated, oversized, unauthorized and failed-finalize transfers
cannot select the boot partition. Existing saved NVS is untouched.

Success: HTTP **202**
`{"state":"restarting","receivedBytes":825000,"restarting":true}`. Response is
sent first; restart is scheduled one second later. LEDs are blank during OTA
and resume the live preview after failure; unsaved preview is not automatically
saved. Mutations are rejected while updating/restarting.

Update states: `idle`, `receiving`, `writing`, `validating`, `validated`,
`restarting`, `failed`. Representative update errors: `invalid_size_or_busy`,
`partition_layout`, `invalid_size`, `unsupported_image`, `authorization_lost`,
`flash_begin_failed`, `flash_write_failed`, `length_mismatch`, `truncated_image`,
`invalid_image`, `invalid_image_length`, `boot_select_failed`, `transfer_aborted`.

The HTTP receiver services **one connection at a time**; during a streaming
upload another status poll/control waits in the TCP backlog. Use browser-side
byte progress, then status after failure/reconnect. Do not promise live parallel
status polling during upload. On boot/reconnect always reload status/config and
session; confirm the firmware version and new bootId. A 202 alone does not prove
the new firmware subsequently booted.
