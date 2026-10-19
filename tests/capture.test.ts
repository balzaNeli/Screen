import assert from "node:assert/strict";
import test from "node:test";

import { videoConstraints } from "../src/shared/capture.ts";

test("videoConstraints caps the capture instead of asking for an exact size", () => {
  assert.equal(videoConstraints("native"), null);
  assert.deepEqual(videoConstraints("1080p"), {
    width: { max: 1920 },
    height: { max: 1080 },
    frameRate: { max: 30 },
  });
  assert.deepEqual(videoConstraints("720p"), {
    width: { max: 1280 },
    height: { max: 720 },
    frameRate: { max: 30 },
  });
});

test("videoConstraints emits only upper bounds, never min or exact", () => {
  for (const quality of ["1080p", "720p"] as const) {
    const text = JSON.stringify(videoConstraints(quality));
    assert.equal(text.includes('"min"'), false, quality);
    assert.equal(text.includes('"exact"'), false, quality);
  }
});
