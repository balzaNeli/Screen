import { WebSocket } from "ws";

import { parseSignal, type Signal } from "../../src/shared/protocol.ts";

/**
 * A minimal signalling peer, for the WebSocket tests and for manual debugging before Electron
 * exists. It sends `Signal` frames and hands them back parsed, so a test reads like the
 * conversation it is checking.
 *
 * Every wait is bounded: a relay that forgets to forward a frame must fail the test, not hang it.
 */

const DEFAULT_TIMEOUT_MS = 2000;

function within<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for ${what}`)), ms);
    timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

export type FakePeer = {
  /** Resolves once the socket is open; rejects if the server refuses it. */
  opened: (timeoutMs?: number) => Promise<void>;
  /** Resolves with the close code the server sent. */
  closed: (timeoutMs?: number) => Promise<number>;
  send: (signal: Signal) => void;
  sendRaw: (raw: string) => void;
  next: (timeoutMs?: number) => Promise<Signal>;
  close: () => void;
  /** Kill the socket without a close handshake, the way dead Wi-Fi does. */
  kill: () => void;
};

export function fakePeer(url: string, options: { origin?: string } = {}): FakePeer {
  const socket = new WebSocket(url, options.origin === undefined ? {} : { origin: options.origin });

  const inbox: Signal[] = [];
  const waiting: Array<(signal: Signal) => void> = [];
  const openWaiters: Array<() => void> = [];
  const closeWaiters: Array<(code: number) => void> = [];
  let open = false;
  let closeCode: number | null = null;

  socket.on("open", () => {
    open = true;
    for (const resolve of openWaiters.splice(0)) resolve();
  });
  socket.on("message", (data) => {
    const signal = parseSignal((data as Buffer).toString("utf8"));
    if (signal === null) return;
    const resolve = waiting.shift();
    if (resolve === undefined) inbox.push(signal);
    else resolve(signal);
  });
  socket.on("close", (code) => {
    closeCode = code;
    for (const resolve of closeWaiters.splice(0)) resolve(code);
  });
  socket.on("error", () => undefined); // a refused upgrade surfaces as "close" below

  return {
    opened: (timeoutMs = DEFAULT_TIMEOUT_MS) =>
      open ? Promise.resolve() : within(new Promise<void>((r) => openWaiters.push(r)), timeoutMs, "open"),
    closed: (timeoutMs = DEFAULT_TIMEOUT_MS) =>
      closeCode === null
        ? within(new Promise<number>((r) => closeWaiters.push(r)), timeoutMs, "close")
        : Promise.resolve(closeCode),
    send: (signal) => socket.send(JSON.stringify(signal)),
    sendRaw: (raw) => socket.send(raw),
    next: (timeoutMs = DEFAULT_TIMEOUT_MS) => {
      const queued = inbox.shift();
      if (queued !== undefined) return Promise.resolve(queued);
      return within(new Promise<Signal>((r) => waiting.push(r)), timeoutMs, "a frame");
    },
    close: () => socket.close(1000, "client done"),
    kill: () => socket.terminate(),
  };
}
