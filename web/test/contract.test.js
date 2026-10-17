import test from "node:test";
import assert from "node:assert/strict";
import { mutationHeaders, uploadHeaders } from "../app.js";
import { readFile } from "node:fs/promises";
test("same-origin JSON requests carry explicit marker and optional CSRF", () => {
  assert.deepEqual(mutationHeaders(null), { "Content-Type": "application/json", "X-Pixies-Request": "1" });
  assert.equal(mutationHeaders("session-csrf")["X-CSRF-Token"], "session-csrf");
});
test("OTA is a raw binary file, never multipart; browser provides Content-Length", () => {
  const h = uploadHeaders("token", 1024);
  assert.equal(h["Content-Type"], "application/octet-stream");
  assert.equal(h["X-Firmware-Size"], "1024");
  assert.equal(h["X-CSRF-Token"], "token");
  assert.equal(h["Content-Length"], undefined);
  for (const n of [0, 287, 0x700001, -1, 1.5, NaN]) assert.throws(() => uploadHeaders("token", n));
});
test("published configuration schema keeps bounded defaults and complete-object semantics", async () => {
  const schema = JSON.parse(await readFile(new URL("../../docs/config.schema.json", import.meta.url), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(new Set(schema.required), new Set(Object.keys(schema.properties)));
  const p = schema.properties;
  assert.equal(p.ledCount.default, 200);
  assert.equal(p.ledCount.minimum, 1);
  assert.equal(p.ledCount.maximum, 1000);
  assert.equal(p.brightness.default, 25);
  assert.equal(p.customPalettes.maxItems, 10);
  assert.equal(p.customPalettes.items.properties.colors.maxItems, 8);
  assert.deepEqual(p.effect.enum, ["steady", "twinkle", "candle", "breathe", "chase"]);
});
