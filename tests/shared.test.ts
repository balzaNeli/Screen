import assert from "node:assert/strict";
import test from "node:test";

import { audioModeFor } from "../src/shared/audio.ts";
import { preferH264 } from "../src/shared/codecs.ts";
import { parseSignal } from "../src/shared/protocol.ts";
import { RTC_CONFIG } from "../src/shared/rtc.ts";

test("parseSignal rejects anything that is not a Signal", () => {
  const reject = [
    "",
    "{",
    "null",
    "[]",
    '"offer"',
    "42",
    "{}",
    '{"type":1}',
    '{"type":"nope"}',
    '{"type":"offer"}',
    '{"type":"offer","sdp":null}',
    '{"type":"answer","sdp":{}}',
    '{"type":"ice"}',
    '{"type":"ice","candidate":null}',
    '{"type":"ice","candidate":{}}',
    '{"type":"ice","candidate":{"candidate":5}}',
    '{"type":"stop"}',
    '{"type":"stop","reason":0}',
  ];
  for (const raw of reject) assert.equal(parseSignal(raw), null, `should reject: ${raw}`);
});

test("parseSignal accepts every variant and drops unknown fields", () => {
  assert.deepEqual(parseSignal('{"type":"offer","sdp":"v=0"}'), { type: "offer", sdp: "v=0" });
  assert.deepEqual(parseSignal('{"type":"answer","sdp":"v=0"}'), { type: "answer", sdp: "v=0" });
  assert.deepEqual(parseSignal('{"type":"stop","reason":"host stopped"}'), {
    type: "stop",
    reason: "host stopped",
  });
  assert.deepEqual(parseSignal('{"type":"bye"}'), { type: "bye" });
  assert.deepEqual(parseSignal('{"type":"bye","evil":"rides along"}'), { type: "bye" });
  assert.deepEqual(
    parseSignal('{"type":"ice","candidate":{"candidate":"c","sdpMid":"0","sdpMLineIndex":0,"x":1}}'),
    { type: "ice", candidate: { candidate: "c", sdpMid: "0", sdpMLineIndex: 0 } },
  );
});

test("audioModeFor only enables loopback where Electron supports it", () => {
  assert.equal(audioModeFor("win32"), "loopback");
  assert.equal(audioModeFor("darwin"), null);
  assert.equal(audioModeFor("linux"), null);
});

test("preferH264 puts H.264 first, keeps the rest as fallback, mutates nothing", () => {
  const codecs = [
    { mimeType: "video/VP8", clockRate: 90000 },
    { mimeType: "video/H264", clockRate: 90000 },
    { mimeType: "video/VP9", clockRate: 90000 },
    { mimeType: "video/rtx" },
    { mimeType: "video/h264" },
  ];
  const ordered = preferH264(codecs);

  assert.deepEqual(
    ordered.map((c) => c.mimeType),
    ["video/H264", "video/h264", "video/VP8", "video/VP9", "video/rtx"],
  );
  assert.equal(ordered.length, codecs.length, "nothing may be filtered out");
  assert.equal(codecs[0]?.mimeType, "video/VP8", "input array must not be reordered");
  assert.equal(
    preferH264([{ mimeType: "video/VP8" }, { mimeType: "video/VP9" }])[0]?.mimeType,
    "video/VP8",
    "stable when there is no H.264",
  );
  assert.deepEqual(preferH264([]), []);
});

test("RTC_CONFIG cannot grow a STUN/TURN server", () => {
  assert.deepEqual(RTC_CONFIG.iceServers, []);
  assert.ok(Object.isFrozen(RTC_CONFIG));
  assert.ok(Object.isFrozen(RTC_CONFIG.iceServers));
  assert.throws(() => {
    (RTC_CONFIG as { iceServers: unknown[] }).iceServers = [{ urls: "stun:evil.example" }];
  }, TypeError);
  assert.throws(() => {
    (RTC_CONFIG.iceServers as unknown[]).push({ urls: "stun:evil.example" });
  }, TypeError);
});
