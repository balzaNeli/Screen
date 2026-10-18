/**
 * The wire contract. One envelope shape is used on the WebSocket (host <-> server <-> viewer)
 * and over IPC (main <-> renderer), so nothing has to be translated between transports.
 *
 * The signaling server relays these verbatim and never parses SDP.
 */
export type IceCandidate = {
  candidate: string;
  sdpMid?: string | null;
  sdpMLineIndex?: number | null;
  usernameFragment?: string | null;
};

export type Signal =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: IceCandidate }
  | { type: "stop"; reason: string }
  | { type: "bye" };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Boundary guard for anything arriving over a socket. Returns null instead of throwing, and
 * rebuilds the value so unknown fields cannot ride along.
 */
export function parseSignal(raw: string): Signal | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(value)) return null;

  switch (value.type) {
    case "offer":
    case "answer":
      return typeof value.sdp === "string" ? { type: value.type, sdp: value.sdp } : null;
    case "ice": {
      const c = value.candidate;
      if (!isObject(c) || typeof c.candidate !== "string") return null;
      const candidate: IceCandidate = { candidate: c.candidate };
      if (typeof c.sdpMid === "string" || c.sdpMid === null) candidate.sdpMid = c.sdpMid;
      if (typeof c.sdpMLineIndex === "number" || c.sdpMLineIndex === null) {
        candidate.sdpMLineIndex = c.sdpMLineIndex;
      }
      if (typeof c.usernameFragment === "string" || c.usernameFragment === null) {
        candidate.usernameFragment = c.usernameFragment;
      }
      return { type: "ice", candidate };
    }
    case "stop":
      return typeof value.reason === "string" ? { type: "stop", reason: value.reason } : null;
    case "bye":
      return { type: "bye" };
    default:
      return null;
  }
}
