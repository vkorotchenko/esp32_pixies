# Pixies BLE control v1

BLE is the normal local control/provisioning path on ESP32-S3. Bluetooth Classic
is not supported. Advertisements contain the service UUID below; the scan response
contains the friendly name `pixies`; the GAP device name matches. Discover by
service, not by an assumed MAC/name. Controllers share this friendly name;
connection and reconnection retain the native device ID. Wi-Fi hotspot and
hostname suffixes remain unchanged. One phone controls a connection; disconnect
to switch phones.

| Item | UUID | Properties |
| --- | --- | --- |
| Service | `9a77e401-8c5b-4c3b-908a-6c749f662800` | Pixies control |
| RX | `9a77e402-8c5b-4c3b-908a-6c749f662800` | Write with response, encrypted |
| TX | `9a77e403-8c5b-4c3b-908a-6c749f662800` | Notify |

The server requests bonding and LE Secure Connections with no-input/output
pairing. Accept the phone's normal prompt; no application account/password/PIN
is required. Only encrypted bonded peers can submit commands. No-PIN pairing
does not establish ownership or resist an active MITM during pairing. Any nearby
phone may attempt to pair. Do not expose HTTP to the Internet.

Encryption can become active before the first bond finishes exchanging keys.
The firmware queues encrypted writes during that interval and processes them
only after successful encrypted/bonded authentication. Pairing failure or
disconnect never executes those queued commands.

## Packet framing

Integers are unsigned little-endian. Each write/notification is **at most**
`min(MTU - 3, 244)` bytes; default MTU 23 is supported.

| Offset | Size | Meaning |
| --- | --- | --- |
| 0 | 1 | Version, exactly `1` |
| 1 | 1 | Direction: `0` request, `1` response |
| 2 | 2 | Nonzero transaction ID |
| 4 | 2 | Payload offset within the complete message |
| 6 | 2 | Complete message byte length, 1..8192 |
| 8 | remaining | UTF-8 JSON bytes; may split a UTF-8 character |

Use one transaction at a time. Start at offset zero, keep ID/length constant,
and send contiguous fragments. Decode UTF-8/JSON only after full reassembly.
Assembly/response deadlines are 30 seconds. Disconnect drops incomplete input;
malformed/overlapping input gets an explicit error or a disconnected link when a
usable ID/response channel is unavailable. Queue overflow disconnects, never
acknowledges an applied command. GATT write acknowledgement alone is not command
success; wait for the framed response.

The minimum-MTU vector for response `{}` and ID `0x1234` is:
`01 01 34 12 00 00 02 00 7B 7D`.

Request: `{"op":"config","args":{}}`.
Response: `{"status":200,"body":{...}}`.

The body uses the same sanitized response/error/configuration schema as
[HTTP API v1](API.md). A non-2xx status is a failure, not a successful default.
Notification loss/timeouts can leave the result uncertain; reconnect and read
state rather than automatically replaying a Save, restart, or credentials.

## Commands

| `op` | Exact `args` | Result |
| --- | --- | --- |
| `config` | `{}` | Current configuration/revisions/counts |
| `status` | `{}` | Sanitized device, LED, Wi-Fi, update state |
| `palettes` | `{}` | Three built-ins plus current custom palettes |
| `config.set` | `{"baseRevision":n,"config":{...}}` | Atomic RAM preview, new revision |
| `config.save` | `{"baseRevision":n}` | Checked NVS Save, same config envelope |
| `power.save` | `{"baseRevision":n,"power":{"supplyWatts":60,"ledMilliWatts":300}}` | Checked independent power Save, complete status envelope; no restart |
| `wifi.scan` | `{}` | 202, asynchronous ESP-side scan started |
| `wifi.scan.get` | `{}` | Scan state and up to 20 networks |
| `wifi.connect` | `{"ssid":"...","password":"..."}` | 202, candidate testing started |
| `wifi.reset` | `{"confirm":"wifi-reset"}` | Remove Wi-Fi only, retain lights/bonds/admin |
| `restart` | `{"confirm":"restart"}` | 202, delayed restart |
| `factory-reset` | `{"confirm":"factory-reset"}` | Clear settings, credentials, admin and bonds; restart |
| `admin.claim` | `{"password":"..."}` | Optional first website-admin setup, 12..64 bytes |
| `ota.begin` | `{"size":n,"sha256":"<64 lowercase hex>","version":"x.y.z","target":"esp32s3_n16r8"}` | 200 `{transferId,offset:0,chunkBytes:1024}` |
| `ota.chunk` | `{"transferId":"<16 lowercase hex>","offset":n,"data":"<base64>"}` | 200 `{transferId,offset:<next offset>}` |
| `ota.finish` | `{"transferId":"..."}` | 202 `{state:"restarting",version,receivedBytes}` after verification/boot selection |
| `ota.abort` | `{"transferId":"..."}` | 200 `{state:"aborted"}` |

