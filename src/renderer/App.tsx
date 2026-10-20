import { useEffect, useMemo, useRef, useState } from "react";

import type { HostState, Quality, SourceInfo } from "../shared/ipc.ts";
import { createMirror, type MirrorState } from "./mirror.ts";
import { PairPanel } from "./PairPanel.tsx";

const QUALITIES: Quality[] = ["native", "1080p", "720p"];
const DEFAULT_PORT = "4680";

const QUALITY_LABELS: Record<Quality, string> = {
  native: "Native",
  "1080p": "1080p (max)",
  "720p": "720p (max)",
};

function errorText(err: unknown): string {
  return err instanceof Error && err.message !== "" ? err.message : String(err);
}

function viewerLabel(userAgent: string): string {
  let device = "";
  if (/Silk|AFT/i.test(userAgent)) device = "Fire TV";
  else if (/Android/i.test(userAgent)) device = "Android";
  else if (/iPhone|iPad/i.test(userAgent)) device = "iOS";

  let browser = "browser";
  if (/Silk/i.test(userAgent)) browser = "Silk";
  else if (/Edg\//i.test(userAgent)) browser = "Edge";
  else if (/Firefox\//i.test(userAgent)) browser = "Firefox";
  else if (/Chrome\//i.test(userAgent)) browser = "Chrome";
  else if (/Safari\//i.test(userAgent)) browser = "Safari";

  return device === "" ? browser : `${device} · ${browser}`;
}

function portOf(url: string | undefined): string | null {
  if (url === undefined) return null;
  try {
    return new URL(url).port;
  } catch {
    return null;
  }
}

/** The real host window: pairing material, capture controls, live state and readable failures. */
export function App() {
  const mirror = useMemo(() => createMirror(), []);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [host, setHost] = useState<HostState | null>(null);
  const [sources, setSources] = useState<SourceInfo[]>([]);
  const [sourceId, setSourceId] = useState("");
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality>("1080p");
  const [audioOn, setAudioOn] = useState(true);
  const [audioSupported, setAudioSupported] = useState<boolean | null>(null);
  const [state, setState] = useState<MirrorState>({ status: "idle", error: null, audio: false });
  const [notice, setNotice] = useState<string | null>(null);

  async function loadSources(): Promise<void> {
    setSourcesLoading(true);
    setSourceError(null);
    try {
      const list = await window.mirror.listSources();
      setSources(list);
      const preferred = list.find((entry) => entry.kind === "screen") ?? list[0];
      setSourceId((current) =>
        list.some((entry) => entry.id === current) ? current : (preferred?.id ?? ""),
      );
      if (list.length === 0) {
        setSourceError(
          "No screen or window was found. Check the screen-recording permission, then refresh.",
        );
      }
    } catch (err) {
      setSources([]);
      setSourceId("");
      setSourceError(`Could not list capture sources: ${errorText(err)}`);
    } finally {
      setSourcesLoading(false);
    }
  }

  useEffect(() => {
    window.mirror.onState(setHost);
    mirror.onChange(setState);
    window.mirror.onSignal((signal) => mirror.handleSignal(signal));
    void loadSources();
    void (async () => {
      try {
        const capabilities = await window.mirror.capabilities();
        setAudioSupported(capabilities.audio);
        if (!capabilities.audio) setAudioOn(false);
      } catch (err) {
        setAudioSupported(false);
        setNotice(`Could not read system audio support: ${errorText(err)}`);
      }
    })();
  }, [mirror]);

  useEffect(() => {
    if ((state.status === "idle" || state.status === "error") && videoRef.current !== null) {
      videoRef.current.srcObject = null;
    }
  }, [state.status]);

  async function start(): Promise<void> {
    setNotice(null);
    try {
      const result = await mirror.start({ sourceId, quality, audio: audioOn });
      if (!result.ok) return;
      if (videoRef.current !== null) videoRef.current.srcObject = result.stream;
      if (audioOn && !result.audio) {
        setAudioOn(false);
        setNotice("This system did not provide system audio. The video is streaming without it.");
      }
    } catch (err) {
      setNotice(`Could not start capture: ${errorText(err)}`);
    }
  }

  function stop(): void {
    setNotice(null);
    mirror.stop();
  }

  async function toggleAudio(on: boolean): Promise<void> {
    setNotice(null);
    if (state.status !== "live" && state.status !== "waiting") {
      setAudioOn(on);
      return;
    }
    try {
      const changed = await mirror.setAudio(on);
      if (!changed) {
        setNotice("System audio was not captured at start. Stop and start again with audio enabled.");
        return;
      }
      setAudioOn(on);
    } catch (err) {
      setNotice(`Could not change system audio: ${errorText(err)}`);
    }
  }

  async function changeQuality(next: Quality): Promise<void> {
    setNotice(null);
    if (state.status !== "live" && state.status !== "waiting") {
      setQuality(next);
      return;
    }
    const previous = quality;
    setQuality(next);
    try {
      const applied = await mirror.setQuality(next);
      if (!applied) {
        setQuality(previous);
        return;
      }
    } catch (err) {
      setQuality(previous);
      setNotice(`Could not change quality: ${errorText(err)}`);
    }
  }

  const active = state.status === "starting" || state.status === "waiting" || state.status === "live";
  const audioChecked =
    state.status === "waiting" || state.status === "live" ? state.audio : audioOn;
  const viewer = host?.viewer ?? null;
  const fallbackPort = portOf(host?.urls[0]);
  const portFallback =
    fallbackPort !== null && fallbackPort !== "" && fallbackPort !== DEFAULT_PORT
      ? fallbackPort
      : null;

  let statusText = "Ready.";
  if (state.status === "starting") statusText = "Starting capture...";
  else if (state.status === "waiting") {
    statusText =
      viewer === null ? "Capturing. Waiting for a viewer." : "Viewer connected. Negotiating...";
  } else if (state.status === "live") statusText = "Streaming to the viewer.";
  else if (state.status === "error") statusText = state.error ?? "Capture failed.";

  return (
    <main className="host">
      <header className="host-header">
        <div>
          <h1>screenmirror</h1>
          <p className="muted">
            Share this screen and system audio with the Fire TV or a browser on the same Wi-Fi.
          </p>
        </div>
        <span className={viewer === null ? "viewer-pill" : "viewer-pill is-live"}>
          <span className="dot" />
          {viewer === null ? "Waiting for viewer" : `Viewer: ${viewerLabel(viewer.userAgent)}`}
        </span>
      </header>

      <PairPanel state={host} />

      {host?.error !== null && host?.error !== undefined && (
        <p className="message is-error" role="alert">
          {host.error}
        </p>
      )}
      {portFallback !== null && (
        <p className="message is-notice">
          Port {DEFAULT_PORT} was busy, so the viewer uses port {portFallback}. Use the address above.
        </p>
      )}

      <section className="session" aria-label="Capture controls">
        <div className="controls">
          <label className="field grow">
            <span>Source</span>
            <select
              value={sourceId}
              disabled={active || sourcesLoading}
              onChange={(event) => setSourceId(event.target.value)}
            >
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.kind === "screen" ? "Screen" : "Window"}: {source.name}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Quality</span>
            <select
              value={quality}
              disabled={state.status === "starting"}
              onChange={(event) => void changeQuality(event.target.value as Quality)}
            >
              {QUALITIES.map((entry) => (
                <option key={entry} value={entry}>
                  {QUALITY_LABELS[entry]}
                </option>
              ))}
            </select>
          </label>

          <label className="check">
            <input
              type="checkbox"
              checked={audioChecked}
              disabled={audioSupported !== true || state.status === "starting"}
              onChange={(event) => void toggleAudio(event.target.checked)}
            />
            <span>System audio</span>
          </label>
        </div>

        <div className="actions">
          <button
            type="button"
            className="primary"
            onClick={() => void start()}
            disabled={active || sourcesLoading || sourceId === ""}
          >
            Start
          </button>
          <button type="button" onClick={stop} disabled={!active}>
            Stop
          </button>
          <button
            type="button"
            onClick={() => void loadSources()}
            disabled={active || sourcesLoading}
          >
            Refresh sources
          </button>
        </div>

        <p className={state.status === "error" ? "status is-error" : "status"} role="status">
          {statusText}
        </p>
        {state.error !== null && state.status !== "error" && (
          <p className="message is-error" role="alert">
            {state.error}
          </p>
        )}
        {sourcesLoading && <p className="muted">Loading capture sources...</p>}
        {sourceError !== null && (
          <p className="message is-error" role="alert">
            {sourceError}
          </p>
        )}
        {notice !== null && (
          <p className="message is-notice" role="status">
            {notice}
          </p>
        )}
        {audioSupported === null && <p className="muted">Checking system audio support...</p>}
        {audioSupported === false && (
          <p className="muted">System audio is unavailable on this OS. Video only.</p>
        )}
        {audioSupported === true && audioChecked && (
          <p className="muted">The viewer hears all system audio, not one app.</p>
        )}

        <video ref={videoRef} className="preview" hidden={!active} autoPlay playsInline muted />
      </section>
    </main>
  );
}
