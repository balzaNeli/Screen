import assert from "node:assert/strict";
import test from "node:test";

import { startServer, type RunningServer } from "../src/server/http.ts";
import { createPairing, type Pairing } from "../src/server/pairing.ts";
import type { Signal } from "../src/shared/protocol.ts";
import { fakePeer, type FakePeer } from "./fixtures/fake-peer.ts";

const HOST_TOKEN = "host-token-for-tests";
const OFFER: Signal = { type: "offer", sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\n" };
const ANSWER: Signal = { type: "answer", sdp: "v=0\r\n" };
const CANDIDATE: Signal = {
  type: "ice",
  candidate: { candidate: "candidate:1 1 udp 2 192.168.15.6 5000 typ host", sdpMid: "0", sdpMLineIndex: 0 },
};

type Rig = {
  pairing: Pairing;
  server: RunningServer;
  http: string;
  ws: string;
  /** What the host window would have been told, in order. */
  notifications: Array<{ sessionId: string; userAgent: string } | null>;
  /** Pair over HTTP the way the viewer page does, and return the single-use token. */
  token: () => Promise<string>;
  host: () => FakePeer;
  viewer: (token: string, options?: { origin?: string }) => FakePeer;
};

async function rig(t: { after: (fn: () => Promise<void> | void) => void }): Promise<Rig> {
  const pairing = createPairing();
  const server = await startServer({ port: 0, host: "127.0.0.1", pairing, hostToken: HOST_TOKEN });
  t.after(() => server.close());

  const notifications: Rig["notifications"] = [];
  server.onViewerChange((viewer) => notifications.push(viewer));

  const http = `http://127.0.0.1:${server.port}`;
  const ws = `ws://127.0.0.1:${server.port}/ws`;

  return {
    pairing,
    server,
    http,
    ws,
    notifications,
    token: async () => {
      const res = await fetch(`${http}/api/pair`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin: pairing.status().pin }),
      });
      assert.equal(res.status, 200);
      return ((await res.json()) as { token: string }).token;
    },
    host: () => fakePeer(`${ws}?host=${HOST_TOKEN}`),
    viewer: (token, options = {}) => fakePeer(`${ws}?token=${token}`, options),
  };
}

test("relays offer, answer and candidates in both directions", async (t) => {
  const r = await rig(t);
  const host = r.host();
  await host.opened();
  const viewer = r.viewer(await r.token());
  await viewer.opened();

  const sessionId = r.pairing.status().viewer?.id;
  assert.ok(sessionId !== undefined && sessionId !== null);

  host.send(OFFER);
  assert.deepEqual(await viewer.next(), OFFER);

  viewer.send(ANSWER);
  assert.deepEqual(await host.next(), ANSWER);

  host.send(CANDIDATE);
  viewer.send(CANDIDATE);
  assert.deepEqual(await viewer.next(), CANDIDATE);
  assert.deepEqual(await host.next(), CANDIDATE);

  assert.equal(r.notifications.length, 1);
  assert.equal(r.notifications[0]?.sessionId, sessionId);
  assert.equal(typeof r.notifications[0]?.userAgent, "string");
});

test("refuses a socket with no token and a socket with the wrong host token", async (t) => {
  const r = await rig(t);

  const naked = fakePeer(r.ws);
  assert.equal(await naked.closed(), 1008);
  assert.equal(r.pairing.status().viewer, null, "a refused socket must not create a session");

  const impostor = fakePeer(`${r.ws}?host=not-the-token`);
  assert.equal(await impostor.closed(), 1008);

  const host = r.host();
  await host.opened();
});

test("refuses a replayed pairing token: one seat, one viewer", async (t) => {
  const r = await rig(t);
  const token = await r.token();

  const first = r.viewer(token);
  await first.opened();

  const replay = r.viewer(token);
  assert.equal(await replay.closed(), 1008);
  assert.equal(r.pairing.status().viewer?.connected, true);
});

test("refuses a socket opened from a foreign origin", async (t) => {
  const r = await rig(t);
  const token = await r.token();

  const foreign = r.viewer(token, { origin: "http://evil.example" });
  assert.equal(await foreign.closed(), 1008);

  // The refusal happened before the token was spent: an honest viewer can still use it.
  const honest = r.viewer(token);
  await honest.opened();
});

test("drops garbage without ending the session", async (t) => {
  const r = await rig(t);
  const host = r.host();
  await host.opened();
  const viewer = r.viewer(await r.token());
  await viewer.opened();

  viewer.sendRaw("not json at all");
  viewer.sendRaw('{"type":"nope"}');
  viewer.sendRaw('{"type":"offer"}');
  viewer.sendRaw("{}");

  const good: Signal = { type: "ice", candidate: { candidate: "candidate:2 1 udp 1 127.0.0.1 9 typ host" } };
  viewer.send(good);
  assert.deepEqual(await host.next(), good, "the first thing the host sees is the good frame");
});

test("host stop reaches the viewer, ends the session and frees the seat", async (t) => {
  const r = await rig(t);
  const host = r.host();
  await host.opened();
  const viewer = r.viewer(await r.token());
  await viewer.opened();
  const sessionId = r.pairing.status().viewer?.id;

  const stop: Signal = { type: "stop", reason: "host stopped" };
  host.send(stop);

  assert.deepEqual(await viewer.next(), stop);
  assert.equal(await viewer.closed(), 1000);
  assert.equal(await host.closed(), 1000);
  assert.equal(r.pairing.status().viewer, null, "the seat must be free for the next viewer");
  assert.equal(r.notifications.length, 2);
  assert.equal(r.notifications[0]?.sessionId, sessionId);
  assert.equal(r.notifications[1], null);
});

test("a dead viewer wakes the host with bye, and the next viewer can pair immediately", async (t) => {
  const r = await rig(t);
  const host = r.host();
  await host.opened();
  const viewer = r.viewer(await r.token());
  await viewer.opened();

  viewer.kill();

  assert.deepEqual(await host.next(), { type: "bye" });
  assert.equal(await host.closed(), 1000);
  assert.equal(r.pairing.status().viewer, null);

  const next = r.viewer(await r.token());
  await next.opened();
  assert.equal(r.pairing.status().viewer?.connected, true);
  assert.deepEqual(
    r.notifications.map((n) => (n === null ? "left" : "joined")),
    ["joined", "left", "joined"],
  );
});

test("an oversized frame closes the socket instead of the process", async (t) => {
  const r = await rig(t);
  const host = r.host();
  await host.opened();
  const viewer = r.viewer(await r.token());
  await viewer.opened();

  viewer.sendRaw(JSON.stringify({ type: "offer", sdp: "x".repeat(300 * 1024) }));

  assert.equal(await viewer.closed(), 1009);
  assert.equal(await host.closed(), 1000);
  assert.equal(r.pairing.status().viewer, null);
});

test("a second host socket replaces the first", async (t) => {
  const r = await rig(t);
  const first = r.host();
  await first.opened();

  const second = r.host();
  await second.opened();

  assert.equal(await first.closed(), 1008);
});
