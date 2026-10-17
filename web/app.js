// The only production JS asset. No runtime dependencies, remote assets or browser storage.
// Helpers are exported so the exact production validation/transport/state paths run in Node.
export const EFFECTS = Object.freeze(["steady", "twinkle", "candle", "breathe", "chase"]);
export const PREVIEW_INTERVAL_MS = 350;
export const MAX_IMAGE_BYTES = 0x700000;
const CONFIG_KEYS = ["ledCount", "on", "brightness", "speed", "intensity", "density", "effect", "paletteId", "customPalettes"];
const BUILTIN_IDS = ["builtin:light-blue", "halloween", "christmas"];
const clone = value => structuredClone(value);
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const byteLength = value => new TextEncoder().encode(value).length;
const colorPattern = /^#[0-9a-f]{6}$/i;
const idPattern = /^[a-z0-9_-]{1,24}$/;

export function validateConfig(config) {
  const errors = {};
  if (!exactKeys(config, CONFIG_KEYS)) errors.config = "A complete lighting configuration with no extra fields is required.";
  if (!object(config)) return errors;
  if (!integer(config.ledCount, 1, 1000)) errors.ledCount = "Use a whole pixel count from 1 to 1,000.";
  if (typeof config.on !== "boolean") errors.on = "Power must be on or off.";
  for (const key of ["brightness", "speed", "intensity", "density"]) {
    if (!integer(config[key], 0, 100)) errors[key] = `${key[0].toUpperCase() + key.slice(1)} must be a whole percentage from 0 to 100.`;
  }
  if (!EFFECTS.includes(config.effect)) errors.effect = "Choose one of the five supported effects.";
  const ids = new Set(BUILTIN_IDS);
  if (!Array.isArray(config.customPalettes) || config.customPalettes.length > 10) errors.customPalettes = "Use no more than 10 custom palettes.";
  else config.customPalettes.forEach((palette, index) => {
    const prefix = `customPalettes[${index}]`;
    if (!exactKeys(palette, ["id", "name", "colors"])) {
      errors[prefix] = "A palette needs only an ID, name and colors.";
      return;
    }
    if (typeof palette.id !== "string" || !idPattern.test(palette.id) || ids.has(palette.id)) errors[`${prefix}.id`] = "Use a unique 1–24 character lowercase ID; seasonal IDs are reserved.";
    ids.add(palette.id);
    if (typeof palette.name !== "string" || !/^[\x20-\x7e]{1,32}$/.test(palette.name)) errors[`${prefix}.name`] = "Use 1–32 printable ASCII characters for the name.";
    if (!Array.isArray(palette.colors) || !integer(palette.colors.length, 1, 8)) errors[`${prefix}.colors`] = "A palette needs 1–8 colors.";
    else palette.colors.forEach((color, i) => {
      if (typeof color !== "string" || !colorPattern.test(color)) errors[`${prefix}.colors[${i}]`] = "Use a six-digit RGB color, for example #FF8000.";
    });
  });
  if (typeof config.paletteId !== "string" || (!idPattern.test(config.paletteId) && !BUILTIN_IDS.includes(config.paletteId)) || !ids.has(config.paletteId)) errors.paletteId = "Choose a theme included in this configuration.";
  return errors;
}

export function normalizeConfig(config) {
  const errors = validateConfig(config);
  if (Object.keys(errors).length) throw new ApiError("validation", Object.values(errors)[0], { field: Object.keys(errors)[0], status: 422 });
  return Object.fromEntries(CONFIG_KEYS.map(key => [key, key === "customPalettes"
    ? config.customPalettes.map(p => ({ id: p.id, name: p.name, colors: p.colors.map(c => c.toUpperCase()) }))
    : config[key]]));
}
export const sameConfig = (a, b) => JSON.stringify(normalizeConfig(a)) === JSON.stringify(normalizeConfig(b));

export function nextPaletteId(palettes) {
  const ids = new Set(palettes.map(p => p.id));
  for (let n = 1; n <= 11; n++) if (!ids.has(`palette-${n}`)) return `palette-${n}`;
  throw new Error("Palette limit reached");
}
export function deletePalette(config, id) {
  if (BUILTIN_IDS.includes(id)) throw new Error("Seasonal palettes cannot be deleted.");
  const next = clone(config);
  next.customPalettes = next.customPalettes.filter(p => p.id !== id);
  if (next.paletteId === id) next.paletteId = "halloween";
  return normalizeConfig(next);
}
export function effectUsage(effect) {
  return { speed: effect !== "steady", intensity: ["twinkle", "candle", "chase"].includes(effect), density: ["twinkle", "candle", "chase"].includes(effect) };
}
export function validatePassword(password, confirmation) {
  if (typeof password !== "string" || byteLength(password) < 12 || byteLength(password) > 64) return "Use a password of 12–64 UTF-8 bytes (not necessarily characters).";
  if (confirmation !== undefined && password !== confirmation) return "The passwords do not match.";
  return "";
}
export function validateWifi(ssid, password) {
  const errors = {};
  if (typeof ssid !== "string" || byteLength(ssid) < 1 || byteLength(ssid) > 32 || ssid.includes("\0")) errors.ssid = "Use a network name of 1–32 UTF-8 bytes.";
  if (typeof password !== "string" || password.includes("\0") || !(password === "" || (byteLength(password) >= 8 && byteLength(password) <= 63) || /^[a-f0-9]{64}$/i.test(password))) errors.password = "Use an empty password for open Wi-Fi, 8–63 bytes, or exactly 64 hexadecimal digits.";
  return errors;
}
export function validateFirmware(file, slotBytes) {
  if (!file || typeof file.name !== "string" || !/\.bin$/i.test(file.name)) return "Choose an app-only firmware.bin file.";
  if (!integer(slotBytes, 288, MAX_IMAGE_BYTES)) return "Read the device's OTA slot size before uploading.";
  if (!Number.isSafeInteger(file.size) || file.size < 288 || file.size > slotBytes) return `The app image must be 288–${slotBytes.toLocaleString("en-US")} bytes.`;
  return "";
}
export const previewDelay = (now, lastSent) => Math.max(220, PREVIEW_INTERVAL_MS - (now - lastSent));

export class ApiError extends Error {
  constructor(code, message, { status = 0, field = "", retryAfter = 0, uncertain = false } = {}) {
    super(message);
    this.name = "ApiError"; this.code = code; this.status = status; this.field = field; this.retryAfter = retryAfter; this.uncertain = uncertain;
  }
}
export function mutationHeaders(csrf, binary = false) {
  const headers = { "Content-Type": binary ? "application/octet-stream" : "application/json", "X-Pixies-Request": "1" };
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
}
export function uploadHeaders(csrf, size) {
  if (!Number.isSafeInteger(size) || size < 288 || size > MAX_IMAGE_BYTES) throw new Error("Invalid firmware size");
  if (!csrf) throw new ApiError("authentication", "Sign in before uploading firmware.", { status: 401 });
  return { ...mutationHeaders(csrf, true), "X-Firmware-Size": String(size) };
}
export function parseReply(status, text, retryAfter = null, mutation = false) {
  let data;
  try { data = JSON.parse(text); } catch {
    throw new ApiError("protocol", `Device returned HTTP ${status} without a valid JSON response. Refresh before retrying.`, { status, uncertain: mutation && status >= 200 && status < 300 });
  }
  if (status < 200 || status >= 300) {
    const code = typeof data.error?.code === "string" ? data.error.code : "http";
    const message = typeof data.error?.message === "string" ? data.error.message : `Device rejected the request (HTTP ${status}).`;
    throw new ApiError(code, message, { status, field: typeof data.error?.field === "string" ? data.error.field : "", retryAfter: /^\d+$/.test(retryAfter || "") ? Number(retryAfter) : 0 });
  }
  if (!object(data)) throw new ApiError("protocol", "Device response was not a JSON object.", { status, uncertain: mutation });
  return data;
}
export function createApi({ fetchImpl = globalThis.fetch, getCsrf = () => null, onUnauthorized = () => {}, timeoutMs = 10000 } = {}) {
  return async function request(path, { method = "GET", body, admin = false, expected = 200 } = {}) {
    const mutation = method !== "GET";
    const token = admin ? getCsrf() : null;
    if (admin && mutation && !token) throw new ApiError("authentication", "Sign in again to continue.", { status: 401 });
    const serialized = mutation ? JSON.stringify(body) : undefined;
    if (mutation && (!object(body) || byteLength(serialized) > 8192)) throw new ApiError("validation", "JSON request must be an object no larger than 8,192 bytes.", { status: 422 });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(path, { method, headers: mutation ? mutationHeaders(token) : {}, credentials: "same-origin", cache: "no-store", body: serialized, signal: controller.signal });
      if (response.status === 401) onUnauthorized();
      const data = parseReply(response.status, await response.text(), response.headers.get("Retry-After"), mutation);
      if (response.status !== expected) throw new ApiError("protocol", `Expected HTTP ${expected}; received ${response.status}. Refresh device state before retrying.`, { status: response.status, uncertain: mutation });
      return data;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError("network", "Device did not reply. Check your Wi-Fi and refresh device state; the request may have reached it.", { uncertain: mutation });
    } finally { clearTimeout(timer); }
  };
}

