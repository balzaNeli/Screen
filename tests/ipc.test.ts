import assert from "node:assert/strict";
import test from "node:test";

import { parseStartRequest } from "../src/shared/ipc.ts";

test("parseStartRequest accepts the documented shape and drops unknown fields", () => {
  const request = parseStartRequest({
    sourceId: "screen:0:0",
    quality: "1080p",
    audio: true,
    evil: "rides along",
  });
  assert.deepEqual(request, { sourceId: "screen:0:0", quality: "1080p", audio: true });
  assert.deepEqual(parseStartRequest({ sourceId: "window:1:0", quality: "native", audio: false }), {
    sourceId: "window:1:0",
    quality: "native",
    audio: false,
  });
});

test("parseStartRequest rejects junk at the IPC boundary instead of throwing", () => {
  const reject: unknown[] = [
    null,
    undefined,
    "screen:0:0",
    42,
    [],
    {},
    { sourceId: "", quality: "1080p", audio: true },
    { sourceId: 7, quality: "1080p", audio: true },
    { sourceId: "x".repeat(257), quality: "1080p", audio: true },
    { sourceId: "screen:0:0", quality: "4k", audio: true },
    { sourceId: "screen:0:0", quality: "1080p", audio: "yes" },
    { sourceId: "screen:0:0", audio: true },
  ];
  for (const value of reject) assert.equal(parseStartRequest(value), null, JSON.stringify(value));
});
