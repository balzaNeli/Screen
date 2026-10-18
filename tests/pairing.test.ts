import assert from "node:assert/strict";
import test from "node:test";

import { createPairing, type Pairing, type PairingOptions } from "../src/server/pairing.ts";

/** Injected clock: no timers, no sleeps, and every edge is reachable in one line. */
function harness(options: PairingOptions = {}): { pairing: Pairing; advance: (ms: number) => void } {
  let clock = 1_000_000;
  return {
    pairing: createPairing({ now: () => clock, ...options }),
    advance: (ms) => {
      clock += ms;
    },
  };
}

/** A six-digit string that is certainly not the PIN in front of us. */
function wrongPinFor(pin: string): string {
  return pin === "000000" ? "000001" : "000000";
}

function paired(pairing: Pairing): { token: string; sessionId: string } {
  const result = pairing.verify(pairing.status().pin);
  if (result.kind !== "paired") throw new Error(`expected a pair, got ${result.kind}`);
  return result;
}

test("the PIN is always six digits and never degenerate", () => {
  const { pairing, advance } = harness();
  const seen = new Set<string>();
  for (let i = 0; i < 10_000; i++) {
    advance(60_001);
    const { pin } = pairing.status();
    assert.match(pin, /^\d{6}$/);
    seen.add(pin);
  }
  // 10 000 draws from a space of 10^6 collide ~50 times; a fixed or tiny generator would not.
  assert.ok(seen.size > 9_500, `expected mostly unique PINs, got ${seen.size}`);
});

test("an expired PIN fails even when it is the correct one", () => {
  const { pairing, advance } = harness();
  const before = pairing.status();
  advance(60_000);

  assert.deepEqual(pairing.verify(before.pin), { kind: "expired" });
  const fresh = pairing.status();
  assert.notEqual(fresh.pin, before.pin);
  assert.ok(fresh.expiresAtMs > before.expiresAtMs); // issued on demand, not left in the past

  // An expired attempt is not a failed attempt: the viewer had no way to know the new code.
  assert.deepEqual(pairing.verify(wrongPinFor(fresh.pin)), {
    kind: "invalid_pin",
    attemptsLeft: 2,
  });
});

test("three wrong PINs lock the door, rotate the code and reset the counter", () => {
  const { pairing, advance } = harness();
  const first = pairing.status().pin;
  const wrong = wrongPinFor(first);

  assert.deepEqual(pairing.verify(wrong), { kind: "invalid_pin", attemptsLeft: 2 });
  assert.deepEqual(pairing.verify(wrong), { kind: "invalid_pin", attemptsLeft: 1 });
  assert.deepEqual(pairing.verify(wrong), { kind: "locked", retryAfterMs: 60_000 });

  const rotated = pairing.status();
  assert.notEqual(rotated.pin, first);
  assert.ok(rotated.lockedUntilMs > 0);

  // Even the correct code is refused while locked, and the refusal costs no attempt.
  assert.deepEqual(pairing.verify(rotated.pin), { kind: "locked", retryAfterMs: 60_000 });
  assert.deepEqual(pairing.verify("000000"), { kind: "locked", retryAfterMs: 60_000 });

  advance(60_000);
  const afterLock = pairing.status(); // lock lifted, and a fresh code is on screen with it
  assert.equal(afterLock.lockedUntilMs, 0);
  // Counter reset: one more mistake leaves two attempts, not zero.
  assert.deepEqual(pairing.verify(wrongPinFor(afterLock.pin)), {
    kind: "invalid_pin",
    attemptsLeft: 2,
  });
  assert.equal(pairing.verify(afterLock.pin).kind, "paired");
});

test("a token is accepted exactly once and dies with its session", () => {
  const { pairing } = harness();
  const { token, sessionId } = paired(pairing);
  assert.match(token, /^[0-9a-f]{64}$/);

  assert.equal(pairing.consume("0".repeat(64)), null);
  assert.equal(pairing.consume(null), null);
  assert.equal(pairing.consume(token.slice(0, 63)), null);

  assert.equal(pairing.consume(token), sessionId);
  assert.equal(pairing.consume(token), null); // replay
  assert.equal(pairing.status().viewer?.connected, true);

  pairing.revoke(sessionId);
  assert.equal(pairing.consume(token), null);
  assert.equal(pairing.status().viewer, null);
});

test("only one viewer at a time, and revoking frees the seat", () => {
  const { pairing } = harness();
  const first = paired(pairing);
  assert.equal(pairing.status().viewer?.id, first.sessionId);
  assert.equal(pairing.status().viewer?.connected, false);

  // Busy is decided before the PIN is even looked at, so a correct code changes nothing.
  assert.deepEqual(pairing.verify(pairing.status().pin), { kind: "busy" });

  pairing.revoke(first.sessionId);
  assert.equal(pairing.verify(pairing.status().pin).kind, "paired");
});

test("a viewer that never connects loses the seat, and the token with it", () => {
  const { pairing, advance } = harness();
  const first = paired(pairing);

  advance(30_000);
  assert.equal(pairing.consume(first.token), null);
  assert.equal(pairing.status().viewer, null);
  assert.equal(pairing.verify(pairing.status().pin).kind, "paired");
});

test("a connected viewer keeps the seat past the connect deadline", () => {
  const { pairing, advance } = harness();
  const first = paired(pairing);
  assert.equal(pairing.consume(first.token), first.sessionId);

  advance(10 * 60_000);
  assert.deepEqual(pairing.status().viewer, { id: first.sessionId, connected: true });
  assert.deepEqual(pairing.verify(pairing.status().pin), { kind: "busy" });
});

test("junk at the trust boundary is an invalid attempt, never an exception", () => {
  const { pairing } = harness();
  const junk: unknown[] = [
    undefined,
    null,
    42,
    0,
    {},
    { toString: () => "123456" },
    [],
    "",
    "12345",
    "1234567",
    "abcdef",
    "12345x",
    " 12345",
    "١٢٣٤٥٦",
  ];
  for (const input of junk) {
    const result = pairing.verify(input);
    assert.ok(
      result.kind === "invalid_pin" || result.kind === "locked",
      `unexpected result for ${String(input)}: ${result.kind}`,
    );
  }
  assert.equal(pairing.status().viewer, null);
});