const protocolError = () => new ApiError("protocol", "The device returned incomplete or incompatible state. Controls are paused; refresh or check the firmware.");
export function checkSnapshot(data) {
  if (!object(data) || data.schemaVersion !== 1 || typeof data.bootId !== "string" || !/^[a-f0-9]{16}$/i.test(data.bootId)
    || !integer(data.revision, 0, 0xffffffff) || !integer(data.savedRevision, 0, 0xffffffff)
    || ["dirty", "restartRequired", "savedRestartRequired"].some(k => typeof data[k] !== "boolean")
    || ["activeLedCount", "requestedLedCount", "savedLedCount"].some(k => !integer(data[k], 1, 1000))
    || Object.keys(validateConfig(data.config)).length || data.requestedLedCount !== data.config.ledCount
    || data.restartRequired !== (data.activeLedCount !== data.requestedLedCount)
    || data.savedRestartRequired !== (data.activeLedCount !== data.savedLedCount)) throw protocolError();
  return clone({ ...data, config: normalizeConfig(data.config) });
}
export function checkSession(data) {
  if (!object(data) || ["configured", "authenticated", "claimAllowed"].some(k => typeof data[k] !== "boolean")
    || !integer(data.sessionLifetimeSeconds, 1, 86400) || (data.authenticated ? !/^[a-f0-9]{64}$/i.test(data.csrfToken) || !data.configured : data.csrfToken !== null)) throw protocolError();
  return data;
}
export function checkStatus(data) {
  const stringPaths = ["bootId", "firmware.version", "firmware.target", "settings.recovery", "network.state", "network.hostname", "network.ip", "network.ssid", "network.apSsid", "network.apIp", "network.candidateState", "network.scanState", "network.error", "admin.credentialRecovery", "update.state", "update.error", "led.order"];
  const numberPaths = ["uptimeMs", "freeHeapBytes", "firmware.flashBytes", "firmware.psramBytes", "firmware.expectedFlashBytes", "firmware.expectedPsramBytes", "settings.revision", "settings.savedRevision", "settings.activeLedCount", "settings.requestedLedCount", "settings.savedLedCount", "led.gpio", "led.maxCount", "led.budgetMa", "led.estimatedMa", "led.requestedMa", "led.scalePermille", "led.frames", "update.receivedBytes", "update.expectedBytes", "update.slotBytes"];
  const boolPaths = ["firmware.memoryMatches", "settings.dirty", "settings.restartRequired", "settings.savedRestartRequired", "led.ready", "led.limited", "led.pausedForUpdate", "network.connected", "network.apOpen", "network.wifiSaved", "admin.configured", "admin.claimAllowed", "update.busy", "restarting"];
  const get = path => path.split(".").reduce((value, key) => value?.[key], data);
  if (data?.schemaVersion !== 1 || stringPaths.some(p => typeof get(p) !== "string") || numberPaths.some(p => !Number.isSafeInteger(get(p))) || boolPaths.some(p => typeof get(p) !== "boolean") || !/^[a-f0-9]{16}$/i.test(data.bootId)) throw protocolError();
  return data;
}
export function checkPalettes(data) {
  if (!Array.isArray(data?.palettes) || data.palettes.length < 3 || data.palettes.length > 13) throw protocolError();
  const ids = new Set();
  for (const p of data.palettes) {
    if (!object(p) || typeof p.id !== "string" || (!idPattern.test(p.id) && !BUILTIN_IDS.includes(p.id)) || ids.has(p.id) || typeof p.name !== "string"
      || typeof p.builtin !== "boolean" || !Array.isArray(p.colors) || !integer(p.colors.length, 1, 8)
      || p.colors.some(c => typeof c !== "string" || !colorPattern.test(c))) throw protocolError();
    ids.add(p.id);
  }
  if (BUILTIN_IDS.some(id => !data.palettes.some(p => p.id === id && p.builtin))) throw protocolError();
  return data.palettes.filter(p => p.builtin);
}

export function createUiState() {
  return { device: null, draft: null, localEdits: false, ownedPreview: false, conflict: null, uncertain: null, online: false, phase: "loading", error: "" };
}
export function editDraft(state, next) {
  state.draft = normalizeConfig(next);
  state.localEdits = !sameConfig(state.draft, state.device.config);
}
// Preserve drafts across conflicting revisions, reconnects, and loss of unsaved RAM on boot.
export function adoptSnapshot(state, raw, { reason = "poll", force = false } = {}) {
  const next = checkSnapshot(raw);
  const previous = state.device;
  const bootChanged = previous && previous.bootId !== next.bootId;
  const changed = previous && (bootChanged || previous.revision !== next.revision);
  const protect = previous && (state.localEdits || state.conflict || state.uncertain || (previous.dirty && (bootChanged || state.ownedPreview)));
  const differs = state.draft && !sameConfig(state.draft, next.config);
  state.device = next;
  if (!force && protect && differs && (changed || reason !== "poll" || state.conflict || state.uncertain)) {
    state.conflict = { reason: bootChanged ? "boot" : reason, bootId: next.bootId, revision: next.revision };
    state.localEdits = true;
  } else if (force || !protect || !differs) {
    state.draft = clone(next.config); state.localEdits = false; state.conflict = null;
    if (force || !next.dirty || changed) state.ownedPreview = false;
  }
  state.online = true;
  state.uncertain = null;
  return { bootChanged: Boolean(bootChanged), changed: Boolean(changed) };
}
export function acceptPreview(state, sent, raw) {
  const next = checkSnapshot(raw);
  if (state.device.bootId !== next.bootId || !sameConfig(sent, next.config)) throw protocolError();
  state.device = next;
  state.ownedPreview = next.dirty;
  // A slider can move again while its earlier request is in flight.
  state.localEdits = !sameConfig(state.draft, next.config);
  if (!state.localEdits) state.draft = clone(next.config);
}
export function saveVerification(attempt, snapshot) {
  if (attempt.bootId !== snapshot.bootId) return "The device rebooted before Save could be verified. Saved boot settings are now shown; review before continuing.";
  if (!sameConfig(attempt.config, snapshot.config)) return "The live configuration changed. The attempted Save cannot be verified; review the current device settings.";
  if (snapshot.dirty) return "The device reports an unsaved preview. Save was not confirmed; use Save explicitly to try again.";
  if (attempt.wasDirty === false && snapshot.savedRevision === attempt.savedRevision) return "The device reports no unsaved lighting changes, but the lost response cannot prove that another write was committed. Review any boot recovery warning; explicit Save may be retried.";
  return "The device now reports these settings saved. The original Save response was lost; this is verified from current device state.";
}
export function savePresentation(state, { saving = false, sending = false, locked = false, recoverySaveNeeded = false } = {}) {
  if (saving) return ["Saving to device…", "Waiting for checked persistence; do not disconnect."];
  if (state.uncertain) return ["Outcome not confirmed", "Refresh device state before retrying. Your draft is retained."];
  if (!state.online) return ["Device unavailable", "Controls paused. Reconnect to the device network; your draft stays in this page."];
  if (state.conflict) return ["Draft needs a decision", "Choose your draft or the current device configuration above."];
  if (!state.device) return ["Connecting…", "Loading authoritative device settings."];
  if (locked) return ["Device operation in progress", "Lighting and saving are paused until the device is ready."];
  if (state.error) return ["Action needs attention", state.error];
  if (sending || state.localEdits) return ["Previewing · not saved", "Sending your complete draft to RAM. Save keeps it after a restart."];
  if (state.device.dirty) return ["Unsaved live preview", "These settings are in RAM only, including power and custom palettes."];
  if (recoverySaveNeeded) return ["Boot recovery · review and Save", "No unsaved content difference, but this boot used defaults/recovery. Explicit Save checks persistence."];
  return ["Saved on device", state.device.savedRestartRequired ? "Saved pixel count needs an explicit admin restart." : "Power, palette and lighting will return after a restart."];
}

