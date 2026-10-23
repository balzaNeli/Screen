import assert from "node:assert/strict";
import test from "node:test";

import {
  connectionReducer,
  initialConnection,
  type ConnectionState,
} from "../src/viewer/connection.ts";

function apply(events: Parameters<typeof connectionReducer>[1][]): ConnectionState {
  return events.reduce(connectionReducer, initialConnection);
}

test("the first failure asks for exactly one ICE restart", () => {
  const state = apply(["failed"]);
  assert.deepEqual(state, { phase: "reconnecting", restarts: 1 });
});

test("a second failure while reconnecting goes straight to the reconnect screen", () => {
  assert.deepEqual(apply(["failed", "failed"]), { phase: "lost", restarts: 1 });
});

test("a failed restart times out into the reconnect screen", () => {
  assert.deepEqual(apply(["failed", "timeout"]), { phase: "lost", restarts: 1 });
  assert.deepEqual(apply(["timeout"]), initialConnection);
});

test("recovery resets the budget for the next failure", () => {
  assert.deepEqual(apply(["failed", "connected", "failed"]), {
    phase: "reconnecting",
    restarts: 1,
  });
  assert.deepEqual(apply(["failed", "timeout", "connected"]), {
    phase: "connected",
    restarts: 0,
  });
});
