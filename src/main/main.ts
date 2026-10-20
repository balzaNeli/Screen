import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { app, BrowserWindow, dialog, session, type WebContents } from "electron";
import { toDataURL } from "qrcode";
import { WebSocket } from "ws";

import type { HostState } from "../shared/ipc.ts";
import { parseSignal, type Signal } from "../shared/protocol.ts";
import { startServer, type RunningServer } from "../server/http.ts";
import { lanAddresses } from "../server/lan.ts";
import { createPairing, type Pairing } from "../server/pairing.ts";
import type { ViewerInfo } from "../server/ws.ts";
import { createCaptureTarget, installDisplayMediaHandler } from "./display-media.ts";
import { registerIpc } from "./ipc.ts";
import { pairUrl, primaryUrl } from "./qr.ts";

// Must be set before app.whenReady: mDNS ICE candidates are the classic LAN-WebRTC failure.
app.commandLine.appendSwitch("disable-features", "WebRtcHideLocalIpsWithMdns");

const here = path.dirname(fileURLToPath(import.meta.url)); // dist/main
const repoRoot = path.resolve(here, "../..");
const hostPage = path.join(repoRoot, "dist", "renderer", "index.html");
const hostUrl = pathToFileURL(hostPage).href;
const preloadPath = path.join(repoRoot, "dist", "preload", "preload.cjs");

const capture = createCaptureTarget();
let pairing: Pairing | null = null;
let server: RunningServer | null = null;
let window: BrowserWindow | null = null;
let hostSocket: WebSocket | null = null;
let viewer: ViewerInfo | null = null;
let stateTimer: NodeJS.Timeout | null = null;
let quitting = false;
let qrDataUrl = "";
let qrPayload = "";
let qrError: string | null = null;

/** Main renders the QR; regenerate when the address or PIN changes and never show the old one. */
function refreshQr(base: string | null, pin: string): void {
  const payload = base === null || pin === "" ? "" : pairUrl(base, pin);
  if (payload === qrPayload) return;
  qrPayload = payload;
  qrDataUrl = "";
  qrError = null;
  if (payload === "") return;

  void toDataURL(payload, { errorCorrectionLevel: "M", margin: 4, width: 320 })
    .then((next) => {
      if (qrPayload !== payload) return;
      qrDataUrl = next;
      pushState();
    })
    .catch(() => {
      if (qrPayload !== payload) return;
      qrError = "Could not render the pairing QR code. Use the URL and PIN above.";
      pushState();
    });
}

function hostState(): HostState {
  const status = pairing?.status() ?? null;
  const port = server?.port;
  const urls =
    port === undefined ? [] : lanAddresses().map((address) => `http://${address}:${port}/`);
  const pin = status?.pin ?? "";
  refreshQr(primaryUrl(urls), pin);
  const noLan =
    port !== undefined && urls.length === 0
      ? "No LAN address found. Connect this computer to Wi-Fi or Ethernet."
      : null;
  return {
    urls,
    pin,
    qrDataUrl,
    expiresAt: status?.expiresAtMs ?? 0,
    viewer: viewer === null ? null : { userAgent: viewer.userAgent },
    audio: capture.get()?.audio ?? false,
    error: noLan ?? qrError,
  };
}

function pushState(): void {
  if (quitting || window === null || window.isDestroyed()) return;
  window.webContents.send("mirror:state", hostState());
}

/** Main owns the host socket: the boot token never reaches the renderer. */
function connectHost(port: number, hostToken: string): void {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?host=${hostToken}`);
  hostSocket = socket;

  socket.on("message", (data, isBinary) => {
    if (isBinary) return;
    const signal = parseSignal(data.toString());
    if (signal === null) return;
    if (!quitting && window !== null && !window.isDestroyed()) {
      window.webContents.send("mirror:signal", signal);
    }
  });

  socket.on("close", () => {
    if (hostSocket === socket) hostSocket = null;
    if (quitting) return;
    const retry = setTimeout(() => connectHost(port, hostToken), 500);
    retry.unref();
  });

  socket.on("error", () => undefined); // "close" always follows and schedules the retry
}

function sendToViewer(signal: Signal): void {
  if (hostSocket !== null && hostSocket.readyState === WebSocket.OPEN) {
    hostSocket.send(JSON.stringify(signal));
  }
}

/** display-capture for the host page; every other permission is denied. */
function installPermissions(hostContentsId: number): void {
  const isHost = (contents: WebContents | null): boolean =>
    contents !== null && contents.id === hostContentsId;

  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    // Electron reports getDisplayMedia as a "media" request, not "display-capture". Allow it only
    // for the host page and only while a source is armed; the display-media handler below is what
    // actually authorizes the capture. Any other media request (camera, mic) stays denied.
    const allowed =
      permission === "display-capture"
        ? isHost(contents)
        : permission === "media" && isHost(contents) && capture.get() !== null;
    callback(allowed);
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission) => {
    return permission === "display-capture" && isHost(contents);
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    show: false,
    backgroundColor: "#111111",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });

  win.once("ready-to-show", () => win.show());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.on("closed", () => {
    window = null;
    if (stateTimer !== null) clearInterval(stateTimer);
  });
  return win;
}

async function start(): Promise<void> {
  await app.whenReady();

  if (!existsSync(hostPage) || !existsSync(preloadPath)) {
    dialog.showErrorBox("screenmirror", "Build output is missing.\nRun: npm run build");
    app.quit();
    return;
  }

  try {
    pairing = createPairing();
    server = await startServer({ pairing });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox("screenmirror", `Could not start the LAN server: ${message}`);
    app.quit();
    return;
  }

  server.onViewerChange((info) => {
    viewer = info;
    pushState();
  });

  window = createWindow();
  installPermissions(window.webContents.id);
  installDisplayMediaHandler(session.defaultSession, capture, hostUrl);
  registerIpc({
    getSelection: capture.get,
    setSelection: capture.set,
    sendToViewer,
    pushState,
  });

  window.webContents.once("did-finish-load", pushState);
  stateTimer = setInterval(pushState, 1000);

  window.loadFile(hostPage).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    dialog.showErrorBox("screenmirror", `The host page failed to load: ${message}`);
    app.quit();
  });

  connectHost(server.port, server.hostToken);
}

app.on("window-all-closed", () => app.quit());

app.on("before-quit", () => {
  quitting = true;
  if (stateTimer !== null) clearInterval(stateTimer);
  hostSocket?.close();
  void server?.close().catch(() => undefined);
});

void start();
