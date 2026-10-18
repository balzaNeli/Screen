import type { IncomingMessage, Server } from "node:http";

import { WebSocket, WebSocketServer } from "ws";

import { parseSignal } from "../shared/protocol.ts";
import type { Pairing } from "./pairing.ts";

/**
 * The signalling relay. It lives on the same HTTP server as the viewer page, pairs exactly one
 * host socket with one viewer socket, and forwards `Signal` envelopes in both directions. It
 * never reads SDP and never invents a frame.
 *
 * Every access rule fails closed with 1008:
 * - the path must be `/ws`;
 * - a viewer must be same-origin with the page that served it, and must present a single-use
 *   pairing token, which only the HTTP layer issues;
 * - the host page is `file://` (it sends no `Origin`) and must present the boot host token *and*
 *   come from the loopback address. Two independent checks, because the host socket is the only
 *   one that publishes a screen.
 */

const POLICY_VIOLATION = 1008;
const NORMAL = 1000;
const MAX_FRAME_BYTES = 256 * 1024;

export type ViewerInfo = { sessionId: string; userAgent: string };

export type RelayOptions = {
  server: Server;
  pairing: Pairing;
  hostToken: string;
  /** Called when a viewer socket attaches or leaves, so the host window can be pushed new state. */
  onViewerChange?: (viewer: ViewerInfo | null) => void;
};

export type Relay = {
  close: () => Promise<void>;
};

function isLoopback(address: string | undefined): boolean {
  if (address === undefined) return false;
  return address === "::1" || address.startsWith("127.") || address.startsWith("::ffff:127.");
}

/** A browser viewer is served by this same server, so its Origin is the Host it connected to. */
function sameOrigin(request: IncomingMessage): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true; // file:// host page, or a non-browser client
  return origin === `http://${request.headers.host}`;
}

export function attachSignalRelay(options: RelayOptions): Relay {
  const { server, pairing, hostToken } = options;
  const wss = new WebSocketServer({
    server,
    maxPayload: MAX_FRAME_BYTES,
    perMessageDeflate: false, // no point compressing on a TV's CPU, and no zip bombs
  });

  let host: WebSocket | null = null;
  let viewer: { socket: WebSocket; sessionId: string } | null = null;

  // shortcut: a frame sent while its peer is absent is dropped, not buffered. One host and one
  // viewer per session means there is nowhere to hold it, and a missing peer always ends in the
  // teardown below. Upgrade to a bounded queue only if a real ordering bug shows up.
  function deliver(toHost: boolean, frame: string): void {
    const peer = toHost ? host : (viewer?.socket ?? null);
    if (peer !== null && peer.readyState === WebSocket.OPEN) peer.send(frame);
  }

  /** Ends the session: both sockets go, the seat is freed, the host window is told. */
  function closeBoth(reason: string): void {
    const sockets = [host, viewer?.socket ?? null];
    const sessionId = viewer?.sessionId ?? null;
    host = null;
    viewer = null;

    for (const socket of sockets) {
      if (socket !== null && socket.readyState === WebSocket.OPEN) socket.close(NORMAL, reason);
    }
    if (sessionId !== null) {
      pairing.revoke(sessionId);
      options.onViewerChange?.(null);
    }
  }

  /** One side is already gone: say goodbye to the other, then end the session. */
  function drop(by: "host" | "viewer"): void {
    const survivor = by === "host" ? (viewer?.socket ?? null) : host;
    if (survivor !== null && survivor.readyState === WebSocket.OPEN) {
      survivor.send(JSON.stringify({ type: "bye" }));
    }
    closeBoth(by === "host" ? "host left" : "viewer left");
  }

  function identify(
    request: IncomingMessage,
  ): { role: "host" } | { role: "viewer"; sessionId: string } | null {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
    if (url.pathname !== "/ws") return null;
    if (!sameOrigin(request)) return null;

    if (url.searchParams.has("host")) {
      // The token is a boot secret compared on loopback only, where a plain compare is enough.
      if (!isLoopback(request.socket.remoteAddress)) return null;
      return url.searchParams.get("host") === hostToken ? { role: "host" } : null;
    }

    const token = url.searchParams.get("token");
    if (token === null) return null;
    const sessionId = pairing.consume(token); // single use: a replay finds the seat taken
    return sessionId === null ? null : { role: "viewer", sessionId };
  }

  wss.on("connection", (socket, request) => {
    const role = identify(request);
    if (role === null) {
      socket.close(POLICY_VIOLATION, "not authorised");
      return;
    }

    if (role.role === "host") {
      if (host !== null && host.readyState === WebSocket.OPEN) {
        host.close(POLICY_VIOLATION, "replaced"); // one host socket at a time
      }
      host = socket;
    } else {
      viewer = { socket, sessionId: role.sessionId };
      options.onViewerChange?.({
        sessionId: role.sessionId,
        userAgent: request.headers["user-agent"] ?? "",
      });
    }

    socket.on("message", (data, isBinary) => {
      if (isBinary) return;
      const signal = parseSignal((data as Buffer).toString("utf8"));
      if (signal === null) return; // garbage is dropped, and it never kills a session

      if (role.role === "host") {
        deliver(false, JSON.stringify(signal));
        if (signal.type === "stop") closeBoth("host stopped");
      } else {
        deliver(true, JSON.stringify(signal));
      }
    });

    socket.on("close", () => {
      const isCurrent = role.role === "host" ? host === socket : viewer?.socket === socket;
      if (!isCurrent) return; // the peer's teardown already took this socket with it
      drop(role.role);
    });

    // A transport error is always followed by "close", which does the cleanup.
    socket.on("error", () => undefined);
  });

  return {
    close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      closeBoth("server closing");
    },
  };
}
