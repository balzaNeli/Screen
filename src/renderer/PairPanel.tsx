import { useEffect, useState } from "react";

import type { HostState } from "../shared/ipc.ts";

/** Pairing material owned by main; this only displays it and runs the local countdown. */
export function PairPanel({ state }: { state: HostState | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, []);

  const pin = state?.pin ?? "";
  const urls = state?.urls ?? [];
  const expiresAt = state?.expiresAt ?? 0;
  const seconds =
    pin === "" || expiresAt === 0 ? 0 : Math.max(0, Math.ceil((expiresAt - now) / 1000));
  const expired = pin !== "" && seconds === 0;

  return (
    <section className="pair-panel" aria-label="Viewer pairing">
      <div className="pin-block">
        <span className="eyebrow">Viewer PIN</span>
        <strong className="pin-digits">{pin === "" ? "------" : pin}</strong>
        <span className={expired ? "countdown is-expired" : "countdown"} aria-live="polite">
          {pin === ""
            ? "Starting the host service..."
            : expired
              ? "Refreshing PIN..."
              : `New PIN in ${seconds}s`}
        </span>
      </div>

      <div className="qr-block">
        {state?.qrDataUrl ? (
          <img
            className="qr-image"
            src={state.qrDataUrl}
            alt="QR code for the viewer URL"
            width={320}
            height={320}
          />
        ) : (
          <div className="qr-image qr-placeholder">
            QR code
            <br />
            unavailable
          </div>
        )}
        <span className="hint">Scan to open the viewer with the PIN filled in.</span>
      </div>

      <div className="url-block">
        <span className="eyebrow">{urls.length > 1 ? "Viewer addresses" : "Viewer address"}</span>
        {urls.length === 0 ? (
          <p className="muted">Waiting for a LAN address...</p>
        ) : (
          urls.map((url) => (
            <code className="url" key={url}>
              {url}
            </code>
          ))
        )}
        {urls.length > 1 && <span className="hint">The QR uses the first address.</span>}
        {state?.viewer !== null && state?.viewer !== undefined && (
          <span className="hint">A viewer is connected. Pairing is paused until it leaves.</span>
        )}
      </div>
    </section>
  );
}
