export type ConnectionPhase = "connecting" | "connected" | "reconnecting" | "lost";

export type ConnectionState = { phase: ConnectionPhase; restarts: number };

export type ConnectionEvent = "connected" | "failed" | "timeout";

export const initialConnection: ConnectionState = { phase: "connecting", restarts: 0 };

/** One ICE restart per failure; a second failure, or a timeout, ends in the reconnect screen. */
export function connectionReducer(
  state: ConnectionState,
  event: ConnectionEvent,
): ConnectionState {
  if (event === "connected") {
    return state.phase === "connected" && state.restarts === 0
      ? state
      : { phase: "connected", restarts: 0 };
  }
  if (event === "failed") {
    return state.restarts === 0
      ? { phase: "reconnecting", restarts: 1 }
      : { phase: "lost", restarts: state.restarts };
  }
  return state.phase === "reconnecting" ? { phase: "lost", restarts: state.restarts } : state;
}