// Raw File upload: no FormData, no base64, no JS-set Origin/Content-Length.
export function uploadFirmware(file, csrf, { xhrFactory = () => new XMLHttpRequest(), onProgress = () => {}, onUnauthorized = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    let xhr;
    try {
      const headers = uploadHeaders(csrf, file.size);
      xhr = xhrFactory(); xhr.open("POST", "/api/update", true);
      xhr.withCredentials = true; xhr.timeout = 185000;
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) onProgress(Math.min(100, Math.floor(event.loaded / event.total * 100)), event.loaded, event.total);
      };
      xhr.onload = () => {
        try {
          if (xhr.status === 401) onUnauthorized();
          const data = parseReply(xhr.status, xhr.responseText, xhr.getResponseHeader("Retry-After"), true);
          if (xhr.status !== 202 || data.state !== "restarting" || data.restarting !== true || data.receivedBytes !== file.size) throw new ApiError("protocol", "Upload response did not confirm finalization and a scheduled restart. Check device state.", { uncertain: true });
          resolve(data);
        } catch (error) { reject(error); }
      };
      xhr.onerror = xhr.ontimeout = xhr.onabort = () => reject(new ApiError("network", "Upload connection ended without confirmation. The image may or may not have been selected. Reconnect and inspect the device; do not assume a successful update.", { uncertain: true }));
      xhr.send(file);
    } catch (error) { reject(error); }
  });
}

if (typeof document !== "undefined") startApp();

