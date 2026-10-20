import { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

import { PinPad } from "./PinPad.tsx";
import { Watch } from "./Watch.tsx";
import { takePin } from "./pin.ts";
import "./viewer.css";

// The QR link carries the PIN in the query string; read it once and strip it so a shoulder
// or the TV's URL bar cannot replay it.
const link = takePin(window.location.href);
window.history.replaceState(null, "", link.path);
const DEBUG = new URLSearchParams(window.location.search).get("debug") === "1";

type Info = { name: string; version: string; pairingOpen: boolean; lockedUntilMs: number };

type PairBody = { token?: unknown; error?: unknown; attemptsLeft?: unknown; retryAfterMs?: unknown };

function Viewer() {
  const [info, setInfo] = useState<Info | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [prefill, setPrefill] = useState(link.pin);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [lockedUntil, setLockedUntil] = useState(0);

  useEffect(() => {
    let active = true;
    fetch("/api/info")
      .then((response) => response.json() as Promise<Info>)
      .then((value) => {
        if (active) setInfo(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const handleEnded = useCallback((message: string) => {
    setToken(null);
    setEnded(message);
    setError(null);
    // The QR PIN was consumed when this viewer paired; prefill it again and the remote is stuck
    // on six stale digits. Start the next pairing empty.
    setPrefill("");
  }, []);

  async function pair(pin: string): Promise<boolean> {
    setBusy(true);
    setEnded(null);
    setError(null);
    try {
      const response = await fetch("/api/pair", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pin }),
      });
      const body = (await response.json()) as PairBody;
      if (response.ok) {
        if (typeof body.token === "string") {
          setToken(body.token);
          return true;
        }
        setError("Pairing failed. Try again.");
        return false;
      }
      if (response.status === 401) {
        if (body.error === "expired") setError("That PIN expired. Ask the host for the new one.");
        else if (typeof body.attemptsLeft === "number") {
          const left = body.attemptsLeft;
          setError(`Wrong PIN. ${left} ${left === 1 ? "attempt" : "attempts"} left.`);
        } else setError("Wrong PIN.");
        return false;
      }
      if (response.status === 429) {
        setLockedUntil(Date.now() + (typeof body.retryAfterMs === "number" ? body.retryAfterMs : 60000));
        return false;
      }
      if (response.status === 409) {
        setError("Another viewer is connected. Try again when they stop.");
        return false;
      }
      setError("Pairing failed. Try again.");
      return false;
    } catch {
      setError("Cannot reach the host.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (token !== null) return <Watch token={token} debug={DEBUG} onEnded={handleEnded} />;

  return (
    <main className="pair">
      <header className="pair-header">
        <h1>{info?.name ?? "screenmirror"}</h1>
        {info !== null && <span>v{info.version}</span>}
      </header>
      <p className="pair-hint">Enter the 6-digit PIN shown on the host.</p>
      {ended !== null && (
        <p className="pair-ended" role="status">
          {ended}
        </p>
      )}
      {ended === null && info !== null && !info.pairingOpen && (
        <p className="pair-hint">Another viewer is connected.</p>
      )}
      <PinPad
        initialPin={prefill}
        error={error}
        lockedUntilMs={Math.max(lockedUntil, info?.lockedUntilMs ?? 0)}
        busy={busy}
        onSubmit={pair}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Viewer />);
