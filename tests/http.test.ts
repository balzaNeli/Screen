import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { startServer, type RunningServer } from "../src/server/http.ts";
import { createPairing, type Pairing } from "../src/server/pairing.ts";

const SECRET = "host-private-notes";

/** A throwaway web root, plus a secret file one level above it that must never be reachable. */
async function fixture(): Promise<{ root: string; webRoot: string; docsRoot: string }> {
  const root = await mkdtemp(path.join(tmpdir(), "screenmirror-"));
  const webRoot = path.join(root, "dist");
  const docsRoot = path.join(root, "docs");
  await mkdir(path.join(webRoot, "viewer"), { recursive: true });
  await mkdir(path.join(webRoot, "assets"), { recursive: true });
  await mkdir(docsRoot, { recursive: true });
  await writeFile(path.join(root, SECRET + ".txt"), SECRET);
  await writeFile(path.join(webRoot, "viewer", "index.html"), "<h1>viewer</h1>");
  await writeFile(path.join(webRoot, "assets", "app.js"), "export const ok = 1;\n");
  await writeFile(path.join(docsRoot, "silk-probe.html"), "<h1>probe fixture</h1>");
  return { root, webRoot, docsRoot };
}

async function withServer(
  t: { after: (fn: () => Promise<void>) => void },
  fixturePaths: { webRoot: string; docsRoot: string },
  run: (base: string, server: RunningServer) => Promise<void>,
): Promise<void> {
  const server = await startServer({ port: 0, host: "127.0.0.1", ...fixturePaths });
  t.after(async () => {
    await server.close();
  });
  await run(`http://127.0.0.1:${server.port}`, server);
}

/** A server whose pairing store the test can drive: it knows the live PIN and can move the clock. */
async function pairingServer(
  t: { after: (fn: () => Promise<void> | void) => void },
  options: { now?: () => number } = {},
): Promise<{ base: string; pairing: Pairing; server: RunningServer }> {
  const { root, webRoot, docsRoot } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const pairing = createPairing(options);
  const server = await startServer({ port: 0, host: "127.0.0.1", webRoot, docsRoot, pairing });
  t.after(async () => {
    await server.close();
  });
  return { base: `http://127.0.0.1:${server.port}`, pairing, server };
}

test("serves the viewer page and its assets with security headers", async (t) => {
  const { root, ...roots } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await withServer(t, roots, async (base) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-type") ?? "", /text\/html/);
    assert.match(page.headers.get("content-security-policy") ?? "", /default-src 'self'/);
    assert.match(page.headers.get("content-security-policy") ?? "", /media-src blob:/, "MediaSource needs blob: (Branch B and the probe)");
    assert.equal(page.headers.get("x-content-type-options"), "nosniff");
    assert.equal(page.headers.get("referrer-policy"), "no-referrer");
    assert.match(await page.text(), /viewer/);

    const asset = await fetch(`${base}/assets/app.js`);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get("content-type") ?? "", /javascript/);
    assert.match(await asset.text(), /export const ok/);
  });
});

test("never serves a file outside the web root", async (t) => {
  const { root, ...roots } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await withServer(t, roots, async (base) => {
    const attempts = [
      "/assets/../secret.txt",
      "/assets/../../secret.txt",
      "/assets/%2e%2e%2fsecret.txt",
      "/assets/..%2fsecret.txt",
      "/assets/%2e%2e%5csecret.txt",
      "/assets/....//secret.txt",
      "/assets/subdir/../../secret.txt",
    ];
    for (const attempt of attempts) {
      const res = await fetch(base + attempt, { redirect: "manual" });
      assert.equal(res.status, 404, `must 404: ${attempt}`);
      assert.ok(!(await res.text()).includes(SECRET), `must not leak: ${attempt}`);
    }
  });
});

