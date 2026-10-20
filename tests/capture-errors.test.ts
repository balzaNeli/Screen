import assert from "node:assert/strict";
import test from "node:test";

import { captureErrorMessage } from "../src/renderer/mirror.ts";

test("capture denials become actionable messages, not raw exception names", () => {
  assert.match(
    captureErrorMessage(new DOMException("Permission denied", "NotAllowedError")),
    /Screen capture was denied/,
  );
  assert.match(
    captureErrorMessage(new DOMException("no source", "NotFoundError")),
    /No screen or window/,
  );
  assert.equal(captureErrorMessage(new Error("boom")), "Screen capture failed: boom");
});
