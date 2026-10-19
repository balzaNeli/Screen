import type { Signal } from "./protocol.ts";

/** The typed contract between the preload bridge and the main process. Runtime-free. */

export type SourceInfo = { id: string; name: string; kind: "screen" | "window" };

export type Quality = "native" | "1080p" | "720p";

export type StartRequest = { sourceId: string; quality: Quality; audio: boolean };

export type HostState = {
  urls: string[];
  pin: string;
  qrDataUrl: string;
  expiresAt: number;
  viewer: { userAgent: string } | null;
  audio: boolean;
  error: string | null;
};

/** Exactly the surface `preload.cts` exposes on `window.mirror`, and nothing else. */
export type MirrorApi = {
  listSources: () => Promise<SourceInfo[]>;
  capabilities: () => Promise<{ audio: boolean }>;
  start: (req: StartRequest) => Promise<{ audio: boolean }>;
  setAudio: (on: boolean) => Promise<boolean>;
  stop: () => void;
  onSignal: (cb: (signal: Signal) => void) => void;
  sendSignal: (signal: Signal) => void;
  onState: (cb: (state: HostState) => void) => void;
};

const QUALITIES: ReadonlySet<Quality> = new Set(["native", "1080p", "720p"]);

/** IPC payload check: rebuild the value so a malformed renderer request cannot ride along. */
export function parseStartRequest(value: unknown): StartRequest | null {
  if (typeof value !== "object" || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.sourceId !== "string" || v.sourceId.length === 0 || v.sourceId.length > 256) {
    return null;
  }
  if (!QUALITIES.has(v.quality as Quality) || typeof v.audio !== "boolean") return null;
  return { sourceId: v.sourceId, quality: v.quality as Quality, audio: v.audio };
}
