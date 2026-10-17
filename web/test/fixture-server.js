// LOOPBACK-ONLY BROWSER FIXTURE, not firmware or a production server.
// Only index.html/app.js/styles.css are embedded. No actual device/password/flash is used.
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { configFixture, snapshotFixture, palettesFixture, sessionFixture, statusFixture } from "./fixtures.js";
import { normalizeConfig, sameConfig } from "../app.js";

export async function startFixtureServer(port = 4173) {
  const token = "a".repeat(64); // Public synthetic test credential, never a real session.
  let current, saved, deviceStatus, configured, authenticated, scan, flags, calls, generation;
  function reset() {
    current = snapshotFixture(); saved = configFixture(); deviceStatus = statusFixture();
    configured = false; authenticated = false; scan = "idle"; flags = {}; calls = []; generation = 0;
  }
  reset();
  function refresh() {
    const latest = statusFixture(current);
    deviceStatus = { ...deviceStatus, bootId: current.bootId, settings: latest.settings };
    deviceStatus.admin.configured = configured;
    deviceStatus.admin.claimAllowed = !configured && !flags.claimForbidden;
    return deviceStatus;
  }
  function boot(version = deviceStatus.firmware.version) {
    generation++;
    current = snapshotFixture(saved, { bootId: generation.toString(16).padStart(16, "0"), activeLedCount: saved.ledCount, savedLedCount: saved.ledCount, restartRequired: false, savedRestartRequired: false });
    authenticated = false; deviceStatus.update = statusFixture().update; deviceStatus.restarting = false;
    deviceStatus.firmware.version = version; refresh();
  }
  const json = (res, code, value, headers = {}) => {
    const data = JSON.stringify(value);
    res.writeHead(code, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data), "Connection": "close", "Cache-Control": "no-store", ...headers });
    res.end(data);
  };
  const fail = (res, status, code, message = code, field) => json(res, status, { error: { code, message, ...(field ? { field } : {}) } });
  const session = () => sessionFixture({ configured, authenticated, claimAllowed: !configured, csrfToken: authenticated ? token : null });
  const server = createServer(async (req, res) => {
    try {
      const path = req.url;
      if (path === "/__test/state") return json(res, 200, { current, status: refresh(), configured, authenticated, calls });
      const buffers = [];
      for await (const chunk of req) buffers.push(chunk);
      const bytes = Buffer.concat(buffers);
      let body;
      if (path !== "/api/update" && bytes.length) {
        try { body = JSON.parse(bytes.toString()); } catch { return fail(res, 400, "invalid_json"); }
      }
      if (path === "/__test/control" && req.method === "POST") {
        if (body.reset) reset();
        if (body.expire) authenticated = false;
        if (typeof body.claimAllowed === "boolean") flags.claimForbidden = !body.claimAllowed;
        if (body.recovery) deviceStatus.settings.recovery = body.recovery;
        if (body.external) {
          current.config = normalizeConfig({ ...current.config, ...body.external }); current.revision++;
          current.requestedLedCount = current.config.ledCount; current.restartRequired = current.config.ledCount !== current.activeLedCount;
          current.dirty = !sameConfig(current.config, saved);
        }
        if (body.boot) boot();
        if (body.limited) Object.assign(deviceStatus.led, { limited: true, estimatedMa: 8999, requestedMa: 11900, scalePermille: 756 });
        Object.assign(flags, body);
        return json(res, 200, { fixture: true });
      }
      if (flags.offline && path.startsWith("/api/")) { req.socket.destroy(); return; }
      if (!path.startsWith("/api/")) {
        const assets = { "/": ["index.html", "text/html"], "/app.js": ["app.js", "text/javascript"], "/styles.css": ["styles.css", "text/css"] };
        if (!assets[path]) return fail(res, 404, "not_found");
        const [name, type] = assets[path]; const data = await readFile(new URL(`../${name}`, import.meta.url));
        res.writeHead(200, { "Content-Type": type, "Content-Length": data.length, "Connection": "close", "Cache-Control": "no-store" }); res.end(data); return;
      }
      calls.push({ method: req.method, path, time: Date.now(), ...(path === "/api/update" ? { bytes: bytes.length, duringUpload: true } : {}) });
      if (req.method !== "GET" && (req.headers["x-pixies-request"] !== "1" || req.headers["content-type"] !== (path === "/api/update" ? "application/octet-stream" : "application/json"))) return fail(res, 415, "content_type", "Fixture requires exact contract headers");
      const adminPath = ["/api/auth/logout", "/api/wifi/scan", "/api/wifi/connect", "/api/wifi/reset", "/api/restart", "/api/factory-reset", "/api/update"].includes(path);
      if (adminPath && (!authenticated || !req.headers.cookie?.includes("pixies_session=fixture-only"))) return fail(res, 401, "authentication", "Synthetic session expired");
      if (adminPath && req.method !== "GET" && req.headers["x-csrf-token"] !== token) return fail(res, 403, "csrf");
      if (req.method === "GET") {
        if (path === "/api/status") {
          const result = refresh();
          if (flags.recovery) result.settings.recovery = flags.recovery;
          return json(res, 200, result);
        }
        if (path === "/api/config") return json(res, 200, current);
        if (path === "/api/palettes") return json(res, 200, { palettes: [...palettesFixture(), ...current.config.customPalettes.map(p => ({ ...p, builtin: false }))] });
        if (path === "/api/auth/session") return json(res, 200, { ...session(), claimAllowed: !configured && !flags.claimForbidden });
        if (path === "/api/wifi/scan") return json(res, 200, { state: scan, networks: scan === "complete" ? [{ ssid: '<img src=x onerror="window.injected=true">', rssi: -61, channel: 6, open: false }, { ssid: "Test Home", rssi: -45, channel: 1, open: false }, { ssid: "Open porch", rssi: -72, channel: 11, open: true }] : [], truncated: false });
      }
      if (path === "/api/config" && req.method === "PUT") {
        if (flags.conflict) {
          flags.conflict = false; current.config.effect = "chase"; current.revision++; current.dirty = true;
          return fail(res, 409, "revision_conflict", "Changed by another controller");
        }
        if (body.baseRevision !== current.revision) return fail(res, 409, "revision_conflict");
        if (flags.rejectCount) { flags.rejectCount = false; return fail(res, 422, "validation", "Synthetic field validation error", "ledCount"); }
        try { current.config = normalizeConfig(body.config); } catch (error) { return fail(res, 422, "validation", error.message, error.field); }
        current.revision++; current.requestedLedCount = current.config.ledCount;
        current.restartRequired = current.requestedLedCount !== current.activeLedCount;
        current.dirty = !sameConfig(current.config, saved);
        return json(res, 200, current);
      }
      if (path === "/api/save" && req.method === "POST") {
        if (body.baseRevision !== current.revision) return fail(res, 409, "revision_conflict");
        if (flags.save === "storage_failed") { flags.save = ""; return fail(res, 500, "storage_failed", "Synthetic persistence failure; not saved"); }
        saved = structuredClone(current.config); current.savedRevision = current.revision; current.dirty = false; current.savedLedCount = saved.ledCount; current.savedRestartRequired = saved.ledCount !== current.activeLedCount;
        if (flags.save === "drop") {
          flags.save = "";
          // Drop a partially returned response, not an idle keepalive socket that Chrome may retry.
          res.writeHead(200, { "Content-Type": "application/json", "Content-Length": "999", "Connection": "close" });
          res.write("{"); setTimeout(() => req.socket.destroy(), 30); return;
        }
        return json(res, 200, current);
      }
      if (["/api/auth/claim", "/api/auth/login"].includes(path) && req.method === "POST") {
        if (path.endsWith("claim") && (configured || flags.claimForbidden)) return fail(res, 403, "claim_forbidden");
        if (typeof body.password !== "string" || body.password.length < 12) return fail(res, 401, "authentication");
        configured = true; authenticated = true;
        return json(res, 200, session(), { "Set-Cookie": "pixies_session=fixture-only; Path=/; HttpOnly; SameSite=Strict" });
      }
      if (path === "/api/auth/logout") { authenticated = false; return json(res, 200, session(), { "Set-Cookie": "pixies_session=; Max-Age=0; Path=/" }); }
      if (path === "/api/wifi/scan" && req.method === "POST") {
        scan = "running"; setTimeout(() => { scan = "complete"; }, 300); return json(res, 202, { state: "running" });
      }
      if (path === "/api/wifi/connect") {
        deviceStatus.network.candidateState = "connecting";
        setTimeout(() => { Object.assign(deviceStatus.network, { state: "connected", connected: true, ssid: body.ssid, ip: "192.168.1.25", wifiSaved: true, candidateState: "succeeded" }); }, 300);
        return json(res, 202, { state: "connecting" });
      }
      if (path === "/api/wifi/reset" && body.confirm === "wifi-reset") {
        deviceStatus.network = statusFixture().network; return json(res, 200, { state: "setup_ap", apIp: "192.168.4.1" });
      }
      if (path === "/api/restart" && body.confirm === "restart") {
        deviceStatus.restarting = true; json(res, 202, { restarting: true }); setTimeout(() => boot(), 900); return;
      }
      if (path === "/api/factory-reset" && body.confirm === "factory-reset") {
        saved = configFixture(); configured = false; deviceStatus.restarting = true;
        json(res, 202, { restarting: true }); setTimeout(() => boot(), 900); return;
      }
      if (path === "/api/update") {
        if (Number(req.headers["x-firmware-size"]) !== bytes.length || Number(req.headers["content-length"]) !== bytes.length) return fail(res, 422, "length_mismatch");
        deviceStatus.update.state = "receiving"; deviceStatus.update.busy = true;
        deviceStatus.led.pausedForUpdate = true;
        await new Promise(resolve => setTimeout(resolve, 1100));
        if (flags.uploadReject || flags.uploadDisconnect) {
          Object.assign(deviceStatus.update, { state: "failed", busy: false, error: "invalid_image" }); deviceStatus.led.pausedForUpdate = false;
          if (flags.uploadDisconnect) { flags.uploadDisconnect = false; req.socket.destroy(); return; }
          flags.uploadReject = false; return fail(res, 422, "update_failed", "Synthetic image rejection");
        }
        deviceStatus.update.state = "restarting"; deviceStatus.restarting = true;
        json(res, 202, { state: "restarting", receivedBytes: bytes.length, restarting: true });
        setTimeout(() => { boot("0.2.0"); deviceStatus.led.pausedForUpdate = false; }, 900); return;
      }
      fail(res, 404, "not_found");
    } catch {
      if (!res.headersSent) fail(res, 500, "fixture_error");
      else res.end();
    }
  });
  await new Promise(resolve => server.listen(port, "127.0.0.1", resolve));
  return server;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = await startFixtureServer(Number(process.env.PIXIES_TEST_PORT || 4173));
  console.log(`Synthetic Pixies fixture only: http://127.0.0.1:${server.address().port}`);
}