test("rejects unknown routes and non-GET methods without leaking internals", async (t) => {
  const { root, ...roots } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await withServer(t, roots, async (base) => {
    const missing = await fetch(`${base}/nope`);
    assert.equal(missing.status, 404);
    assert.ok(!(await missing.text()).includes("at "), "404 body must not look like a stack trace");

    const posted = await fetch(`${base}/api/info`, { method: "POST" });
    assert.equal(posted.status, 405);
  });
});

test("/api/info reports status and never a secret", async (t) => {
  const { root, ...roots } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await withServer(t, roots, async (base) => {
    const res = await fetch(`${base}/api/info`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body.name, "screenmirror");
    assert.equal(typeof body.version, "string");
    assert.equal(body.pairingOpen, true);
    assert.equal(body.lockedUntilMs, 0);
    assert.deepEqual(Object.keys(body).sort(), ["lockedUntilMs", "name", "pairingOpen", "version"]);
  });
});

test("serves the probe page from the docs root", async (t) => {
  const { root, ...roots } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  await withServer(t, roots, async (base) => {
    const res = await fetch(`${base}/probe`);
    assert.equal(res.status, 200);
    assert.match(await res.text(), /probe fixture/);
  });
});

test("serves the real probe page with its own script and stylesheet, and nothing else", async (t) => {
  const { root, webRoot } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  // Real docs/ directory, throwaway web root: the probe must never depend on a build.
  const server = await startServer({ port: 0, host: "127.0.0.1", webRoot });
  t.after(async () => {
    await server.close();
  });
  const base = `http://127.0.0.1:${server.port}`;

  const page = await (await fetch(`${base}/probe`)).text();
  assert.match(page, /<script src="\/probe\.js">/);
  assert.match(page, /<link rel="stylesheet" href="\/probe\.css"/);
  assert.ok(!/(src|href)="https?:/.test(page), "the probe must not load anything from the internet");

  const script = await fetch(`${base}/probe.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type") ?? "", /javascript/);
  assert.match(await script.text(), /RTCPeerConnection/);

  const style = await fetch(`${base}/probe.css`);
  assert.equal(style.status, 200);
  assert.match(style.headers.get("content-type") ?? "", /css/);

  // The docs directory is not a web root: only the three known names are reachable.
  assert.equal((await fetch(`${base}/silk-probe.html`)).status, 404);
  assert.equal((await fetch(`${base}/probe.html`)).status, 404);
  assert.equal((await fetch(`${base}/probe.css/../silk-probe.html`)).status, 404);
});

test("falls back to an ephemeral port when the requested one is taken", async (t) => {
  const { root, ...roots } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const first = await startServer({ port: 0, host: "127.0.0.1", ...roots });
  const second = await startServer({ port: first.port, host: "127.0.0.1", ...roots });
  t.after(async () => {
    await first.close();
    await second.close();
  });

  assert.notEqual(second.port, first.port);
  const res = await fetch(`http://127.0.0.1:${second.port}/api/info`);
  assert.equal(res.status, 200);
});

test("closing the server releases the port", async (t) => {
  const { root, ...roots } = await fixture();
  t.after(() => rm(root, { recursive: true, force: true }));

  const server = await startServer({ port: 0, host: "127.0.0.1", ...roots });
  await server.close();
  await assert.rejects(() => fetch(`http://127.0.0.1:${server.port}/api/info`));
});

test("POST /api/pair: wrong PIN, three strikes, lockout, and the PIN is never echoed", async (t) => {
  let clock = 1_000_000;
  const { base, pairing } = await pairingServer(t, { now: () => clock });
  const pin = pairing.status().pin;
  const wrong = pin === "000000" ? "000001" : "000000";
  const pair = (value: unknown) =>
    fetch(`${base}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: value }),
    });

  const bodies: string[] = [];
  const collect = async (res: Response): Promise<string> => {
    const text = await res.text();
    if (!res.ok) bodies.push(text); // the 200 body is the token itself; the others must not carry it
    return text;
  };

  assert.equal((await pair(wrong)).status, 401);
  const second = await pair(wrong);
  assert.equal(second.status, 401);
  assert.deepEqual(JSON.parse(await collect(second)), { error: "invalid_pin", attemptsLeft: 1 });

  const third = await pair(wrong);
  assert.equal(third.status, 429);
  const locked = JSON.parse(await collect(third)) as { error: string; retryAfterMs: number };
  assert.equal(locked.error, "locked");
  assert.ok(locked.retryAfterMs > 0);

  // The right PIN does not open a locked door either, and the refusal costs no attempt.
  assert.equal((await pair(pin)).status, 429);

  clock += 60_000; // the lockout expires, and a fresh PIN is on screen with it
  const fresh = pairing.status();
  assert.equal(fresh.lockedUntilMs, 0);
  assert.notEqual(fresh.pin, pin);

  const accepted = await pair(fresh.pin);
  assert.equal(accepted.status, 200);
  const acceptedBody = (await accepted.json()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(acceptedBody), ["token"]);
  const token = String(acceptedBody.token);
  assert.match(token, /^[0-9a-f]{64}$/);

  // The PIN must never appear in a response body; the token only in the 200 that carries it.
  for (const body of bodies) {
    assert.ok(!body.includes(fresh.pin), `leaked the PIN: ${body}`);
    assert.ok(!body.includes(token), `leaked the token: ${body}`);
  }
});

test("POST /api/pair: one viewer at a time, the token survives the refusal, revoke frees it", async (t) => {
  const { base, pairing } = await pairingServer(t);
  const pair = (value: unknown) =>
    fetch(`${base}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: value }),
    });

  const first = await pair(pairing.status().pin);
  assert.equal(first.status, 200);
  const { token } = (await first.json()) as { token: string };
  const sessionId = pairing.status().viewer?.id ?? "";

  // A second viewer is refused while the seat is taken, and the issued token still works.
  assert.equal((await pair(pairing.status().pin)).status, 409);
  assert.equal(pairing.consume(token), sessionId);

  const info = (await (await fetch(`${base}/api/info`)).json()) as Record<string, unknown>;
  assert.equal(info.pairingOpen, false);

  pairing.revoke(sessionId);
  const after = (await (await fetch(`${base}/api/info`)).json()) as Record<string, unknown>;
  assert.equal(after.pairingOpen, true);
});

