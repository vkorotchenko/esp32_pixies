// Dependency-free real-browser regression exercise using Chrome's DevTools protocol.
// Starts an isolated headless profile and synthetic loopback device; never uses hardware.
// No passwords/tokens are logged. Chrome may be set via PIXIES_CHROME_PATH.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { startFixtureServer } from "./fixture-server.js";

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const server = await startFixtureServer(0);
const base = `http://127.0.0.1:${server.address().port}`;
const profile = await mkdtemp(fileURLToPath(new URL(".chrome-fixture-", import.meta.url)));
let chrome, ws, session, commandId = 0, passed = 0;
const pending = new Map(), browserErrors = [];
const command = (method, params = {}, sessionId = session) => new Promise((resolve, reject) => {
  const id = ++commandId;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`DevTools timeout: ${method}`)); }, 15000);
  pending.set(id, { resolve, reject, timer });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(`Browser evaluation failed: ${result.exceptionDetails.text}`);
  return result.result.value;
}
async function wait(expression, label, timeout = 16000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await evaluate(expression)) return; await sleep(80); }
  const diagnostics = await evaluate(`Object.fromEntries(["notice","error","save-state","connection-label","conflict-detail"].map(id=>[id,document.getElementById(id)?.textContent]))`);
  const calls = (await device()).calls.slice(-12).map(c => `${c.method} ${c.path}`);
  throw new Error(`UI wait timed out: ${label}; visible state ${JSON.stringify(diagnostics)}; last requests ${JSON.stringify(calls)}`);
}
async function click(selector) {
  assert.equal(await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el || el.disabled) return false; el.click(); return true; })()`), true, `enabled element ${selector}`);
}
async function fill(selector, value, event = "input") {
  await evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); el.value=${JSON.stringify(value)}; el.dispatchEvent(new Event(${JSON.stringify(event)},{bubbles:true})); })()`);
}
const fixture = async body => {
  const response = await fetch(`${base}/__test/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
};
const device = async () => (await fetch(`${base}/__test/state`)).json();
const check = label => { passed++; console.log(`PASS ${passed}: ${label}`); };
const waitReady = () => wait(`document.querySelector("#connection-label")?.textContent.includes("Device online")`, "online device");
const waitPreview = value => wait(`document.querySelector("#save-state").textContent==="Unsaved live preview" && document.querySelector("#brightness").value==="${value}"`, "preview acknowledgement");
async function signIn() {
  await fill("#password", "test-password-1234");
  if (!await evaluate(`document.querySelector("#confirm-password-row").hidden`)) await fill("#confirm-password", "test-password-1234");
  await click("#authenticate");
  await wait(`!document.querySelector("#logout").hidden && !document.querySelector("#scan").disabled`, "admin session");
}
try {
  const chromePath = process.env.PIXIES_CHROME_PATH || (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : "google-chrome");
  chrome = spawn(chromePath, [
    "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-sync",
    "--disable-background-networking", "--disable-component-update", "--disable-default-apps", "--disable-extensions",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`,
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1",
    "about:blank",
  ], { stdio: ["ignore", "ignore", "pipe"] });
  let launchError, launchDiagnostics = "";
  chrome.on("error", error => { launchError = error; });
  chrome.stderr.on("data", data => { launchDiagnostics = (launchDiagnostics + data.toString()).slice(-3000); });
  let devtools;
  for (let i = 0; i < 150; i++) {
    if (launchError) throw launchError;
    if (chrome.exitCode !== null || chrome.signalCode !== null) break;
    try { devtools = (await readFile(`${profile}/DevToolsActivePort`, "utf8")).trim().split("\n"); break; } catch { await sleep(100); }
  }
  assert.ok(devtools, `installed Chrome starts with isolated profile (exit ${chrome.exitCode}, signal ${chrome.signalCode}): ${launchDiagnostics}`);
  ws = new WebSocket(`ws://127.0.0.1:${devtools[0]}${devtools[1]}`);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.onmessage = event => {
    const data = JSON.parse(event.data);
    if (data.id) {
      const item = pending.get(data.id); if (!item) return;
      pending.delete(data.id); clearTimeout(item.timer);
      if (data.error) item.reject(new Error(`DevTools error: ${data.error.message}`)); else item.resolve(data.result);
    } else if (data.method === "Runtime.exceptionThrown") browserErrors.push(data.params.exceptionDetails.text);
  };
  const { targetId } = await command("Target.createTarget", { url: "about:blank" }, null);
  ({ sessionId: session } = await command("Target.attachToTarget", { targetId, flatten: true }, null));
  await command("Runtime.enable"); await command("Page.enable");
  await command("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
  await command("Page.navigate", { url: base });
  await waitReady();
  assert.equal(await evaluate(`document.querySelector("#brightness").value`), "25");
  assert.equal(await evaluate(`document.querySelector("#active-count").textContent`), "200");
  assert.equal(await evaluate(`document.querySelector("#save-state").textContent`), "Saved on device");
  assert.equal(await evaluate(`document.querySelector("#scan").disabled`), true);
  check("authoritative initial defaults, protected first claim, admin controls locked");

  await fixture({ claimAllowed: false, recovery: "missing" }); await click("#refresh");
  await wait(`document.querySelector("#auth-state").textContent.includes("only allowed from the protected")`, "AP-only initial claim restriction");
  assert.equal(await evaluate(`document.querySelector("#authenticate").disabled`), true);
  assert.equal(await evaluate(`document.querySelector("#save").disabled`), false, "recovered defaults can be explicitly saved even without content changes");
  assert.match(await evaluate(`document.querySelector("#save-state").textContent`), /recovery/);
  await click("#save"); await wait(`document.querySelector("#save-state").textContent==="Saved on device"`, "explicit recovery Save");
  await fixture({ claimAllowed: true, recovery: "none" }); await click("#refresh");
  await wait(`!document.querySelector("#authenticate").disabled`, "AP claim allowed again");
  check("claim forbidden off protected AP; boot defaults are not mislabeled persisted, explicit Save available");

  await evaluate(`(() => { const el=document.querySelector("#brightness"); for(let i=26;i<=60;i++){el.value=i;el.dispatchEvent(new Event("input",{bubbles:true}));} })()`);
  await waitPreview(60);
  assert.equal((await device()).calls.filter(c => c.method === "PUT").length, 1);
  await click('input[name="theme"][value="christmas"]');
  await fill("#effect", "chase", "change");
  await wait(`document.querySelector("#save-state").textContent==="Unsaved live preview" && document.querySelector("#effect").value==="chase"`, "independent effect");
  await click("#save"); await wait(`document.querySelector("#save-state").textContent==="Saved on device"`, "saved lighting");
  let current = (await device()).current;
  assert.equal(current.config.paletteId, "christmas"); assert.equal(current.config.effect, "chase"); assert.equal(current.config.brightness, 60);
  const puts = (await device()).calls.filter(c => c.method === "PUT");
  for (let i = 1; i < puts.length; i++) assert.ok(puts[i].time - puts[i - 1].time >= 300, "bounded request rate (allow 50ms scheduling tolerance)");
  check("rapid sliders coalesce; theme/effect independence and explicit Save");

  await click("#new-palette");
  await fill("#palette-name", "<b>Porch</b>");
  for (let i = 0; i < 6; i++) await click("#add-color");
  assert.equal(await evaluate(`document.querySelector("#add-color").disabled`), true);
  await click("#apply-palette");
  await wait(`document.querySelector("#palette-count").textContent==="1 / 10" && document.querySelector("#save-state").textContent==="Unsaved live preview"`, "custom palette preview");
  assert.equal(await evaluate(`!!document.querySelector(".custom-palette b")`), false);
  await click(".custom-palette .secondary"); await fill("#palette-name", "Winter porch"); await click("#apply-palette");
  await wait(`document.querySelector(".custom-palette strong").textContent==="Winter porch"`, "rename");
  await wait(`document.querySelector("#save-state").textContent==="Unsaved live preview"`, "renamed preview ack");
  await click(".custom-palette .text-button");
  assert.match(await evaluate(`document.querySelector("#confirm-detail").textContent`), /Halloween/);
  await click("#confirm-proceed");
  await wait(`document.querySelector("#palette-count").textContent==="0 / 10" && document.querySelector('input[value="halloween"]').checked`, "selected deletion replacement");
  check("create/edit/rename/eight-color limit/delete; selected deletion chooses Halloween; names are text");

  await signIn();
  assert.equal(await evaluate(`document.querySelector("#password").value`), "");
  assert.equal(await evaluate(`localStorage.length+sessionStorage.length`), 0);
  assert.equal(await evaluate(`document.cookie.includes("pixies_session")`), false);
  await click("#scan");
  await wait(`document.querySelectorAll(".scan-network").length===3`, "scan results");
  assert.equal(await evaluate(`!!document.querySelector("#scan-results img") || window.injected===true`), false);
  await click(".scan-network:nth-child(2)");
  await fill("#wifi-password", "example-router-pass");
  await click("#connect"); await wait(`document.querySelector("#notice").textContent.includes("connected and saved")`, "candidate connection confirmation");
  assert.equal(await evaluate(`document.querySelector("#wifi-password").value`), "");
  check("protected claim, RAM-only session/HttpOnly cookie, safe scan SSIDs, candidate network confirmation");

  await fill("#led-count", "251"); await click("#refresh"); await waitReady();
  await wait(`!document.querySelector("#refresh").disabled`, "count edit survives status refresh");
  assert.equal(await evaluate(`document.querySelector("#led-count").value`), "251");
  const saveCallsBeforeCount = (await device()).calls.filter(c => c.path === "/api/save").length;
  await click("#save"); await wait(`document.querySelector("#led-count-error").textContent.includes("Set the preview count first")`, "unsubmitted count blocks Save");
  assert.equal((await device()).calls.filter(c => c.path === "/api/save").length, saveCallsBeforeCount);
  await fill("#led-count", "0"); await click("#apply-count");
  assert.match(await evaluate(`document.querySelector("#led-count-error").textContent`), /1,000/);
  await fill("#led-count", "250"); await click("#apply-count");
  await wait(`document.querySelector("#requested-count").textContent==="250"`, "requested count");
  assert.equal(await evaluate(`document.querySelector("#active-count").textContent`), "200");
  assert.equal(await evaluate(`document.querySelector("#saved-count").textContent`), "200");
  await click("#save"); await wait(`document.querySelector("#saved-count").textContent==="250"`, "saved count");
  await click("#on"); await wait(`document.querySelector("#save-state").textContent==="Unsaved live preview"`, "power-off preview");
  await click("#restart");
  assert.equal(await evaluate(`document.querySelector("#confirm-save").hidden`), false);
  await click("#confirm-cancel");
  assert.equal((await device()).current.config.on, false);
  await wait(`!document.querySelector("#restart").disabled`, "restart enabled after cancel");
  await click("#restart"); await click("#confirm-proceed");
  await wait(`document.querySelector("#notice").textContent.includes("New device boot confirmed")`, "explicit restart");
  assert.equal(await evaluate(`document.querySelector("#active-count").textContent`), "250");
  assert.equal(await evaluate(`document.querySelector("#on").checked`), true, "unsaved off state lost only by explicit discard");
  check("invalid count, active/requested/saved separation, unsaved restart confirmation and saved reboot state");

  await fixture({ conflict: true });
  await fill("#brightness", "77");
  await wait(`!document.querySelector("#conflict").hidden`, "409 conflict reconciliation");
  assert.equal(await evaluate(`document.querySelector("#brightness").value`), "77");
  const before = (await device()).calls.filter(c => c.method === "PUT").length;
  await sleep(900); assert.equal((await device()).calls.filter(c => c.method === "PUT").length, before);
  await click("#keep-draft"); await click("#confirm-proceed");
  await waitPreview(77);
  await click("#save"); await wait(`document.querySelector("#save-state").textContent==="Saved on device"`, "save after conflict");
  check("revision 409 preserves draft and does not replay; explicit overwrite uses latest revision");

  await fill("#brightness", "59"); await waitPreview(59);
  await fixture({ save: "storage_failed" }); await click("#save");
  await wait(`!document.querySelector("#error").hidden && document.querySelector("#error").textContent.includes("persistence failure")`, "storage failure");
  assert.equal((await device()).current.dirty, true);
  await sleep(700); assert.equal((await device()).current.dirty, true, "failed Save is not automatically retried");
  await click("#save"); await wait(`document.querySelector("#save-state").textContent==="Saved on device"`, "manual save retry");
  await fill("#brightness", "61"); await waitPreview(61);
  await fixture({ save: "drop" }); await click("#save");
  await wait(`document.querySelector("#notice").textContent.includes("original Save response was lost")`, "ambiguous save verification");
  assert.equal((await device()).current.dirty, false);
  check("storage failure stays unsaved; ambiguous Save is verified by real readback");

  await fixture({ offline: true }); await fill("#brightness", "72");
  await wait(`document.querySelector("#connection-label").textContent.includes("Connection lost")`, "dropout");
  await fixture({ offline: false }); await click("#refresh");
  await wait(`!document.querySelector("#conflict").hidden`, "retained draft on reconnect");
  assert.equal(await evaluate(`document.querySelector("#brightness").value`), "72");
  await click("#use-device"); await click("#confirm-proceed");
  await wait(`document.querySelector("#brightness").value==="61" && document.querySelector("#conflict").hidden`, "explicit device choice");
  await fill("#brightness", "33"); await waitPreview(33);
  await fixture({ boot: true }); await click("#refresh");
  await wait(`!document.querySelector("#conflict").hidden && document.querySelector("#conflict-detail").textContent.includes("restarted")`, "unexpected boot");
  assert.equal(await evaluate(`document.querySelector("#brightness").value`), "33");
  await click("#use-device"); await click("#confirm-proceed");
  await wait(`document.querySelector("#brightness").value==="61" && document.querySelector("#conflict").hidden`, "boot restore choice");
  check("network dropout and unexpected boot retain unsaved draft without blind replay");

  await signIn();
  await fixture({ expire: true }); await click("#scan");
  await wait(`document.querySelector("#auth-state").textContent.includes("Admin locked")`, "401 session expiry");
  assert.equal(await evaluate(`document.querySelector("#connect").disabled`), true);
  await waitReady(); await signIn();
  await fixture({ limited: true }); await click("#refresh");
  await wait(`document.querySelector("#power-status").textContent.includes("Current limiting active")`, "current estimate");
  await click("#wifi-reset"); await click("#confirm-cancel");
  assert.equal((await device()).calls.filter(c => c.path === "/api/wifi/reset").length, 0);
  await click("#factory-reset"); await click("#confirm-cancel");
  assert.equal((await device()).calls.filter(c => c.path === "/api/factory-reset").length, 0);
  check("session expiry re-locks admin, current limiter is surfaced, reset cancellation sends nothing");

  const imagePath = `${profile}/firmware.bin`; await writeFile(imagePath, Buffer.alloc(1024, 0xe9));
  const documentNode = await command("DOM.getDocument");
  const fileInput = await command("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: "#firmware" });
  await command("DOM.setFileInputFiles", { nodeId: fileInput.nodeId, files: [imagePath] });
  await fixture({ uploadReject: true });
  await click("#update"); await click("#confirm-proceed");
  await wait(`document.querySelector("#connection-label").textContent.includes("Uploading")`, "upload locked");
  assert.equal(await evaluate(`document.querySelector("#brightness").disabled`), true);
  await sleep(400);
  const during = (await device()).calls;
  const upload = during.findLast(c => c.path === "/api/update");
  assert.ok(upload); assert.equal(during.filter(c => c.time >= upload.time && c.path !== "/api/update").length, 0, "no API polling while XHR active");
  await wait(`document.querySelector("#error").textContent.includes("Synthetic image rejection") && !document.querySelector("#brightness").disabled`, "rejected OTA recovery");
  check("XHR upload pauses polls and controls; image rejection surfaces error and restores controls");

  let inputAgain = await command("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: "#firmware" });
  await command("DOM.setFileInputFiles", { nodeId: inputAgain.nodeId, files: [imagePath] });
  await fixture({ uploadDisconnect: true });
  await click("#update"); await click("#confirm-proceed");
  await wait(`document.querySelector("#update-detail").textContent.includes("NOT confirmed") || document.querySelector("#update-detail").textContent.includes("Response lost")`, "ambiguous OTA dropout");
  await wait(`document.querySelector("#notice").textContent.includes("original boot with no operation in progress")`, "failed ambiguous OTA readback");
  assert.equal(await evaluate(`document.querySelector("#brightness").disabled`), false);
  await signIn();
  check("OTA response loss does not claim a boot; authoritative failed state allows recovery");

  inputAgain = await command("DOM.querySelector", { nodeId: documentNode.root.nodeId, selector: "#firmware" });
  await command("DOM.setFileInputFiles", { nodeId: inputAgain.nodeId, files: [imagePath] });
  await click("#on"); await wait(`document.querySelector("#save-state").textContent==="Unsaved live preview"`, "dirty before OTA");
  await click("#update");
  assert.equal(await evaluate(`document.querySelector("#confirm-save").hidden`), false);
  await click("#confirm-save");
  await wait(`document.querySelector("#connection-label").textContent.includes("Uploading")`, "OTA after explicit save");
  await wait(`document.querySelector("#notice").textContent.includes("New boot confirmed: firmware v0.2.0")`, "new firmware boot", 20000);
  assert.equal((await device()).current.config.on, false, "explicit Save before OTA persists power state");
  assert.equal(await evaluate(`document.querySelector("#reload-ui").hidden`), false);
  check("save-before-OTA, raw byte transfer, 202 followed by new boot/version verification and UI reload affordance");

  for (const width of [320, 375, 768, 1280]) {
    await command("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    assert.equal(await evaluate(`document.documentElement.scrollWidth<=window.innerWidth`), true, `no horizontal overflow at ${width}px`);
  }
  await evaluate(`document.querySelector("#brightness").focus()`);
  const previousBrightness = Number(await evaluate(`document.querySelector("#brightness").value`));
  await command("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  await command("Input.dispatchKeyEvent", { type: "keyUp", key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 });
  assert.equal(Number(await evaluate(`document.querySelector("#brightness").value`)), previousBrightness + 1);
  assert.deepEqual(browserErrors, []);
  check("320/375/768/1280px layouts, keyboard range control, and no uncaught browser errors");
  console.log(`Browser fixture exercises: ${passed}/${passed} passed. Synthetic HTTP/device only; no physical verification.`);
} finally {
  for (const item of pending.values()) clearTimeout(item.timer);
  ws?.close();
  if (chrome && chrome.exitCode === null) {
    const exited = new Promise(resolve => chrome.once("exit", resolve));
    chrome.kill("SIGTERM"); await Promise.race([exited, sleep(3000)]);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await Promise.race([exited, sleep(1000)]);
  }
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
