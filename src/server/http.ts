import { readFile } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createPairing, type Pairing } from "./pairing.ts";

// Same depth from src/server/ and dist/server/, so this works before and after a build.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);
const { name, version } = require("../../package.json") as { name: string; version: string };

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

// The viewer never fetches anything but its own bundle, and it needs no camera or microphone.
// media-src blob: is for the probe page's loopback test, which plays from an object URL.
const CSP = "default-src 'self'; connect-src 'self' ws:; img-src 'self' data:; media-src blob:; object-src 'none'; base-uri 'none'; form-action 'self'";

/** Diagnostic pages served from docs/. Fixed names only — no path arithmetic, nothing to escape. */
const PROBE_FILES: Record<string, string> = {
  "/probe": "silk-probe.html",
  "/probe.css": "silk-probe.css",
  "/probe.js": "silk-probe.js",
};

export type ServerOptions = {
  port?: number;
  host?: string;
  webRoot?: string;
  docsRoot?: string;
  /** The host window owns the store (it is the only thing allowed to see the PIN). */
  pairing?: Pairing;
};

export type RunningServer = {
  port: number;
  close: () => Promise<void>;
  /** Fires when a viewer has spent a valid PIN, before its socket connects. */
  onPaired: (listener: (sessionId: string) => void) => void;
};

function headers(contentType: string): Record<string, string> {
  return {
    "content-type": contentType,
    "content-security-policy": CSP,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "cache-control": "no-store",
  };
}

function send(res: ServerResponse, status: number, contentType: string, body: string | Buffer): void {
  res.writeHead(status, headers(contentType));
  res.end(body);
}

function sendJson(res: ServerResponse, status: number, value: unknown): void {
  send(res, status, "application/json; charset=utf-8", JSON.stringify(value));
}

/** A pair request is a PIN and nothing else; 4 KB is already generous. */
const MAX_BODY_BYTES = 4096;

/**
 * Reads a small JSON body. Returns null for anything oversized, empty or unparseable, and keeps
 * draining an oversized body so the client still receives its 400 instead of a connection reset.
 */
async function readJson(req: IncomingMessage, limit: number): Promise<unknown> {
  if (Number(req.headers["content-length"] ?? 0) > limit) return null;
  const chunks: Buffer[] = [];
  let size = 0;
  let tooBig = false;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) {
      tooBig = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(buf);
  }
  if (tooBig) return null;
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

/** The only field a pair request may carry. Anything else is a malformed request, not an attempt. */
function pinFrom(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const pin = (body as { pin?: unknown }).pin;
  return typeof pin === "string" ? pin : null;
}

async function handlePair(
  req: IncomingMessage,
  res: ServerResponse,
  pairing: Pairing,
  paired: (sessionId: string) => void,
): Promise<void> {
  const pin = pinFrom(await readJson(req, MAX_BODY_BYTES));
  if (pin === null) return sendJson(res, 400, { error: "bad_request" });

  const result = pairing.verify(pin);
  switch (result.kind) {
    case "paired":
      paired(result.sessionId);
      return sendJson(res, 200, { token: result.token });
    case "invalid_pin":
      return sendJson(res, 401, { error: "invalid_pin", attemptsLeft: result.attemptsLeft });
    case "expired":
      return sendJson(res, 401, { error: "expired" });
    case "locked":
      return sendJson(res, 429, { error: "locked", retryAfterMs: result.retryAfterMs });
    case "busy":
      return sendJson(res, 409, { error: "busy" });
  }
}

/**
 * Resolves a URL path inside `root`, or null if it would land outside it. The containment check
 * runs after normalisation, so encoded, doubled and backslash separators all land here.
 */
function contained(root: string, rel: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(rel);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const abs = path.resolve(root, "." + path.posix.normalize("/" + decoded.replace(/\\/g, "/")));
  return abs === root || abs.startsWith(root + path.sep) ? abs : null;
}

async function sendFile(res: ServerResponse, file: string | null, notFound = "not found"): Promise<void> {
  if (file === null) return send(res, 404, "text/plain", notFound);
  try {
    const body = await readFile(file); // throws on directories and missing files alike
    send(res, 200, MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream", body);
  } catch {
    send(res, 404, "text/plain", notFound);
  }
}

export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const webRoot = path.resolve(options.webRoot ?? path.join(repoRoot, "dist"));
  const docsRoot = path.resolve(options.docsRoot ?? path.join(repoRoot, "docs"));
  const host = options.host ?? "0.0.0.0";
  const pairing = options.pairing ?? createPairing();

  const pairedListeners = new Set<(sessionId: string) => void>();
  const emitPaired = (sessionId: string): void => {
    for (const listener of pairedListeners) listener(sessionId);
  };

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const route = url.pathname;

      if (route === "/api/pair") {
        if (req.method !== "POST") return send(res, 405, "text/plain", "method not allowed");
        await handlePair(req, res, pairing, emitPaired);
        return;
      }
      if (req.method !== "GET") {
        return send(res, 405, "text/plain", "method not allowed");
      }
      if (route === "/") {
        const index = path.join(webRoot, "viewer", "index.html");
        try {
          await readFile(index);
        } catch {
          return send(res, 503, "text/plain", "viewer not built — run: npm run build");
        }
        return sendFile(res, index);
      }
      if (route.startsWith("/assets/")) {
        return sendFile(res, contained(path.join(webRoot, "assets"), route.slice("/assets".length)));
      }
      const probe = PROBE_FILES[route];
      if (probe !== undefined) {
        return sendFile(res, path.join(docsRoot, probe), "probe page missing");
      }
      if (route === "/api/info") {
        const state = pairing.status();
        return sendJson(res, 200, {
          name,
          version,
          pairingOpen: state.viewer === null,
          lockedUntilMs: state.lockedUntilMs,
        });
      }
      send(res, 404, "text/plain", "not found");
    })().catch(() => send(res, 500, "text/plain", "internal error"));
  });

  let port: number;
  try {
    port = await listen(server, options.port ?? 4680, host);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EADDRINUSE") throw err;
    port = await listen(server, 0, host); // the requested port is busy: take any free one
  }
  return {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((err) => (err ? reject(err) : resolve()));
      }),
    onPaired: (listener) => {
      pairedListeners.add(listener);
    },
  };
}

function listen(server: Server, port: number, host: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      resolve(typeof address === "object" && address !== null ? address.port : port);
    });
    server.listen(port, host);
  });
}
