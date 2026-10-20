import assert from "node:assert/strict";
import test from "node:test";

import { pairUrl, primaryUrl } from "../src/main/qr.ts";
import { takePin } from "../src/viewer/pin.ts";

test("primaryUrl picks the first reachable address and stays null without one", () => {
  assert.equal(primaryUrl([]), null);
  assert.equal(
    primaryUrl(["http://192.168.0.10:4680/", "http://10.0.0.2:4680/"]),
    "http://192.168.0.10:4680/",
  );
});

test("pairUrl puts the PIN in the p parameter and replaces an old one", () => {
  assert.equal(pairUrl("http://192.168.0.10:4680/", "042117"), "http://192.168.0.10:4680/?p=042117");
  assert.equal(pairUrl("http://host:4680/?p=old", "123456"), "http://host:4680/?p=123456");
});

test("the QR payload is exactly what the viewer prefills", () => {
  const scanned = pairUrl("http://192.168.0.10:4680/", "042117");
  assert.deepEqual(takePin(scanned), { pin: "042117", path: "/" });
});
