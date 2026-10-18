import { readFile } from "node:fs/promises";
import { createServer, type Server, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
// media-src blob: is for the MediaSource path (Branch B) and for the probe page.
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
};

export type RunningServer = {
  port: number;
  close: () => Promise<void>;
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

  const server: Server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const route = url.pathname;

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
        // shortcut: pairing state is wired in Task 6; until then the server claims it is open.
        const info = { name, version, pairingOpen: true, lockedUntilMs: 0 };
        return send(res, 200, "application/json; charset=utf-8", JSON.stringify(info));
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
