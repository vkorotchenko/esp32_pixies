import test from "node:test";
import assert from "node:assert/strict";
import {
  EFFECTS, PREVIEW_INTERVAL_MS, ApiError, validateConfig, normalizeConfig, sameConfig,
  nextPaletteId, deletePalette, effectUsage, validatePassword, validateWifi, validateFirmware,
  previewDelay, createApi, parseReply, checkSnapshot, checkStatus, checkSession, checkPalettes,
  createUiState, editDraft, adoptSnapshot, acceptPreview, saveVerification, savePresentation,
  uploadFirmware,
} from "../app.js";
import { configFixture, snapshotFixture, statusFixture, sessionFixture, palettesFixture } from "./fixtures.js";

const custom = () => ({ id: "porch", name: "Porch", colors: ["#ff8000", "#00aa00"] });
const stateFixture = () => { const state = createUiState(); adoptSnapshot(state, snapshotFixture()); return state; };

test("all integer boundaries and strict complete-object validation match firmware schema", () => {
  for (const count of [1, 200, 1000]) assert.deepEqual(validateConfig(configFixture({ ledCount: count })), {});
  for (const count of [0, 1001, 1.1, "200", null, true, NaN, Infinity]) assert.ok(validateConfig(configFixture({ ledCount: count })).ledCount);
  for (const key of ["brightness", "speed", "intensity", "density"]) {
    for (const value of [0, 25, 100]) assert.deepEqual(validateConfig(configFixture({ [key]: value })), {});
    for (const value of [-1, 101, "25", false, 2.3, null]) assert.ok(validateConfig(configFixture({ [key]: value }))[key]);
  }
  assert.ok(validateConfig(configFixture({ on: 1 })).on);
  assert.ok(validateConfig(configFixture({ effect: "flames" })).effect);
  assert.ok(validateConfig({ ...configFixture(), extra: 1 }).config);
  const missing = configFixture(); delete missing.density; assert.ok(validateConfig(missing).config);
  for (const value of [null, false, [], undefined]) assert.ok(Object.keys(validateConfig(value)).length);
});
test("themes and all five effects remain independent", () => {
  for (const effect of EFFECTS) for (const paletteId of ["builtin:light-blue", "halloween", "christmas", "porch"]) {
    assert.deepEqual(validateConfig(configFixture({ effect, paletteId, customPalettes: [custom()] })), {});
  }
  assert.deepEqual(effectUsage("steady"), { speed: false, intensity: false, density: false });
  assert.deepEqual(effectUsage("breathe"), { speed: true, intensity: false, density: false });
  for (const effect of ["twinkle", "candle", "chase"]) assert.deepEqual(effectUsage(effect), { speed: true, intensity: true, density: true });
});
test("custom palette 10/8 boundaries, ASCII names, RGB normalization and ID rules", () => {
  const palettes = Array.from({ length: 10 }, (_, i) => ({ id: `p-${i}`, name: "X".repeat(32), colors: Array(8).fill("#ab09ef") }));
  const config = configFixture({ paletteId: "p-9", customPalettes: palettes });
  assert.deepEqual(validateConfig(config), {});
  assert.equal(normalizeConfig(config).customPalettes[0].colors[0], "#AB09EF");
  assert.equal(config.customPalettes[0].colors[0], "#ab09ef", "normalization does not mutate the draft");
  assert.ok(validateConfig({ ...config, customPalettes: [...palettes, custom()] }).customPalettes);
  for (const patch of [{ colors: [] }, { colors: Array(9).fill("#000000") }, { colors: ["<img>"] }, { colors: ["#fff"] }, { colors: [null] }, { name: "" }, { name: "x".repeat(33) }, { name: "💡" }, { name: "tab\t" }, { id: "halloween" }, { id: "christmas" }, { id: "bad id" }, { id: "UPPER" }, { id: "a".repeat(25) }, { builtin: false }]) {
    assert.ok(Object.keys(validateConfig(configFixture({ customPalettes: [{ ...custom(), ...patch }] }))).length, JSON.stringify(patch));
  }
  assert.ok(Object.keys(validateConfig(configFixture({ customPalettes: [custom(), custom()] }))).some(k => k.endsWith(".id")));
  assert.deepEqual(validateConfig(configFixture({ customPalettes: [{ ...custom(), name: '<script>alert("text")</script>' }] })), {}, "printable names must be rendered as text, not silently stripped");
});
test("selected custom deletion chooses valid replacement atomically; builtins cannot be deleted", () => {
  const config = configFixture({ customPalettes: [custom()], paletteId: "porch", effect: "chase" });
  const next = deletePalette(config, "porch");
  assert.equal(next.paletteId, "halloween"); assert.deepEqual(next.customPalettes, []); assert.equal(next.effect, "chase");
  assert.equal(config.paletteId, "porch", "original remains unchanged");
  assert.throws(() => deletePalette(config, "christmas"));
  assert.equal(nextPaletteId([{ id: "palette-1" }, { id: "palette-3" }]), "palette-2");
});
test("password and Wi-Fi byte validation, open networks and raw 64-digit PSKs", () => {
  assert.equal(validatePassword("a".repeat(12)), ""); assert.equal(validatePassword("a".repeat(64)), "");
  assert.equal(validatePassword("é".repeat(6)), ""); assert.notEqual(validatePassword("a".repeat(11)), "");
  assert.notEqual(validatePassword("é".repeat(33)), ""); assert.notEqual(validatePassword("a".repeat(12), "b".repeat(12)), "");
  assert.deepEqual(validateWifi("Home", ""), {}); assert.deepEqual(validateWifi("é".repeat(16), "x".repeat(8)), {});
  assert.deepEqual(validateWifi("Home", "a".repeat(64)), {}); assert.deepEqual(validateWifi("Home", "x".repeat(63)), {});
  for (const ssid of ["", "é".repeat(17), "x\0y"]) assert.ok(validateWifi(ssid, "").ssid);
  for (const password of ["short", "x".repeat(64), "é".repeat(32), "x\0".repeat(6)]) assert.ok(validateWifi("Home", password).password);
});
test("app file selection is bounded by authoritative slot size, no fictional default slot", () => {
  const file = (size, name = "firmware.bin") => ({ size, name });
  assert.equal(validateFirmware(file(288), 7340032), "");
  assert.equal(validateFirmware(file(7340032), 7340032), "");
  for (const value of [undefined, file(287), file(7340033), file(1000, "image.zip")]) assert.notEqual(validateFirmware(value, 7340032), "");
  assert.notEqual(validateFirmware(file(1000), undefined), "");
  assert.notEqual(validateFirmware(file(1000), 900), "");
});
test("preview scheduling enforces 350ms spacing and coalesces slider input", () => {
  assert.equal(PREVIEW_INTERVAL_MS, 350);
  assert.equal(previewDelay(1000, 990), 340); assert.equal(previewDelay(1000, 0), 220);
});
test("same-origin API JSON transport, exact bodies, custom marker, admin CSRF and no forbidden headers", async () => {
  const calls = [];
  const api = createApi({ getCsrf: () => "a".repeat(64), fetchImpl: async (path, options) => {
    calls.push({ path, ...options }); return new Response(JSON.stringify({ state: "connecting" }), { status: 202 });
  } });
  await api("/api/wifi/connect", { method: "POST", body: { ssid: "Home", password: "example-only" }, admin: true, expected: 202 });
  assert.equal(calls[0].credentials, "same-origin"); assert.equal(calls[0].cache, "no-store");
  assert.deepEqual(JSON.parse(calls[0].body), { ssid: "Home", password: "example-only" });
  assert.deepEqual(calls[0].headers, { "Content-Type": "application/json", "X-Pixies-Request": "1", "X-CSRF-Token": "a".repeat(64) });
  for (const key of ["Origin", "Content-Length", "Cookie"]) assert.equal(calls[0].headers[key], undefined);
  const lighting = createApi({ getCsrf: () => "a".repeat(64), fetchImpl: async (_, options) => {
    assert.equal(options.headers["X-CSRF-Token"], undefined); return new Response("{}");
  } });
  await lighting("/api/save", { method: "POST", body: { baseRevision: 1 } });
});
test("GET reads have no body/CSRF, oversized objects and unauthenticated admin fail before network", async () => {
  let calls = 0;
  const api = createApi({ fetchImpl: async (_, opts) => { calls++; assert.equal(opts.body, undefined); assert.deepEqual(opts.headers, {}); return new Response("{}"); } });
  await api("/api/status");
  await assert.rejects(api("/api/restart", { method: "POST", admin: true, body: { confirm: "restart" } }), { status: 401 });
  await assert.rejects(api("/api/config", { method: "PUT", body: { extra: "x".repeat(8192) } }), { code: "validation" });
  assert.equal(calls, 1);
});
test("HTTP errors expose field and Retry-After; missing/non-JSON/misleading 2xx never become success", async () => {
  assert.throws(() => parseReply(422, '{"error":{"code":"validation","field":"ledCount","message":"bad count"}}'), e => e.field === "ledCount" && e.status === 422);
  assert.throws(() => parseReply(429, '{"error":{"code":"rate_limited","message":"wait"}}', "60"), e => e.retryAfter === 60);
  for (const text of ["<html>portal</html>", "", "null", "[]", "true"]) assert.throws(() => parseReply(200, text, null, true), e => e.code === "protocol" && e.uncertain);
  const api = createApi({ fetchImpl: async () => new Response("{}", { status: 202 }) });
  await assert.rejects(api("/api/save", { method: "POST", body: { baseRevision: 1 } }), { code: "protocol", uncertain: true });
});
test("401 clears memory session and network failures distinguish uncertain mutations", async () => {
  let cleared = 0;
  const api = createApi({ onUnauthorized: () => cleared++, fetchImpl: async () => new Response('{"error":{"code":"authentication","message":"expired"}}', { status: 401 }) });
  await assert.rejects(api("/api/status"), { status: 401 }); assert.equal(cleared, 1);
  const offline = createApi({ fetchImpl: async () => { throw new TypeError("offline"); } });
  await assert.rejects(offline("/api/status"), { code: "network", uncertain: false });
  await assert.rejects(offline("/api/save", { method: "POST", body: { baseRevision: 1 } }), { code: "network", uncertain: true });
});
test("read timeouts abort and never fabricate state", async () => {
  const api = createApi({ timeoutMs: 5, fetchImpl: (_, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  }) });
  await assert.rejects(api("/api/status"), { code: "network" });
});
test("authoritative response guards reject partial sessions/status/config instead of success defaults", () => {
  assert.deepEqual(checkSnapshot(snapshotFixture()), snapshotFixture());
  assert.deepEqual(checkStatus(statusFixture()), statusFixture());
  assert.deepEqual(checkSession(sessionFixture()), sessionFixture());
  assert.equal(checkPalettes({ palettes: palettesFixture() }).length, 3);
  for (const value of [{}, snapshotFixture(configFixture(), { requestedLedCount: 300 }), snapshotFixture(configFixture(), { savedRestartRequired: true }), snapshotFixture(configFixture(), { dirty: "false" })]) assert.throws(() => checkSnapshot(value));
  assert.throws(() => checkStatus({ schemaVersion: 1 }));
  const incomplete = statusFixture(); delete incomplete.update.slotBytes; assert.throws(() => checkStatus(incomplete));
  assert.throws(() => checkSession(sessionFixture({ authenticated: true, configured: true, csrfToken: "invalid" })));
  assert.throws(() => checkSession(sessionFixture({ csrfToken: "a".repeat(64) })));
  assert.throws(() => checkPalettes({ palettes: [] }));
});
test("edits made in flight are preserved; successful preview stays unsaved and power is part of settings", () => {
  const state = stateFixture();
  const sent = configFixture({ brightness: 30, on: false });
  editDraft(state, sent); editDraft(state, { ...sent, brightness: 40 });
  acceptPreview(state, sent, snapshotFixture(sent, { revision: 2, dirty: true }));
  assert.equal(state.draft.brightness, 40); assert.equal(state.localEdits, true); assert.equal(state.device.config.brightness, 30);
  const latest = structuredClone(state.draft);
  acceptPreview(state, latest, snapshotFixture(latest, { revision: 3, dirty: true }));
  assert.equal(state.localEdits, false); assert.equal(state.device.config.on, false);
  assert.match(savePresentation(state)[0], /Unsaved/);
});
test("409 and concurrent edits retain the entire local draft until explicit use-device or overwrite", () => {
  const state = stateFixture();
  editDraft(state, configFixture({ brightness: 70, customPalettes: [custom()], paletteId: "porch" }));
  const remote = snapshotFixture(configFixture({ effect: "chase" }), { revision: 2, dirty: true });
  adoptSnapshot(state, remote, { reason: "conflict" });
  assert.equal(state.draft.brightness, 70); assert.equal(state.draft.paletteId, "porch"); assert.ok(state.conflict);
  assert.equal(state.device.config.effect, "chase"); assert.equal(state.localEdits, true);
  assert.match(savePresentation(state)[0], /decision/);
  adoptSnapshot(state, remote, { force: true });
  assert.equal(state.draft.effect, "chase"); assert.equal(state.localEdits, false); assert.equal(state.conflict, null);
});
test("reconnect does not replay queued edits even when revision is unchanged", () => {
  const state = stateFixture(); editDraft(state, configFixture({ brightness: 80 })); state.online = false;
  adoptSnapshot(state, snapshotFixture(), { reason: "reconnect" });
  assert.ok(state.conflict); assert.equal(state.draft.brightness, 80);
});
test("boot ID, not monotonic revision alone, detects reboots and preserves unsaved RAM drafts", () => {
  const state = stateFixture();
  const preview = configFixture({ on: false });
  editDraft(state, preview); acceptPreview(state, preview, snapshotFixture(preview, { revision: 2, dirty: true }));
  assert.equal(state.localEdits, false);
  const result = adoptSnapshot(state, snapshotFixture(configFixture(), { bootId: "fedcba9876543210" }), { reason: "boot" });
  assert.equal(result.bootChanged, true); assert.equal(state.draft.on, false); assert.equal(state.device.config.on, true);
  assert.equal(state.conflict.reason, "boot");
});
test("a remote controller cannot silently replace this page's acknowledged but unsaved preview", () => {
  const state = stateFixture();
  const preview = configFixture({ brightness: 45 });
  editDraft(state, preview); acceptPreview(state, preview, snapshotFixture(preview, { revision: 2, dirty: true }));
  adoptSnapshot(state, snapshotFixture(configFixture({ brightness: 88 }), { revision: 3, dirty: true }), { reason: "conflict" });
  assert.ok(state.conflict); assert.equal(state.draft.brightness, 45); assert.equal(state.device.config.brightness, 88);
});
test("active/requested/saved count states are never substituted for each other", () => {
  const state = stateFixture();
  const config = configFixture({ ledCount: 250 });
  adoptSnapshot(state, snapshotFixture(config, { dirty: true, revision: 2 }), { force: true });
  assert.equal(state.device.activeLedCount, 200); assert.equal(state.device.requestedLedCount, 250); assert.equal(state.device.savedLedCount, 200);
  adoptSnapshot(state, snapshotFixture(config, { revision: 2, savedRevision: 2, savedLedCount: 250, savedRestartRequired: true }), { force: true });
  assert.match(savePresentation(state)[1], /restart/);
});
test("ambiguous Save is reconciled from real state; no original success is invented", () => {
  const attempt = { bootId: snapshotFixture().bootId, config: configFixture() };
  assert.match(saveVerification(attempt, snapshotFixture()), /original Save response was lost/);
  assert.match(saveVerification(attempt, snapshotFixture(configFixture(), { dirty: true })), /not confirmed/);
  assert.match(saveVerification(attempt, snapshotFixture(configFixture({ brightness: 80 }))), /cannot be verified/);
  assert.match(saveVerification(attempt, snapshotFixture(configFixture(), { bootId: "fedcba9876543210" })), /rebooted/);
  assert.match(saveVerification({ ...attempt, wasDirty: false, savedRevision: 1 }, snapshotFixture()), /cannot prove/);
});
test("dirty/saving/offline/error/unknown/upload states are distinct, not optimistic saved", () => {
  const state = stateFixture();
  assert.match(savePresentation(state)[0], /Saved/);
  assert.match(savePresentation(state, { recoverySaveNeeded: true })[0], /recovery/);
  assert.match(savePresentation(state, { saving: true })[0], /Saving/);
  assert.match(savePresentation(state, { locked: true })[0], /operation/);
  state.error = "storage failed"; assert.match(savePresentation(state)[0], /attention/);
  state.online = false; assert.match(savePresentation(state)[0], /unavailable/);
  state.uncertain = { kind: "save" }; assert.match(savePresentation(state)[0], /not confirmed/);
});

