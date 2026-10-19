import { useEffect, useMemo, useRef, useState } from "react";

import type { Quality, SourceInfo } from "../shared/ipc.ts";
import { createMirror, type MirrorState } from "./mirror.ts";

const QUALITIES: Quality[] = ["native", "1080p", "720p"];

/**
 * Task 9 capture harness. Task 11 replaces this with the real host window (URLs, PIN, QR);
 * everything here exists to start, preview, tune and stop one session.
 */
export function App() {
  const mirror = useMemo(() => createMirror(), []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [quality, setQuality] = useState<Quality>("1080p");
  const [audioOn, setAudioOn] = useState(true);
  const [audioSupported, setAudioSupported] = useState(false);
  const [state, setState] = useState<MirrorState>({ status: "idle", error: null, audio: false });
  const [notice, setNotice] = useState<string | null>(null);

  async function loadSources(): Promise<void> {
    const list = await window.mirror.listSources();
    setSources(list);
    setSourceId((current) => (list.some((entry) => entry.id === current) ? current : (list[0]?.id ?? "")));
  }

  useEffect(() => {
    mirror.onChange(setState);
    window.mirror.onSignal((signal) => mirror.handleSignal(signal));
    void (async () => {
      const [capabilities] = await Promise.all([window.mirror.capabilities(), loadSources()]);
      setAudioSupported(capabilities.audio);
      if (!capabilities.audio) setAudioOn(false);
    })();
  }, [mirror]);

  useEffect(() => {
    if (state.status === "idle" || state.status === "error") {
      if (videoRef.current !== null) videoRef.current.srcObject = null;
    }
  }, [state.status]);

  async function start(): Promise<void> {
    setNotice(null);
    const result = await mirror.start({ sourceId, quality, audio: audioOn });
    if (!result.ok) return;
    if (videoRef.current !== null) videoRef.current.srcObject = result.stream;
    if (audioOn && !result.audio) setAudioOn(false);
  }

  async function toggleAudio(on: boolean): Promise<void> {
    setNotice(null);
    if (state.status !== "live" && state.status !== "waiting") {
      setAudioOn(on);
      return;
    }
    const changed = await mirror.setAudio(on);
    if (!changed) {
      setNotice("Audio was not captured at start; stop and start again to include it.");
      return;
    }
    setAudioOn(on);
  }

  async function changeQuality(next: Quality): Promise<void> {
    setQuality(next);
    if (state.status === "live" || state.status === "waiting") await mirror.setQuality(next);
  }

  const active = state.status === "starting" || state.status === "waiting" || state.status === "live";

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: 24, display: "grid", gap: 16 }}>
      <h1 style={{ fontSize: 24, margin: 0 }}>screenmirror host</h1>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <label style={{ display: "grid", gap: 4, minWidth: 280, flex: 1 }}>
          <span>Source</span>
          <select
            value={sourceId}
            disabled={active}
            onChange={(event) => setSourceId(event.target.value)}
            style={{ padding: 8, fontSize: 16 }}
          >
            {sources.map((source) => (
              <option key={source.id} value={source.id}>
                {source.kind === "screen" ? "Screen" : "Window"}: {source.name}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "grid", gap: 4 }}>
          <span>Quality</span>
          <select
            value={quality}
            onChange={(event) => void changeQuality(event.target.value as Quality)}
            style={{ padding: 8, fontSize: 16 }}
          >
            {QUALITIES.map((entry) => (
              <option key={entry} value={entry}>
                {entry}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center", paddingTop: 20 }}>
          <input
            type="checkbox"
            checked={audioOn}
            disabled={!audioSupported}
            onChange={(event) => void toggleAudio(event.target.checked)}
            style={{ width: 20, height: 20 }}
          />
          <span>System audio</span>
        </label>
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => void start()}
          disabled={active || sourceId === ""}
          style={{ padding: "10px 18px", fontSize: 16 }}
        >
          Start
        </button>
        <button
          type="button"
          onClick={() => mirror.stop()}
          disabled={state.status === "idle" || state.status === "error"}
          style={{ padding: "10px 18px", fontSize: 16 }}
        >
          Stop
        </button>
        <button
          type="button"
          onClick={() => void loadSources()}
          disabled={active}
          style={{ padding: "10px 18px", fontSize: 16 }}
        >
          Refresh sources
        </button>
      </div>

      <p style={{ margin: 0, color: state.status === "error" ? "#ff8a80" : "#bdbdbd" }}>
        {state.status === "idle" && "Ready."}
        {state.status === "starting" && "Starting capture..."}
        {state.status === "waiting" && "Capturing. Waiting for a viewer."}
        {state.status === "live" && "Streaming to the viewer."}
        {state.status === "error" && (state.error ?? "Capture failed.")}
        {notice !== null && ` ${notice}`}
      </p>

      {!audioSupported && (
        <p style={{ margin: 0, color: "#bdbdbd" }}>System audio is unavailable on this OS.</p>
      )}
      {audioSupported && audioOn && (
        <p style={{ margin: 0, color: "#bdbdbd" }}>The viewer hears all system audio, not one app.</p>
      )}

      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ width: "100%", maxWidth: 720, background: "#000", border: "1px solid #333" }}
      />
    </main>
  );
}
