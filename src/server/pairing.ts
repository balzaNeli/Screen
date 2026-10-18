import { randomBytes, randomInt, timingSafeEqual } from "node:crypto";

/**
 * Pairing store. Pure and injectable (clock only), so tests need no timers and the host UI can
 * poll `status()` for a countdown. Nothing here logs and nothing here serialises the PIN — what
 * may leave the process is the HTTP layer's decision, and it is always "not the PIN".
 *
 * Spec rules: 6-digit PIN, TTL 60 s, rotation on expiry and on the 3rd failure followed by a
 * 60 s lockout, one viewer at a time, single-use tokens bound to a session id.
 */

export type PairingResult =
  | { kind: "paired"; token: string; sessionId: string }
  | { kind: "invalid_pin"; attemptsLeft: number }
  | { kind: "expired" }
  | { kind: "locked"; retryAfterMs: number }
  | { kind: "busy" };

export type ViewerSession = { id: string; connected: boolean };

export type PairingStatus = {
  pin: string;
  expiresAtMs: number;
  lockedUntilMs: number;
  viewer: ViewerSession | null;
};

export type PairingOptions = {
  now?: () => number;
  pinTtlMs?: number;
  lockoutMs?: number;
  /** A viewer that never connects must not hold the only seat forever. */
  connectTtlMs?: number;
  maxFailures?: number;
};

export type Pairing = {
  status: () => PairingStatus;
  verify: (pin: unknown) => PairingResult;
  consume: (token: unknown) => string | null;
  revoke: (sessionId: string) => void;
};

const PIN_SPACE = 1_000_000;

/** Compares two secrets without an early exit. Both are fixed-length by construction. */
function sameSecret(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function createPairing(options: PairingOptions = {}): Pairing {
  const now = options.now ?? Date.now;
  const pinTtlMs = options.pinTtlMs ?? 60_000;
  const lockoutMs = options.lockoutMs ?? 60_000;
  const connectTtlMs = options.connectTtlMs ?? 30_000;
  const maxFailures = options.maxFailures ?? 3;

  let pin = newPin();
  let expiresAtMs = now() + pinTtlMs;
  let lockedUntilMs = 0;
  let failures = 0;
  let session: (ViewerSession & { token: string; connectByMs: number }) | null = null;

  function newPin(): string {
    return String(randomInt(0, PIN_SPACE)).padStart(6, "0");
  }

  function rotate(at: number): void {
    pin = newPin();
    expiresAtMs = at + pinTtlMs;
  }

  /** Drops expired state so every public call sees the same, current world. */
  function sweep(): number {
    const at = now();
    if (lockedUntilMs !== 0 && at >= lockedUntilMs) {
      lockedUntilMs = 0;
      failures = 0;
    }
    if (session !== null && !session.connected && at >= session.connectByMs) session = null;
    return at;
  }

  function status(): PairingStatus {
    const at = sweep();
    if (at >= expiresAtMs) rotate(at);
    return {
      pin,
      expiresAtMs,
      lockedUntilMs,
      viewer: session === null ? null : { id: session.id, connected: session.connected },
    };
  }

  function verify(input: unknown): PairingResult {
    const at = sweep();
    if (lockedUntilMs !== 0) return { kind: "locked", retryAfterMs: lockedUntilMs - at };
    if (session !== null) return { kind: "busy" };
    if (at >= expiresAtMs) {
      // The viewer could not have known the new code yet: not their fault, not an attempt.
      rotate(at);
      return { kind: "expired" };
    }
    if (typeof input === "string" && sameSecret(input, pin)) {
      const created = {
        id: randomBytes(8).toString("hex"),
        token: randomBytes(32).toString("hex"),
        connectByMs: at + connectTtlMs,
        connected: false,
      };
      session = created;
      failures = 0;
      rotate(at); // this code has done its job; the next viewer gets a fresh one
      return { kind: "paired", token: created.token, sessionId: created.id };
    }
    failures += 1;
    if (failures >= maxFailures) {
      lockedUntilMs = at + lockoutMs;
      failures = 0;
      rotate(at);
      return { kind: "locked", retryAfterMs: lockoutMs };
    }
    return { kind: "invalid_pin", attemptsLeft: maxFailures - failures };
  }

  function consume(token: unknown): string | null {
    const at = sweep();
    if (session === null || session.connected || at >= session.connectByMs) return null;
    if (typeof token !== "string" || !sameSecret(token, session.token)) return null;
    session.connected = true;
    return session.id;
  }

  function revoke(sessionId: string): void {
    if (session !== null && session.id === sessionId) session = null;
  }

  return { status, verify, consume, revoke };
}
