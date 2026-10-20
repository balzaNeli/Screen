import assert from "node:assert/strict";
import test from "node:test";

import { PIN_LENGTH, isPinComplete, reducePad, takePin } from "../src/viewer/pin.ts";

test("the PIN pad takes six digits and ignores any seventh or non-digit", () => {
  let digits = "";
  for (const digit of ["1", "2", "3", "4", "5", "6", "7"]) {
    digits = reducePad(digits, { type: "digit", digit });
  }
  assert.equal(digits, "123456");
  assert.equal(isPinComplete(digits), true);
  assert.equal(reducePad(digits, { type: "digit", digit: "8" }), "123456");
  assert.equal(reducePad(digits, { type: "digit", digit: "x" }), "123456");
});

test("backspace removes one digit, clear empties the pad, and five digits are incomplete", () => {
  assert.equal(reducePad("123", { type: "backspace" }), "12");
  assert.equal(reducePad("", { type: "backspace" }), "");
  assert.equal(reducePad("123456", { type: "clear" }), "");
  assert.equal(isPinComplete("12345"), false);
  assert.equal(PIN_LENGTH, 6);
});

test("takePin extracts a valid PIN and strips only that parameter", () => {
  assert.deepEqual(takePin("http://192.168.0.10:4680/?p=042117"), { pin: "042117", path: "/" });
  assert.deepEqual(takePin("http://host:4680/?debug=1&p=123456"), {
    pin: "123456",
    path: "/?debug=1",
  });
  assert.deepEqual(takePin("http://host:4680/?p=123456#debug"), { pin: "123456", path: "/#debug" });
});

test("takePin scrubs invalid and missing PINs without touching other parameters", () => {
  assert.deepEqual(takePin("http://host:4680/?p=12"), { pin: "", path: "/" });
  assert.deepEqual(takePin("http://host:4680/?p=12345x"), { pin: "", path: "/" });
  assert.deepEqual(takePin("http://host:4680/?debug=1"), { pin: "", path: "/?debug=1" });
});