function fakeXhr({ status = 202, reply, error = false } = {}) {
  return {
    headers: {}, upload: {}, status, responseText: JSON.stringify(reply || { state: "restarting", receivedBytes: 1024, restarting: true }),
    open(method, path, async) { this.method = method; this.path = path; this.async = async; },
    setRequestHeader(name, value) { this.headers[name] = value; },
    getResponseHeader() { return null; },
    send(body) {
      this.body = body;
      queueMicrotask(() => {
        if (error) this.onerror();
        else { this.upload.onprogress({ lengthComputable: true, loaded: 512, total: 1024 }); this.onload(); }
      });
    },
  };
}
test("XHR OTA sends the File itself, credentials and exact headers with real browser progress", async () => {
  const file = { name: "firmware.bin", size: 1024 };
  const xhr = fakeXhr(), progress = [];
  const reply = await uploadFirmware(file, "b".repeat(64), { xhrFactory: () => xhr, onProgress: p => progress.push(p) });
  assert.equal(xhr.body, file); assert.equal(xhr.method, "POST"); assert.equal(xhr.path, "/api/update");
  assert.equal(xhr.withCredentials, true); assert.equal(xhr.timeout, 185000);
  assert.equal(xhr.headers["Content-Type"], "application/octet-stream"); assert.equal(xhr.headers["X-Firmware-Size"], "1024");
  assert.equal(xhr.headers["X-Pixies-Request"], "1"); assert.equal(xhr.headers["X-CSRF-Token"], "b".repeat(64));
  assert.equal(xhr.headers["Content-Length"], undefined); assert.equal(xhr.headers.Origin, undefined);
  assert.deepEqual(progress, [50]); assert.equal(reply.restarting, true, "202 is restart scheduled, not boot verified");
});
test("OTA rejects HTTP failures, session loss, malformed success, truncated size and ambiguous disconnect", async () => {
  const file = { size: 1024 };
  let expired = 0;
  await assert.rejects(uploadFirmware(file, "token", { xhrFactory: () => fakeXhr({ status: 401, reply: { error: { code: "authentication", message: "expired" } } }), onUnauthorized: () => expired++ }), { status: 401 });
  assert.equal(expired, 1);
  for (const options of [{ status: 200 }, { reply: { state: "validated" } }, { reply: { state: "restarting", restarting: true, receivedBytes: 1000 } }]) {
    await assert.rejects(uploadFirmware(file, "token", { xhrFactory: () => fakeXhr(options) }), { code: "protocol", uncertain: true });
  }
  await assert.rejects(uploadFirmware(file, "token", { xhrFactory: () => fakeXhr({ error: true }) }), { code: "network", uncertain: true });
  await assert.rejects(uploadFirmware(file, null), { code: "authentication" });
});
test("configuration equality uses semantic key order and normalized colors", () => {
  const a = configFixture({ customPalettes: [custom()] });
  const b = Object.fromEntries(Object.entries(a).reverse());
  b.customPalettes = [{ colors: ["#FF8000", "#00AA00"], name: "Porch", id: "porch" }];
  assert.equal(sameConfig(a, b), true);
  assert.throws(() => normalizeConfig({ ...a, on: null }), ApiError);
});