test("POST /api/pair: malformed bodies are 400 and are never counted as attempts", async (t) => {
  const { base, pairing } = await pairingServer(t);
  const post = (body: string) => fetch(`${base}/api/pair`, { method: "POST", body });

  const junk = [
    "",
    "not json",
    "null",
    "[]",
    '"123456"',
    "{}",
    '{"pin":42}',
    '{"pin":null}',
    '{"pin":{}}',
    '{"pin":["1","2","3","4","5","6"]}',
    JSON.stringify({ extra: "x".repeat(5000) }), // over the 4 KB body limit
  ];
  for (const body of junk) {
    const res = await post(body);
    assert.equal(res.status, 400, `must be a bad request: ${body.slice(0, 40)}`);
  }

  // A flood of bad requests must not lock the host out of its own pairing screen.
  for (let i = 0; i < 1000; i++) {
    const res = await post("{}");
    assert.equal(res.status, 400, `request ${i} must be rejected as malformed`);
  }
  const state = pairing.status();
  assert.equal(state.lockedUntilMs, 0);
  assert.equal(state.viewer, null);

  const alive = await fetch(`${base}/api/info`);
  assert.equal(alive.status, 200);

  // And the next real attempt still gets its full three tries.
  const wrong = pairing.status().pin === "000000" ? "000001" : "000000";
  const attempt = await fetch(`${base}/api/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pin: wrong }),
  });
  assert.equal(attempt.status, 401);
  assert.deepEqual(await attempt.json(), { error: "invalid_pin", attemptsLeft: 2 });
});