`admin.claim` is not an app login and is unnecessary for BLE control. Existing web
administration still requires its normal password/session; BLE initial setup is
an alternative to initial protected-AP claim, not a new unauthenticated HTTP route.

Poll status after Wi-Fi connect: success requires `candidateState:"succeeded"`,
`connected:true`, and `wifiSaved:true`, not just a 202 reply. Failed candidates
do not replace previously saved credentials. Passwords are never echoed.

Both transports share configuration, revisions, Save, network operations and
OTA/restart busy checks. A browser edit can cause a BLE revision conflict:
reload deliberately rather than silently overwriting another controller.

## Power profile

Power-capable status includes `power` with its own per-boot revision, supply
watts, full-brightness LED milliwatts, fixed 5 V/headroom, hardware/effective mA
limits and recovery/readiness. Use **that** revision in `power.save`, not the
lighting revision. The paired encrypted session authorizes power editing; no
website login is required. All normal OTA/restart busy checks still apply.

Defaults are 60 W and 300 mW/LED. Firmware enforces 80% supply output with the
compiled 9 A ceiling, including standby allowance. Validate/save before applying;
failed persistence preserves the previous live limits. Invalid existing power
records disable RGB until repaired, while missing profiles use defaults without
changing saved lighting. See [power units, exact limits and warnings](API.md#power-profile).

Older firmware lacks `status.power`; keep lighting usable and explicitly disable
power editing instead of adding fields to its strict lighting configuration.

## BLE firmware OTA

Status advertises `update.bleOtaProtocol:1` from firmware 0.3.0. Earlier images
need one USB/browser bootstrap. Begin accepts only the compiled target and a
strictly newer stable version; the image must fit the inactive 7MiB application
slot. Every command requires the same encrypted, bonded connection generation
and transfer ID. Decoded chunks contain 1..1024 bytes and must start at the exact
next offset. The ordinary framing and command-response deadlines still apply.

Flash work runs in the application loop, not NimBLE callbacks. The shared
updater owns each transfer exclusively: HTTP cannot write, finalize, select or
abort a BLE transfer, or vice versa. Settings, network mutations and restart
remain busy while updating. Begin rejects an active Wi-Fi candidate or scan.

Disconnect, lost authorization, invalid chunk/offset, failed flash/checksum,
truncation, explicit abort, or 60 seconds without transfer progress cancels an
incomplete owned transfer and restores rendering. None selects an incomplete
image. Finish verifies the streaming SHA-256 and ESP-IDF image checks before
selecting the boot slot. The final framed reply drains before scheduling the
one-second restart; if that connection disappears after selection, the device
still restarts.

Do not replay ambiguous mutations. After finalization, require reconnection to
the same controller, a new boot ID, matching target, and the exact requested
version. A disconnect or an `ota.finish` GATT acknowledgement alone is not
success. Saved NVS survives normal updates; unsaved previews do not.
Hashes plus encrypted BLE are not signed ESP firmware, secure boot, or rollback.

## Defaults, recovery, and acceptance

With no valid saved lighting record, use `builtin:light-blue`, `twinkle`, 200
pixels, brightness 25%. Valid saved settings override defaults across restart
and firmware updates. Wi-Fi failure/reset does not reset lighting. Normal USB
and browser updates preserve NVS; factory reset intentionally restores defaults.

Factory reset also clears ESP bond keys. If a phone retains its old bond, forget
Pixies in the phone's Bluetooth settings and pair again.

Real-phone acceptance requires Android and iPhone pairing, denied permissions,
disconnect/reconnect, maximum palettes at minimum/negotiated MTU, Save/reboot,
wrong Wi-Fi credentials without losing old settings, BLE during Wi-Fi scanning,
and mutations rejected during browser OTA. Simulator/unit builds cannot prove
these physical/radio behaviors or actual LED output.
