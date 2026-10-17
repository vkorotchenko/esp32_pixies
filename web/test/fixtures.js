// Synthetic device data for Node/browser exercises only. Never imported by production.
export function configFixture(overrides = {}) {
  return { ledCount: 200, on: true, brightness: 25, speed: 50, intensity: 50, density: 50, effect: "twinkle", paletteId: "builtin:light-blue", customPalettes: [], ...overrides };
}
export function snapshotFixture(config = configFixture(), overrides = {}) {
  return { schemaVersion: 1, bootId: "0123456789abcdef", revision: 1, savedRevision: 1, dirty: false, activeLedCount: 200, requestedLedCount: config.ledCount, savedLedCount: 200, restartRequired: config.ledCount !== 200, savedRestartRequired: false, config: structuredClone(config), ...overrides };
}
export function palettesFixture() {
  return [
    { id: "builtin:light-blue", name: "Light blue", builtin: true, colors: ["#ADD8E6"] },
    { id: "halloween", name: "Halloween", builtin: true, colors: ["#00FF00", "#FFA500"] },
    { id: "christmas", name: "Christmas", builtin: true, colors: ["#FF0000", "#FFFFFF", "#00FF00"] },
  ];
}
export function sessionFixture(overrides = {}) {
  return { configured: false, authenticated: false, claimAllowed: true, csrfToken: null, sessionLifetimeSeconds: 1800, ...overrides };
}
export function statusFixture(snapshot = snapshotFixture()) {
  return {
    schemaVersion: 1, bootId: snapshot.bootId, uptimeMs: 12345, freeHeapBytes: 200000,
    firmware: { version: "0.1.0", target: "esp32s3_n16r8", flashBytes: 16777216, psramBytes: 8388608, expectedFlashBytes: 16777216, expectedPsramBytes: 8388608, memoryMatches: true },
    settings: { revision: snapshot.revision, savedRevision: snapshot.savedRevision, dirty: snapshot.dirty, activeLedCount: snapshot.activeLedCount, requestedLedCount: snapshot.requestedLedCount, savedLedCount: snapshot.savedLedCount, restartRequired: snapshot.restartRequired, savedRestartRequired: snapshot.savedRestartRequired, recovery: "none" },
    led: { ready: true, gpio: 4, order: "GRB", maxCount: 1000, budgetMa: 9000, estimatedMa: 1900, requestedMa: 1900, limited: false, scalePermille: 1000, frames: 100, pausedForUpdate: false },
    network: { state: "setup_ap", hostname: "pixies-0123456789ab.local", connected: false, ip: "", ssid: "", apOpen: true, apSsid: "Pixies-0123456789ab", apIp: "192.168.4.1", wifiSaved: false, candidateState: "idle", scanState: "idle", error: "" },
    admin: { configured: false, credentialRecovery: "none", claimAllowed: true },
    update: { state: "idle", busy: false, receivedBytes: 0, expectedBytes: 0, slotBytes: 7340032, error: "" },
    restarting: false,
  };
}