function startApp() {
  const $ = id => document.getElementById(id);
  const state = createUiState();
  let status = null, auth = null, csrf = null, builtins = [], busyAction = "", uploading = false;
  let pollTimer, previewTimer, previewFlight = null, polling = false, lastPreview = -Infinity;
  let themeKey = "", customKey = "", sceneKey = "", editor = null, editorOriginal = "", confirmResolve = null, countEditing = false;
  let retryAt = 0, scanRequested = false, wifiAttempt = null, rebootWait = null, saveAttempt = null, persistenceConfirmed = false;
  const api = createApi({ getCsrf: () => csrf, onUnauthorized: expireSession });
  const node = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  function text(id, value) { if ($(id).textContent !== String(value)) $(id).textContent = value; }
  function notice(message) { text("notice", message); $("notice").hidden = !message; }
  function showError(error) {
    state.error = `${error.field ? error.field + ": " : ""}${error.message || String(error)}`;
    state.errorCode = error.code || "action";
    text("error", state.error); $("error").hidden = false;
    if (error.status === 429) {
      retryAt = Date.now() + Math.max(error.retryAfter || 2, 1) * 1000;
      text("error", `${state.error} Wait at least ${Math.ceil((retryAt - Date.now()) / 1000)} seconds before trying again.`);
      setTimeout(render, Math.min(retryAt - Date.now() + 50, 2147483647));
    }
    if (error.field) {
      const fields = { ledCount: "led-count", password: busyAction === "Wi-Fi" ? "wifi-password" : "password", ssid: "ssid" };
      if (fields[error.field]) fieldError(fields[error.field], state.error);
    }
  }
  function clearError() { state.error = ""; state.errorCode = ""; $("error").hidden = true; }
  function fieldError(id, message) {
    $(id).setAttribute("aria-invalid", message ? "true" : "false");
    text(`${id}-error`, message);
  }
  function expireSession() {
    csrf = null;
    if (auth) auth = { ...auth, authenticated: false, csrfToken: null };
    if (scanRequested) { scanRequested = false; text("scan-state", " Sign in again to scan."); }
  }
  function useSession(raw) {
    const next = checkSession(raw);
    if (auth?.authenticated && !next.authenticated) notice("Your admin session ended or another login replaced it. Lighting still works; sign in again for admin actions.");
    auth = { configured: next.configured, authenticated: next.authenticated, claimAllowed: next.claimAllowed, sessionLifetimeSeconds: next.sessionLifetimeSeconds };
    csrf = next.authenticated ? next.csrfToken : null;
  }
  const deviceBusy = () => uploading || Boolean(rebootWait) || Boolean(status?.update.busy || status?.restarting);
  const locked = () => !state.online || !state.device || Boolean(state.conflict || state.uncertain || busyAction) || deviceBusy();
  const allPalettes = () => [...builtins, ...(state.draft?.customPalettes || [])];
  const editorDirty = () => editor && JSON.stringify(editor) !== editorOriginal;
  const countDraftDirty = () => Boolean(state.draft && countEditing && $("led-count").value !== String(state.draft.ledCount));
  const recoverySaveNeeded = () => Boolean(status && status.settings.recovery !== "none" && !persistenceConfirmed);
  const hasUnsaved = () => Boolean(state.localEdits || state.device?.dirty || editorDirty() || countDraftDirty() || recoverySaveNeeded());
  function swatches(colors) {
    const group = node("span", undefined, "swatches");
    group.setAttribute("aria-label", colors.join(", "));
    colors.forEach(color => {
      const swatch = node("span", undefined, "swatch");
      swatch.style.setProperty("--swatch", color); swatch.title = color; swatch.setAttribute("aria-hidden", "true"); group.append(swatch);
    });
    return group;
  }
  function dataList(id, pairs) {
    $(id).replaceChildren(...pairs.map(([label, value]) => {
      const div = node("div"); div.append(node("dt", label), node("dd", value)); return div;
    }));
  }
  function renderThemes() {
    const palettes = allPalettes();
    const key = JSON.stringify(palettes);
    if (key !== themeKey) {
      themeKey = key;
      $("theme-options").replaceChildren(...palettes.map(p => {
        const label = node("label", undefined, "theme-choice");
        const input = node("input"); input.type = "radio"; input.name = "theme"; input.value = p.id;
        input.addEventListener("change", () => changeConfig({ paletteId: p.id }));
        const tile = node("span", undefined, "theme-tile");
        tile.append(node("span", p.name, "theme-name"), swatches(p.colors), node("small", p.builtin ? (p.id === "halloween" ? "GREEN & ORANGE · SEASONAL" : "RED, WHITE & GREEN · SEASONAL") : "YOUR CUSTOM COLORS"));
        label.append(input, tile); return label;
      }));
    }
    $("theme-fieldset").disabled = locked();
    document.querySelectorAll('input[name="theme"]').forEach(input => { input.checked = input.value === state.draft?.paletteId; });
    const listKey = JSON.stringify(state.draft?.customPalettes || []);
    if (listKey !== customKey) {
      customKey = listKey;
      const palettes = state.draft?.customPalettes || [];
      $("custom-palette-list").replaceChildren(...(palettes.length ? palettes.map(p => {
        const card = node("div", undefined, "custom-palette");
        const actions = node("div", undefined, "button-row");
        const edit = node("button", "Edit / rename", "secondary"); edit.dataset.lightControl = ""; edit.setAttribute("aria-label", `Edit or rename ${p.name}`); edit.addEventListener("click", () => openEditor(p.id));
        const remove = node("button", "Delete", "text-button"); remove.dataset.lightControl = ""; remove.setAttribute("aria-label", `Delete ${p.name}`); remove.addEventListener("click", () => removePalette(p.id));
        actions.append(edit, remove); card.append(node("strong", p.name), swatches(p.colors), actions); return card;
      }) : [node("p", "Your own colors belong here. Create a palette to get started.", "empty-state")]));
    }
    text("palette-count", `${state.draft?.customPalettes.length || 0} / 10`);
  }
  function render() {
    const config = state.draft;
    const block = locked();
    renderThemes();
    document.querySelectorAll("[data-light-control]").forEach(element => { element.disabled = block; });
    $("new-palette").disabled = block || (config?.customPalettes.length || 0) >= 10;
    document.querySelectorAll("[data-admin]").forEach(element => { element.disabled = block || !auth?.authenticated || Boolean(previewFlight) || Date.now() < retryAt; });
    $("scan").disabled ||= Boolean(scanRequested || status?.network.candidateState === "connecting");
    $("connect").disabled ||= status?.network.candidateState === "connecting";
    $("connection-dot").className = `status-dot ${state.online ? "online" : "offline"}`;
    text("connection-label", uploading ? "Uploading · polling paused" : rebootWait ? "Waiting for a verified boot…" : state.online ? `Device online${busyAction ? " · " + busyAction.toLowerCase() : ""}` : state.device ? "Connection lost · retrying" : "Connecting to Pixies…");
    $("refresh").disabled = uploading || polling || Boolean(previewFlight) || Boolean(busyAction);
    if (config) {
      $("on").checked = config.on; text("power-label", config.on ? "Lights on" : "Lights off");
      for (const id of ["brightness", "speed", "intensity", "density"]) {
        $(id).value = config[id]; text(`${id}-value`, `${config[id]}%`);
      }
      $("effect").value = config.effect;
      const usage = effectUsage(config.effect);
      for (const key of Object.keys(usage)) $(key).disabled = block || !usage[key];
      text("effect-usage", config.effect === "steady" ? "Steady uses brightness only; the movement controls are inactive." : config.effect === "breathe" ? "Breathe uses speed; intensity and density are inactive." : "Speed, intensity and density all shape this effect.");
      if (!countEditing) $("led-count").value = config.ledCount;
      text("scene-palette", allPalettes().find(p => p.id === config.paletteId)?.name || config.paletteId);
      text("scene-effect", `${config.effect[0].toUpperCase() + config.effect.slice(1)} · ${state.localEdits ? "draft pending" : "device preview"}`);
      text("scene-brightness", `${config.brightness}%`);
      $("light-scene").classList.toggle("scene-off", !config.on);
      const colors = allPalettes().find(p => p.id === config.paletteId)?.colors || [];
      const key = JSON.stringify(colors);
      if (key !== sceneKey) {
        sceneKey = key;
        $("light-string").replaceChildren(...Array.from({ length: colors.length ? 18 : 0 }, (_, i) => {
          const bulb = node("i", undefined, "pixie"); bulb.style.setProperty("--bulb", colors[i % colors.length]); return bulb;
        }));
      }
    }
    if (state.device) {
      text("active-count", state.device.activeLedCount);
      text("requested-count", `${state.device.requestedLedCount}${state.localEdits && config.ledCount !== state.device.requestedLedCount ? ` (draft ${config.ledCount})` : ""}`);
      text("saved-count", state.device.savedLedCount);
      text("restart-state", state.device.savedRestartRequired
        ? `Restart pending: the next boot uses ${state.device.savedLedCount} saved pixels, not necessarily the ${state.device.requestedLedCount} requested in RAM.`
        : state.device.restartRequired ? "Requested count differs from the active string. Save first, then explicitly restart to apply it." : "The saved count matches the active driver. Restart is not needed for other lighting changes.");
    }
    $("conflict").hidden = !state.conflict;
    if (state.conflict) {
      text("conflict-detail", state.conflict.reason === "boot" ? "The device restarted. Your unsaved draft was retained here; it has not been replayed." : "Another controller, a lost response or a reconnection changed what we can safely assume. Your draft has not overwritten the device.");
      text("conflict-comparison", `Device: ${state.device.config.effect}, ${state.device.config.brightness}%, ${state.device.config.ledCount} pixels, ${state.device.config.customPalettes.length} custom palettes (revision ${state.device.revision}). Your draft: ${config.effect}, ${config.brightness}%, ${config.ledCount} pixels, ${config.customPalettes.length} custom palettes.`);
    }
    $("keep-draft").disabled = !state.online || Boolean(busyAction) || deviceBusy();
    $("use-device").disabled = !state.online || Boolean(busyAction) || deviceBusy();
    const [saveTitle, saveDetail] = savePresentation(state, { saving: busyAction === "Saving", sending: Boolean(previewFlight), locked: Boolean(busyAction) || deviceBusy(), recoverySaveNeeded: recoverySaveNeeded() });
    text("save-state", !block && countDraftDirty() ? "Pixel count not in preview" : saveTitle);
    text("save-detail", !block && countDraftDirty() ? "Use Set preview count before Save, or restore the field to its requested value." : saveDetail);
    $("save").disabled = block || !hasUnsaved() || Date.now() < retryAt;
    $("discard").disabled = !(state.localEdits || countDraftDirty()) || Boolean(busyAction) || Boolean(previewFlight) || deviceBusy();
    $("resume-current").hidden = !rebootWait?.expired || !state.online || Boolean(status?.update.busy || status?.restarting);
    renderAuth();
    if (status) renderStatus();
    $("apply-palette").disabled = block;
    $("add-color").disabled = block || (editor?.colors.length || 0) >= 8;
  }
  function renderAuth() {
    const authenticated = Boolean(auth?.authenticated);
    $("auth-form").hidden = authenticated;
    $("logout").hidden = !authenticated; $("logout").disabled = locked() || Boolean(previewFlight);
    const claiming = auth && !auth.configured;
    $("claim-help").hidden = !claiming;
    $("confirm-password-row").hidden = !claiming;
    $("password").autocomplete = claiming ? "new-password" : "current-password";
    text("password-label", claiming ? "Create an admin password (12–64 bytes)" : "Admin password");
    text("authenticate", Date.now() < retryAt ? "Please wait before retrying" : claiming ? "Create admin password" : "Sign in");
    const authBlocked = !state.online || !auth || Boolean(busyAction) || deviceBusy() || Date.now() < retryAt || (claiming && !auth.claimAllowed);
    $("authenticate").disabled = authBlocked;
    $("password").disabled = authBlocked; $("confirm-password").disabled = authBlocked;
    text("auth-state", !auth ? "Checking admin session…" : authenticated ? "Admin signed in · token held only in this page's memory" : claiming ? auth.claimAllowed ? "First-time setup · claim available on this protected hotspot" : "Initial setup is only allowed from the protected Pixies hotspot. Join it first." : "Admin locked · sign in for device settings");
    $("stay-ap").hidden = !authenticated || !status?.network.apOpen;
  }
  function renderStatus() {
    const { network: net, firmware: fw, led, update } = status;
    text("network-badge", net.state.replaceAll("_", " "));
    dataList("network-details", [["Connection", net.state.replaceAll("_", " ")], ["Home network", net.connected ? net.ssid : "Not connected"], ["Home IP", net.ip || "Not assigned"], ["Protected hotspot", net.apOpen ? net.apSsid : "Closed"], ["Hotspot IP", net.apOpen ? net.apIp : "—"], ["Saved Wi-Fi", net.wifiSaved ? "Yes" : "No"], ["Candidate test", net.candidateState]]);
    text("network-error", net.error ? `Device network error: ${net.error.replaceAll("_", " ")}. Previous working credentials are retained when a candidate fails.` : "");
    const validHost = /^pixies-[a-f0-9]{12}\.local$/.test(net.hostname);
    $("device-link").hidden = !validHost;
    if (validHost) { $("device-link").href = `http://${net.hostname}/`; text("device-link", `Open ${net.hostname}`); }
    text("firmware-version", `v${fw.version} · ${fw.target}`);
    text("firmware-help", `App image: 288–${update.slotBytes.toLocaleString("en-US")} bytes. Firmware performs target, length and integrity checks.`);
    text("power-status", led.pausedForUpdate ? "LED output paused for firmware update; current figures may be stale."
      : !led.ready ? "LED driver is not ready. Check the device before expecting light output."
      : `${led.limited ? "Current limiting active · " : ""}${(led.estimatedMa / 1000).toFixed(2)} A estimated / ${(led.budgetMa / 1000).toFixed(1)} A budget · requested ${(led.requestedMa / 1000).toFixed(2)} A · limiter ${(led.scalePermille / 10).toFixed(1)}%`);
    $("power-status").classList.toggle("limited", led.limited);
    dataList("hardware-details", [["Output", `5 V ${led.protocol ?? "Protocol unknown"} · ${led.order} · GPIO${led.gpio}`], ["Firmware pixel limit", led.maxCount], ["Estimated LED budget", `${led.budgetMa.toLocaleString("en-US")} mA`]]);
    dataList("device-details", [["Firmware target", fw.target], ["Uptime", formatUptime(status.uptimeMs)], ["Boot ID", status.bootId], ["Revisions (live / saved)", `${state.device?.revision ?? status.settings.revision} / ${state.device?.savedRevision ?? status.settings.savedRevision}`], ["Flash", `${fw.flashBytes.toLocaleString("en-US")} bytes`], ["PSRAM", `${fw.psramBytes.toLocaleString("en-US")} bytes`], ["Memory matches target", fw.memoryMatches ? "Yes" : "NO · verify hardware"], ["Free heap", `${status.freeHeapBytes.toLocaleString("en-US")} bytes`], ["Rendered frames", led.frames]]);
    const reasons = [];
    if (status.settings.recovery !== "none") reasons.push(`Settings recovery: ${status.settings.recovery}. Defaults may have been used; Save is explicit.`);
    if (status.admin.credentialRecovery !== "none") reasons.push(`Credential recovery: ${status.admin.credentialRecovery}. Check device storage and provisioning.`);
    if (!fw.memoryMatches) reasons.push("Detected flash/PSRAM differs from the expected hardware. Verify the carrier and module.");
    text("recovery-state", reasons.join(" ")); $("recovery-state").hidden = !reasons.length;
    text("device-update-state", `Device update state: ${update.state}${update.error ? " · " + update.error : ""}${status.restarting ? " · restart scheduled" : ""}`);
  }
  function formatUptime(ms) {
    const minutes = Math.floor(ms / 60000);
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m ${Math.floor(ms / 1000) % 60}s`;
  }
  function changeConfig(patch) {
    if (locked()) return;
    try {
      editDraft(state, { ...state.draft, ...patch }); clearError(); render(); schedulePreview();
    } catch (error) { showError(error); render(); }
  }
  function schedulePreview() {
    clearTimeout(previewTimer);
    if (!state.localEdits || locked() || previewFlight || state.error || Date.now() < retryAt) return;
    previewTimer = setTimeout(() => flushPreview().catch(() => {}), previewDelay(performance.now(), lastPreview));
  }
  async function handleMutationFailure(error, kind, attempted) {
    if (error.status === 401) expireSession();
    if (error.status === 403 && error.code === "csrf") expireSession();
    if (error.uncertain || error.code === "revision_conflict" || error.code === "protocol") {
      state.uncertain = { kind, config: clone(attempted || state.draft), bootId: state.device.bootId };
      if (kind === "save") saveAttempt = clone(state.uncertain);
      if (error.code === "network") state.online = false;
    }
    showError(error); render();
    // Reconciliation is read-only. A rejected/ambiguous mutation is never blindly repeated.
    if (state.uncertain) schedulePoll(200);
  }
  async function flushPreview({ forSave = false } = {}) {
    clearTimeout(previewTimer);
    if (previewFlight) await previewFlight;
    if (!state.localEdits) return;
    while (polling) await new Promise(resolve => setTimeout(resolve, 50));
    if (!state.online || state.conflict || state.uncertain || deviceBusy() || (busyAction && !forSave)) throw new ApiError("paused", "Preview is paused. Resolve the device state first.");
    const wait = PREVIEW_INTERVAL_MS - (performance.now() - lastPreview);
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
    // Recheck after waiting: a poll could have detected a reboot or remote edit.
    if (!state.online || state.conflict || state.uncertain || deviceBusy()) throw new ApiError("paused", "Device state changed before preview; resolve it first.");
    const sent = normalizeConfig(state.draft), baseRevision = state.device.revision;
    lastPreview = performance.now();
    previewFlight = (async () => {
      try {
        const response = await api("/api/config", { method: "PUT", body: { baseRevision, config: sent } });
        acceptPreview(state, sent, response); clearError();
      } catch (error) { await handleMutationFailure(error, "preview", sent); throw error; }
    })();
    render();
    try { await previewFlight; } finally {
      previewFlight = null; render();
      if (!forSave) schedulePreview();
    }
    if (forSave && state.localEdits) await flushPreview({ forSave: true });
  }
  async function saveNow() {
    if (countDraftDirty()) throw new ApiError("validation", "Set the preview count first, or restore the count field to its requested value. No Save was sent.", { field: "ledCount", status: 422 });
    if (editorDirty()) throw new ApiError("validation", "Use the palette in live preview, or close the editor, before saving.", { status: 422 });
    await flushPreview({ forSave: true });
    if (state.conflict || state.uncertain || !state.online) throw new ApiError("paused", "Resolve the device state before saving.");
    const attempt = { bootId: state.device.bootId, config: clone(state.draft), wasDirty: state.device.dirty, savedRevision: state.device.savedRevision };
    try {
      const response = checkSnapshot(await api("/api/save", { method: "POST", body: { baseRevision: state.device.revision } }));
      if (response.bootId !== attempt.bootId || !sameConfig(response.config, attempt.config) || response.dirty || response.savedRevision !== response.revision) throw new ApiError("protocol", "Save response did not confirm these settings persisted. Refresh before retrying.", { uncertain: true });
      adoptSnapshot(state, response, { force: true }); persistenceConfirmed = true; clearError();
      notice(response.savedRestartRequired ? "Saved to device. The saved pixel count will apply only after an explicit admin restart." : "Saved to device. These exact settings, including power, return after a restart.");
      return true;
    } catch (error) {
      await handleMutationFailure(error, "save", attempt.config);
      if (saveAttempt) Object.assign(saveAttempt, { wasDirty: attempt.wasDirty, savedRevision: attempt.savedRevision });
      throw error;
    }
  }
  async function runBusy(label, work) {
    if (busyAction || uploading) return;
    busyAction = label; clearTimeout(previewTimer); clearError(); render();
    try {
      // Finish any read-only refresh before starting a mutation, especially the single-connection OTA.
      while (polling || previewFlight) {
        if (previewFlight) await previewFlight; else await new Promise(resolve => setTimeout(resolve, 50));
      }
      return await work();
    }
    catch (error) { showError(error); }
    finally { busyAction = ""; render(); schedulePreview(); schedulePoll(500); }
  }
  function schedulePoll(delay = 4000) {
    clearTimeout(pollTimer);
    if (!uploading) pollTimer = setTimeout(poll, delay);
  }
  async function synchronize(reason = "reconnect", force = false) {
    const rawStatus = checkStatus(await api("/api/status"));
    const snapshot = checkSnapshot(await api("/api/config"));
    // A boot between these two requests must not join unrelated snapshots.
    const latestStatus = rawStatus.bootId === snapshot.bootId ? rawStatus : checkStatus(await api("/api/status"));
    if (latestStatus.bootId !== snapshot.bootId) throw protocolError();
    const session = await api("/api/auth/session");
    if (!builtins.length) builtins = checkPalettes(await api("/api/palettes"));
    const attempt = saveAttempt;
    const result = adoptSnapshot(state, snapshot, { reason, force });
    if (force) countEditing = false;
    if (result.bootChanged) persistenceConfirmed = false;
    status = latestStatus; useSession(session); state.phase = "ready";
    if (attempt) {
      notice(saveVerification(attempt, snapshot));
      if (attempt.bootId === snapshot.bootId && sameConfig(attempt.config, snapshot.config) && !snapshot.dirty
        && (attempt.wasDirty || attempt.savedRevision !== snapshot.savedRevision)) persistenceConfirmed = true;
      saveAttempt = null;
    }
    else if (result.bootChanged && !rebootWait) notice("Device boot ID changed. Saved settings were restored; any retained local draft needs your decision.");
    return result;
  }
  async function poll() {
    if (polling || uploading || busyAction || previewFlight) { schedulePoll(700); return; }
    polling = true; render();
    const recoveringSave = Boolean(saveAttempt);
    try {
      const wasOnline = state.online;
      if (!state.device || !wasOnline || state.uncertain) await synchronize(wasOnline ? "verify" : "reconnect");
      else {
        const next = checkStatus(await api("/api/status"));
        const needsSnapshot = next.bootId !== state.device.bootId || next.settings.revision !== state.device.revision || next.settings.savedRevision !== state.device.savedRevision || next.settings.dirty !== state.device.dirty;
        if (needsSnapshot) await synchronize(next.bootId !== state.device.bootId ? "boot" : "conflict", Boolean(rebootWait && next.bootId !== rebootWait.bootId));
        else { status = next; useSession(await api("/api/auth/session")); }
      }
      state.online = true;
      if (state.errorCode === "network") {
        clearError();
        if (!rebootWait && !state.conflict && !recoveringSave) notice("Reconnected. Live settings and admin session were read from the device; no failed operation was automatically repeated.");
      }
      if (rebootWait) verifyBoot();
      if (scanRequested && auth?.authenticated && !deviceBusy()) await pollScan();
      if (wifiAttempt) checkWifiAttempt();
    } catch (error) {
      state.online = false;
      if (error.code !== "network" || !rebootWait) showError(error);
    } finally {
      polling = false; render();
      if (rebootWait && Date.now() > rebootWait.deadline && !rebootWait.expired) {
        rebootWait.expired = true;
        const message = "Timed out waiting for a new boot ID. Restart/update is NOT verified. Check the device network, USB serial and recovery; this page will keep checking without resending anything.";
        text("update-detail", message); showError(new Error(message)); render();
      }
      schedulePoll(rebootWait || scanRequested || wifiAttempt ? 2000 : 4000);
    }
  }
  function verifyBoot() {
    if (!status || !state.device || state.device.bootId !== status.bootId) return;
    if (status.bootId === rebootWait.bootId) {
      if (!rebootWait.accepted && !status.update.busy && !status.restarting
        && (status.update.state === "failed" || Date.now() - rebootWait.started > 8000)) {
        rebootWait = null; state.phase = "ready";
        notice("The device still reports its original boot with no operation in progress. Restart/update is NOT confirmed. The current device state is available; review it before retrying.");
        text("update-detail", "Operation not confirmed. Current boot and device state reloaded; no request was replayed.");
      }
      return;
    }
    const previous = rebootWait;
    if (status.firmware.target !== previous.target) {
      showError(new Error("A new boot reports an unexpected firmware target. Update is not verified; inspect via USB.")); return;
    }
    rebootWait = null; state.phase = "ready";
    adoptSnapshot(state, state.device, { force: true }); clearError();
    const sameVersion = previous.version === status.firmware.version;
    const message = previous.kind === "update"
      ? `New boot confirmed: firmware v${status.firmware.version} (previously v${previous.version}).${sameVersion ? " Version is unchanged; the API has no image hash, so confirm this is the intended build." : " The running version changed."} Reload the embedded website to load its matching interface.`
      : `New device boot confirmed. Firmware v${status.firmware.version}; current boot settings have been loaded from the device.${previous.kind === "factory-reset" ? " Review defaults and set up admin again on the protected hotspot." : ""}`;
    notice(message); text("update-detail", message);
    $("reload-ui").hidden = previous.kind !== "update";
  }
  function beginBootWait(kind, baseline, accepted = true) {
    rebootWait = { kind, accepted, started: Date.now(), bootId: baseline.bootId, target: baseline.firmware.target, version: baseline.firmware.version, deadline: Date.now() + (kind === "update" ? 120000 : 75000), expired: false };
    state.phase = "reconnecting"; expireSession();
    text("update-detail", accepted ? "Device accepted the operation; restart scheduled. Waiting for a new boot ID and running version, not just a successful transfer." : "Response lost. Reconnecting to check for a new boot; the operation is not confirmed.");
    schedulePoll(1800);
  }
  // Refresh is always read-only and never silently drops or replays a local draft.
  $("refresh").addEventListener("click", () => poll());
  $("save").addEventListener("click", () => runBusy("Saving", saveNow));
  $("discard").addEventListener("click", async () => {
    if (await ask("Discard this page's draft?", "Only changes not yet acknowledged by the device will be discarded. This does not revert an unsaved preview already on the device.", "Discard local draft") !== "proceed") return;
    clearTimeout(previewTimer); countEditing = false; adoptSnapshot(state, state.device, { force: true }); clearError(); render();
  });
  $("keep-draft").addEventListener("click", async () => {
    if (await ask("Replace the current live configuration?", "Your complete retained draft replaces the latest device preview, including its custom palettes. A further concurrent edit will be rejected instead of overwritten.", "Apply my draft") !== "proceed") return;
    await runBusy("Resolving draft", async () => {
      // Refresh one last time; the user's explicit decision, not a blind retry, permits the new PUT.
      await synchronize("conflict");
      state.conflict = null; state.uncertain = null; state.localEdits = !sameConfig(state.draft, state.device.config);
      await flushPreview({ forSave: true }); notice("Your retained draft is now the device's live preview. Save explicitly to persist it.");
    });
  });
  $("use-device").addEventListener("click", async () => {
    if (await ask("Use device settings?", "This discards the retained draft in this page. Current device preview settings are loaded, not necessarily the saved settings.", "Use device settings") !== "proceed") return;
    await runBusy("Loading device", async () => { await synchronize("reconnect", true); clearError(); notice("Current device settings loaded. No mutation or Save was sent."); });
  });
  $("on").addEventListener("change", () => changeConfig({ on: $("on").checked }));
  for (const id of ["brightness", "speed", "intensity", "density"]) $(id).addEventListener("input", () => changeConfig({ [id]: Number($(id).value) }));
  $("effect").addEventListener("change", () => changeConfig({ effect: $("effect").value }));
  $("count-form").addEventListener("submit", event => {
    event.preventDefault();
    const raw = $("led-count").value;
    const value = Number(raw);
    const message = !/^\d+$/.test(raw) || !integer(value, 1, 1000) ? "Use a whole pixel count from 1 to 1,000." : "";
    fieldError("led-count", message);
    if (!message) { countEditing = false; changeConfig({ ledCount: value }); }
  });
  $("led-count").addEventListener("input", () => {
    countEditing = true;
    fieldError("led-count", "");
    // Do not rerender an unfinished number field; only update the save affordance.
    $("save").disabled = locked() || !hasUnsaved();
  });
  $("stay-ap").addEventListener("click", () => {
    notice("AP-only use needs no router configuration. Stay connected to the protected Pixies hotspot and use the lighting controls.");
    $("lighting-title").scrollIntoView({ behavior: "smooth", block: "start" });
  });
  $("auth-form").addEventListener("submit", event => {
    event.preventDefault();
    const claiming = !auth?.configured;
    const password = $("password").value;
    const message = validatePassword(password);
    fieldError("password", message);
    const mismatch = claiming && password !== $("confirm-password").value ? "The passwords do not match." : "";
    fieldError("confirm-password", mismatch);
    if (message || mismatch) return;
    // Clear credential controls immediately; no credential is retained in app state.
    $("password").value = ""; $("confirm-password").value = "";
    runBusy("Signing in", async () => {
      try {
        useSession(await api(claiming ? "/api/auth/claim" : "/api/auth/login", { method: "POST", body: { password } }));
        if (!auth.authenticated) throw protocolError();
        notice(claiming ? "Admin created on this protected hotspot. You may now scan/connect to Wi-Fi, or stay AP-only." : "Admin signed in. This device-wide session expires after 30 minutes.");
      } catch (error) {
        // A lost claim response can mean the credential was created. Read session before suggesting a second claim.
        if (error.uncertain) {
          try { useSession(await api("/api/auth/session")); } catch { /* show original failure, never invent auth */ }
        }
        throw error;
      }
    });
  });
  $("logout").addEventListener("click", () => runBusy("Signing out", async () => {
    try { useSession(await api("/api/auth/logout", { method: "POST", body: {}, admin: true })); notice("Signed out of admin. Trusted-network lighting controls remain available."); }
    finally { expireSession(); }
  }));
  $("scan").addEventListener("click", () => runBusy("Scanning Wi-Fi", async () => {
    const reply = await api("/api/wifi/scan", { method: "POST", body: {}, admin: true, expected: 202 });
    if (reply.state !== "running") throw protocolError();
    scanRequested = true; $("scan-results").replaceChildren(); text("scan-state", " Scanning…");
  }));
  async function pollScan() {
    const result = await api("/api/wifi/scan", { admin: true });
    if (!["idle", "running", "complete", "failed"].includes(result.state) || !Array.isArray(result.networks) || result.networks.length > 20 || typeof result.truncated !== "boolean") throw protocolError();
    if (result.state === "running") return;
    scanRequested = false;
    text("scan-state", result.state === "failed" ? " Scan failed; try again or enter the SSID." : result.state === "idle" ? " Scan idle; try again." : ` ${result.networks.length} found${result.truncated ? " · truncated to 20" : ""}`);
    $("scan-results").replaceChildren(...result.networks.map(net => {
      if (typeof net.ssid !== "string" || !Number.isInteger(net.rssi) || !Number.isInteger(net.channel) || typeof net.open !== "boolean") throw protocolError();
      const button = node("button", undefined, "scan-network"); button.dataset.admin = ""; button.type = "button";
      button.append(node("span", net.ssid || "(hidden network · enter its name)"), node("small", `${net.open ? "Open" : "Protected"} · ${net.rssi} dBm`));
      button.addEventListener("click", () => {
        $("ssid").value = net.ssid; $("wifi-password").value = "";
        notice(net.open ? "This network is open: leave its password empty. Traffic will not be private." : "Network selected. Enter its Wi-Fi password to test it.");
        (net.open ? $("ssid") : $("wifi-password")).focus();
      });
      return button;
    }));
  }
  $("wifi-form").addEventListener("submit", event => {
    event.preventDefault();
    const ssid = $("ssid").value, password = $("wifi-password").value;
    const errors = validateWifi(ssid, password);
    fieldError("ssid", errors.ssid || ""); fieldError("wifi-password", errors.password || "");
    if (Object.keys(errors).length) return;
    $("wifi-password").value = "";
    runBusy("Wi-Fi", async () => {
      const result = await api("/api/wifi/connect", { method: "POST", body: { ssid, password }, admin: true, expected: 202 });
      if (result.state !== "connecting") throw protocolError();
      wifiAttempt = { started: Date.now(), ssid };
      notice("Connection test accepted, not yet saved. Keep the page open; the hotspot may close. Join the home network and reopen the device's .local name or USB-reported IP if needed.");
    });
  });
  function checkWifiAttempt() {
    const net = status.network;
    if (net.candidateState === "succeeded" && net.connected && net.wifiSaved && net.ssid === wifiAttempt.ssid) {
      notice("Device reports the candidate home network connected and saved. Rejoin that network if the setup hotspot closes."); wifiAttempt = null;
    } else if (net.candidateState === "failed") {
      showError(new Error(`Device rejected the candidate network (${net.error || "connection failed"}). Previous working credentials were retained.`)); wifiAttempt = null;
    } else if (Date.now() - wifiAttempt.started > 60000) {
      notice("Wi-Fi test is not confirmed. Inspect the device network status; reconnect through the protected hotspot or the home network. No success has been assumed."); wifiAttempt = null;
    }
  }
  async function unsavedDecision(title, detail) {
    const choice = await ask(title, detail + (hasUnsaved() ? " You have unsaved lighting/palette changes. Save before continuing, or explicitly continue without saving; the next boot restores only saved settings." : ""), hasUnsaved() ? "Continue without saving" : "Continue", hasUnsaved());
    if (choice === "cancel") return false;
    if (editorDirty()) {
      notice("Close the palette editor first: use its live-preview button to keep edits, or Cancel to discard them."); return false;
    }
    if (choice === "proceed" && countDraftDirty()) { countEditing = false; $("led-count").value = state.draft.ledCount; }
    if (choice === "save") await saveNow();
    return true;
  }
  $("restart").addEventListener("click", () => runBusy("Restarting", async () => {
    if (!await unsavedDecision("Restart Pixies?", "The driver will initialize with the saved pixel count and all saved lighting settings.")) return;
    const baseline = clone(status);
    try {
      const reply = await api("/api/restart", { method: "POST", body: { confirm: "restart" }, admin: true, expected: 202 });
      if (reply.restarting !== true) throw new ApiError("protocol", "Restart response was incomplete.", { uncertain: true });
      beginBootWait("restart", baseline);
    } catch (error) { if (error.uncertain) beginBootWait("restart", baseline, false); throw error; }
  }));
  $("wifi-reset").addEventListener("click", () => runBusy("Resetting Wi-Fi", async () => {
    if (await ask("Reset saved Wi-Fi?", "This erases home-network credentials and opens the protected setup hotspot. Admin and lighting are preserved. You may need to switch Wi-Fi networks to reconnect.", "Reset Wi-Fi") !== "proceed") return;
    const reply = await api("/api/wifi/reset", { method: "POST", body: { confirm: "wifi-reset" }, admin: true });
    if (reply.state !== "setup_ap" || typeof reply.apIp !== "string") throw protocolError();
    notice(`Device reports Wi-Fi reset. Reconnect to the protected Pixies hotspot at ${reply.apIp}; admin and lighting were preserved.`);
    scanRequested = false; wifiAttempt = null; $("scan-results").replaceChildren();
  }));
  $("factory-reset").addEventListener("click", () => runBusy("Factory reset", async () => {
    if (await ask("Erase this device and start over?", "Factory reset erases saved lighting, all palettes, Wi-Fi and the admin credential. Unsaved preview is lost. After restart reconnect to the protected hotspot and create a new admin password. This cannot be undone.", "Erase & restart") !== "proceed") return;
    const baseline = clone(status);
    try {
      const reply = await api("/api/factory-reset", { method: "POST", body: { confirm: "factory-reset" }, admin: true, expected: 202 });
      if (reply.restarting !== true) throw new ApiError("protocol", "Factory reset response was incomplete.", { uncertain: true });
      beginBootWait("factory-reset", baseline);
    } catch (error) { if (error.uncertain) beginBootWait("factory-reset", baseline, false); throw error; }
  }));
  $("firmware").addEventListener("change", () => {
    const file = $("firmware").files[0];
    fieldError("firmware", file ? validateFirmware(file, status?.update.slotBytes) : "");
    text("file-detail", file ? `${file.name} · ${file.size.toLocaleString("en-US")} bytes` : "");
  });
  $("update-form").addEventListener("submit", event => {
    event.preventDefault();
    const file = $("firmware").files[0];
    const message = validateFirmware(file, status?.update.slotBytes); fieldError("firmware", message);
    if (message) return;
    runBusy("Updating firmware", async () => {
      if (!await unsavedDecision("Upload application firmware?", "LED output pauses while the image is written. Only upload a trusted app-only ESP32-S3 N16R8 image. Keep power stable and this page open.")) return;
      if (polling) throw new ApiError("busy", "A status refresh is finishing. Try Upload again in a moment.");
      const baseline = clone(status);
      // The firmware HTTP receiver has one connection. Suspend every poll for the entire XHR.
      clearTimeout(pollTimer); clearTimeout(previewTimer); uploading = true;
      $("update-progress-row").hidden = false; $("upload-progress").value = 0;
      text("update-detail", "Uploading raw application image. Browser byte progress is not device validation or a successful boot.");
      render();
      try {
        await uploadFirmware(file, csrf, { onUnauthorized: expireSession, onProgress: (percent, loaded, total) => {
          $("upload-progress").value = percent;
          text("update-detail", percent === 100 ? "All bytes sent. Waiting for device validation and boot-partition selection…" : `${percent}% sent · ${loaded.toLocaleString("en-US")} / ${total.toLocaleString("en-US")} bytes`);
        } });
        $("upload-progress").value = 100;
        beginBootWait("update", baseline);
      } catch (error) {
        text("update-detail", `Update NOT confirmed: ${error.message}`);
        if (error.uncertain) beginBootWait("update", baseline, false);
        throw error;
      } finally {
        uploading = false; $("firmware").value = ""; text("file-detail", ""); schedulePoll(1500);
      }
    });
  });
  $("reload-ui").addEventListener("click", () => location.reload());
  $("resume-current").addEventListener("click", () => runBusy("Checking current device", async () => {
    if (await ask("Resume without a verified new boot?", "The requested operation is still unverified. Read current status and settings and resume only if no upload or restart is in progress. This does not retry the operation.", "Read & resume") !== "proceed") return;
    await synchronize("verify");
    if (status.update.busy || status.restarting) throw new ApiError("busy", "The device still reports an operation in progress.");
    rebootWait = null; state.phase = "ready";
    notice("Current device state loaded. The previous operation remains unverified; no request was retried.");
  }));
  window.addEventListener("beforeunload", event => {
    if (uploading || hasUnsaved() || state.uncertain) { event.preventDefault(); event.returnValue = ""; }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !uploading) schedulePoll(100);
  });
  function ask(title, detail, proceedLabel, offerSave = false) {
    if (confirmResolve) return Promise.resolve("cancel");
    text("confirm-title", title); text("confirm-detail", detail); text("confirm-proceed", proceedLabel);
    $("confirm-save").hidden = !offerSave;
    $("confirm-dialog").showModal();
    return new Promise(resolve => { confirmResolve = resolve; });
  }
  function closeConfirm(choice) {
    $("confirm-dialog").close();
    const resolve = confirmResolve; confirmResolve = null; resolve?.(choice);
  }
  $("confirm-cancel").addEventListener("click", () => closeConfirm("cancel"));
  $("confirm-proceed").addEventListener("click", () => closeConfirm("proceed"));
  $("confirm-save").addEventListener("click", () => closeConfirm("save"));
  $("confirm-dialog").addEventListener("cancel", event => { event.preventDefault(); closeConfirm("cancel"); });
  $("new-palette").addEventListener("click", () => openEditor());
  function openEditor(id) {
    if (locked()) return;
    const existing = state.draft.customPalettes.find(p => p.id === id);
    editor = existing ? clone(existing) : { id: nextPaletteId(state.draft.customPalettes), name: "", colors: ["#FF8000", "#00AA00"] };
    editorOriginal = JSON.stringify(editor);
    $("palette-name").value = editor.name; fieldError("palette-name", ""); text("palette-colors-error", "");
    text("palette-dialog-title", existing ? "Edit your palette" : "Create a palette");
    renderEditor(); $("palette-dialog").showModal(); $("palette-name").focus();
  }
  function renderEditor() {
    text("color-count", `${editor.colors.length} / 8`);
    $("palette-colors").replaceChildren(...editor.colors.map((color, index) => {
      const row = node("div", undefined, "color-row");
      const picker = node("input"); picker.type = "color"; picker.value = colorPattern.test(color) ? color : "#000000"; picker.setAttribute("aria-label", `Pick color ${index + 1}`);
      const hex = node("input"); hex.type = "text"; hex.value = color; hex.maxLength = 7; hex.spellcheck = false; hex.setAttribute("aria-label", `Color ${index + 1} hex RGB`); hex.setAttribute("aria-describedby", "palette-colors-error");
      const remove = node("button", "×", "icon-button"); remove.type = "button"; remove.setAttribute("aria-label", `Remove color ${index + 1}`); remove.disabled = editor.colors.length <= 1;
      picker.addEventListener("input", () => { editor.colors[index] = picker.value.toUpperCase(); hex.value = editor.colors[index]; hex.setAttribute("aria-invalid", "false"); });
      hex.addEventListener("input", () => { editor.colors[index] = hex.value.toUpperCase(); hex.setAttribute("aria-invalid", colorPattern.test(hex.value) ? "false" : "true"); if (colorPattern.test(hex.value)) picker.value = hex.value; });
      remove.addEventListener("click", () => { editor.colors.splice(index, 1); renderEditor(); $("add-color").focus(); });
      row.append(picker, hex, remove); return row;
    }));
    $("add-color").disabled = editor.colors.length >= 8 || locked();
  }
  $("palette-name").addEventListener("input", () => { if (editor) editor.name = $("palette-name").value; });
  $("add-color").addEventListener("click", () => {
    if (!editor || editor.colors.length >= 8) return;
    editor.colors.push("#FFFFFF"); renderEditor();
    $("palette-colors").lastElementChild.querySelector('input[type="text"]').focus();
  });
  async function closeEditor() {
    if (editorDirty() && await ask("Discard palette edits?", "These palette-editor changes have not been added to the live preview.", "Discard palette edits") !== "proceed") return;
    $("palette-dialog").close(); editor = null;
  }
  $("cancel-palette").addEventListener("click", closeEditor);
  $("cancel-palette-bottom").addEventListener("click", closeEditor);
  $("palette-dialog").addEventListener("cancel", event => { event.preventDefault(); closeEditor(); });
  $("palette-form").addEventListener("submit", event => {
    event.preventDefault();
    if (!editor || locked()) return;
    editor.name = $("palette-name").value;
    const nameError = !/^[\x20-\x7e]{1,32}$/.test(editor.name) ? "Use 1–32 printable ASCII characters." : "";
    fieldError("palette-name", nameError);
    const colorError = !integer(editor.colors.length, 1, 8) || editor.colors.some(c => !colorPattern.test(c)) ? "Use 1–8 colors in #RRGGBB format. Fix the highlighted RGB values." : "";
    text("palette-colors-error", colorError);
    if (nameError || colorError) { (nameError ? $("palette-name") : $("palette-colors").querySelector('[aria-invalid="true"]'))?.focus(); return; }
    const palettes = clone(state.draft.customPalettes);
    const index = palettes.findIndex(p => p.id === editor.id);
    if (index >= 0) palettes[index] = clone(editor); else palettes.push(clone(editor));
    const selected = editor.id;
    $("palette-dialog").close(); editor = null;
    changeConfig({ customPalettes: palettes, paletteId: selected });
    document.querySelector('input[name="theme"]:checked')?.focus();
    notice("Palette added to your live-preview draft. Save to keep it after power-off.");
  });
  async function removePalette(id) {
    if (locked()) return;
    const palette = state.draft.customPalettes.find(p => p.id === id);
    if (!palette) return;
    if (await ask(`Delete “${palette.name}”?`, state.draft.paletteId === id ? "This palette is selected. The same atomic preview will select Halloween as a valid replacement. Save explicitly to persist the deletion." : "The deletion previews in RAM. Save explicitly to persist it.", "Delete palette") !== "proceed") return;
    if (locked()) return;
    const next = deletePalette(state.draft, id);
    changeConfig(next); $("new-palette").focus();
  }
  render(); schedulePoll(0);
}
