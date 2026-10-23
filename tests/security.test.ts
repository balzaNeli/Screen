import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { startServer, type RunningServer } from "../src/server/http.ts";
import { createPairing, type Pairing } from "../src/server/pairing.ts";

const SECRET = "host-private-notes";
const CSP_PARTS = [
  "default-src 'self'",
  "connect-src 'self' ws:",
  "img-src 'self' data:",
  "media-src blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
];

type Fixture = { root: string; webRoot: string; docsRoot: string };

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "screenmirror-security-"));
  const webRoot = path.join(root, "dist");
  const docsRoot = path.join(root, "docs");
  await mkdir(path.join(webRoot, "viewer"), { recursive: true });
  await mkdir(path.join(webRoot, "assets"), { recursive: true });
  await mkdir(docsRoot, { recursive: true });
  await writeFile(path.join(root, SECRET + ".txt"), SECRET);
  await writeFile(path.join(webRoot, "viewer", "index.html"), "<h1>viewer</h1>");
  await writeFile(path.join(webRoot, "assets", "app.js"), "export const ok = 1;\n");
  await writeFile(path.join(docsRoot, "silk-probe.html"), "<h1>probe</h1>");
  await writeFile(path.join(docsRoot, "silk-probe.js"), "// probe\n");
  await writeFile(path.join(docsRoot, "silk-probe.css"), "body { color: #fff; }\n");
  return { root, webRoot, docsRoot };
}

async function securityServer(
  t: { after: (fn: () => Promise<void>) => void },
): Promise<{ base: string; pairing: Pairing; server: RunningServer }> {
  const { root, webRoot, docsRoot } = await fixture();
  const pairing = createPairing();
  const server = await startServer({ port: 0, host: "127.0.0.1", webRoot, docsRoot, pairing });
  t.after(async () => {
    await server.close();
    await rm(root, { recursive: true, force: true });
  });
  return { base: `http://127.0.0.1:${server.port}`, pairing, server };
}

function assertSecure(res: Response, label: string): void {
  const csp = res.headers.get("content-security-policy") ?? "";
  for (const part of CSP_PARTS) assert.ok(csp.includes(part), `${label}: CSP missing ${part}`);
  assert.equal(res.headers.get("x-content-type-options"), "nosniff", label);
  assert.equal(res.headers.get("referrer-policy"), "no-referrer", label);
  assert.equal(res.headers.get("cache-control"), "no-store", label);
}

test("every HTTP response carries the security headers, including 404s and errors", async (t) => {
  const { base, pairing } = await securityServer(t);
  const pin = pairing.status().pin;
  const wrong = pin === "000000" ? "000001" : "000000";
  const pair = (value: string) =>
    fetch(`${base}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: value }),
    });

  const cases: [label: string, path: string, init: RequestInit | undefined, status: number][] = [
    ["viewer", "/", undefined, 200],
    ["asset", "/assets/app.js", undefined, 200],
    ["info", "/api/info", undefined, 200],
    ["pair malformed", "/api/pair", { method: "POST", body: "not json" }, 400],
    ["pair wrong", "/api/pair", { method: "POST", body: JSON.stringify({ pin: wrong }) }, 401],
    ["pair method", "/api/pair", undefined, 405],
    ["probe", "/probe", undefined, 200],
    ["probe script", "/probe.js", undefined, 200],
    ["probe style", "/probe.css", undefined, 200],
    ["missing", "/missing", undefined, 404],
    ["traversal", "/assets/%2e%2e%2fsecret.txt", undefined, 404],
    ["info method", "/api/info", { method: "POST" }, 405],
  ];

  for (const [label, route, init, status] of cases) {
    const res = await fetch(base + route, init);
    assert.equal(res.status, status, label);
    assertSecure(res, label);
    await res.text();
  }

  const paired = await pair(pin);
  assert.equal(paired.status, 200);
  assertSecure(paired, "pair accepted");
  await paired.text();

  const busy = await pair(pin);
  assert.equal(busy.status, 409);
  assertSecure(busy, "pair busy");
  await busy.text();
});

test("only the issuing response contains the token; no response contains the PIN or host secret", async (t) => {
  const { base, pairing, server } = await securityServer(t);
  const pin = pairing.status().pin;
  const wrong = pin === "000000" ? "000001" : "000000";
  const pair = (value: string) =>
    fetch(`${base}/api/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pin: value }),
    });

  const routes = [
    "/",
    "/assets/app.js",
    "/api/info",
    "/probe",
    "/probe.js",
    "/probe.css",
    "/missing",
    "/assets/%2e%2e%2fsecret.txt",
  ];
  const bodies: [string, string][] = await Promise.all(
    routes.map(async (route): Promise<[string, string]> => [
      route,
      await (await fetch(base + route)).text(),
    ]),
  );

  const rejected = await pair(wrong);
  assert.equal(rejected.status, 401);
  bodies.push(["/api/pair rejected", await rejected.text()]);

  const accepted = await pair(pin);
  assert.equal(accepted.status, 200);
  const acceptedBody = await accepted.text();
  const { token } = JSON.parse(acceptedBody) as { token: string };
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(JSON.parse(acceptedBody) as Record<string, unknown>), ["token"]);
  assert.ok(!acceptedBody.includes(pin), "the accepted response leaked the PIN");

  const busy = await pair(pin);
  assert.equal(busy.status, 409);
  bodies.push(["/api/pair busy", await busy.text()]);

  for (const [label, body] of bodies) {
    assert.ok(!body.includes(pin), `${label} leaked the live PIN`);
    assert.ok(!body.includes(token), `${label} leaked the issued token`);
    assert.ok(!body.includes(server.hostToken), `${label} leaked the host boot token`);
    assert.ok(!body.includes(SECRET), `${label} leaked a file outside the web root`);
  }
});
