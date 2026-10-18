# SPEC: screenmirror — local Wi-Fi screen sharing (Deskreen alternative)

Status: **APPROVED, transport decision pending** (rev 4: Silk reported to lack WebRTC → viewer
browser/transport decided by evidence at Checkpoint 1)
Phase: 1 of 4 (spec → plan → build → review/constraints)
Capability count: 1 (LAN screen + system audio mirroring). No capability map needed.

---

## Objective

Mirror the host computer's screen (or one window) **and its system audio** to a device on the
same Wi-Fi, in a browser. No account, no cloud, no app install on the viewer, no traffic off
the LAN.

**Primary viewer target: Amazon Fire TV, controlled by the D-pad remote.**
The browser on it is an open decision — Silk is reported not to support WebRTC — so the media
transport has two branches, chosen by evidence from `/probe` at Checkpoint 1 (see *Transport
decision* below). Secondary targets: phone/tablet (Safari, Chrome). Every viewer decision below
is made for the Fire TV first — keyboard-less, touch-less, camera-less, weak SoC — and must not
break the others. Pairing, PIN, QR, server, IPC, security and the 10-foot UI are identical in
both branches; only the media plumbing forks.

**Host user story:** I open the app, it shows a URL, a QR code and a 6-digit PIN, I pick a screen
and whether to send sound, a viewer joins, I see who joined, and I can stop at any time.

**Viewer user story (Fire TV):** I open the browser on the Fire TV, go to the host URL once
(bookmark it), then next time I only type the 6 digits with the remote and the screen appears
with sound. One button mutes it. I press Back and it's over.

**Viewer user story (phone/tablet):** I scan the QR code on the host screen, it opens the viewer
with the PIN already filled, I press Connect and the screen appears with sound.

**Why it exists:** Deskreen relays pairing through a public signaling server, adds file
transfer, whiteboard and multi-viewer complexity, and is unmaintained. This is the small,
auditable, LAN-only version built for a TV.

### Success criteria (testable)

1. `npm run dev` starts the host app; the UI shows `http://<lan-ipv4>:<port>` for every
   non-internal IPv4 on the machine, a QR code, and a 6-digit PIN.
2. From a second device on the same LAN: viewing starts within **3 s** of submitting a valid
   PIN (time to first rendered frame).
3. Steady-state glass-to-glass video latency **≤ 250 ms** at 1080p30 on 802.11ac (measured by
   filming a millisecond stopwatch with the tablet — the only honest test).
4. **Fire TV:** pairing is completable **with the remote alone** — arrow keys + Enter, no
   on-screen keyboard, no free-text field. Pressing Enter on the 6th digit submits.
5. **Fire TV:** the negotiated video codec is **H.264** (verified from the viewer's `?debug=1`
   overlay showing `codecId` → H264), and playback holds 1080p30 with no dropped-frame growth.
6. **Fire TV:** the stream plays fullscreen with no visible crop of the host's screen edges, and
   mute/fullscreen/stop controls are all reachable and triggerable with the remote.
7. **Audio:** with audio enabled, a sound played on the host is heard on the viewer within
   **1 s**, in sync with the video (±150 ms, judged by ear on a click track).
8. **Audio controls:** the viewer's mute button silences and restores playback; the host can
   toggle audio off during a live session and the viewer's audio stops within 1 s.
9. On an OS where system audio is unavailable, `start()` still succeeds with video only, and
   both UIs state "audio unavailable on this OS" — no silent failure, no dead session.
10. Invalid PIN → `401`; after 3 failures → `429` + lockout, and the PIN is rotated.
11. A pairing token is single-use; a replayed token is rejected (`close 1008`).
12. An expired PIN (60 s TTL) cannot be used, even if correct.
13. Scanning the host's QR code opens the viewer with the PIN prefilled, and the PIN never
    remains in the address bar or session history after load.
14. `iceServers` is empty in the built output: no STUN/TURN, no hostname other than the local
    IP is ever contacted. Asserted by unit test on the frozen config object + a `grep` gate in
    `npm run verify`.
15. Host presses Stop → viewer `<video>` ends within **1 s** and `pc.connectionState` is
    `closed` on both sides.
16. A second viewer attempting the same consumed token is refused while session 1 is live.
17. `npm test` and `npm run lint` pass with zero warnings; `src/server/pairing.ts`,
    `src/shared/protocol.ts`, `src/shared/audio.ts` and `src/shared/codecs.ts` line coverage ≥ 90%.

### Transport decision: two branches, decided by evidence

Silk is reported not to expose `RTCPeerConnection` at all (also consistent with reports of Silk
being rejected as "browser too old" by WebRTC apps). That is a device fact worth 20 minutes, not
an argument: `/probe` answers it at Checkpoint 1, alongside the Branch B questions, in one trip
to the TV.

- **Branch A — install a Chromium browser on the Fire TV and keep WebRTC.** TV Bro (open source,
  D-pad-first, Android WebView) is the candidate; Fire OS is Android and accepts a sideload. All
  17 criteria above stand unchanged, latency target 250 ms. Risk: the Fire OS WebView may also
  withhold WebRTC, in which case Branch B is the fallback.
- **Branch B — keep Silk, change the transport.** Host records the captured stream with
  `MediaRecorder`, streams chunks over the existing WebSocket, viewer plays them with
  `MediaSource`. Audio travels in the same container, so it is one path, not two.

**Branch B deltas to the criteria above** (everything not listed is unchanged):
- Criterion 3: latency becomes **≤ 1.5 s** glass-to-glass, and the frame is stable rather than
  instant. This is the real price of Branch B and it must be stated in the README, not hidden.
- Criterion 5: the codec check moves from the SDP to the recording mime type — `video/mp4` with
  `avc1` is preferred (hardware decode), `video/webm` with `vp8,opus` is the fallback — verified
  from the same `?debug=1` overlay, which now reports `MediaSource.isTypeSupported` results,
  buffer health and dropped frames.
- Criteria 7/8 (audio, mute): unchanged in behaviour, but the host audio toggle now selects
  whether the recorder captures an audio track, and mute is `video.muted` in the viewer.
- Criterion 15 (Stop): unchanged, plus the viewer must clear its `SourceBuffer` and close the
  socket rather than leaving a stalled `<video>`.
- Structure: `src/server/ws.ts` relays binary chunk frames as well as JSON signals — still
  **relays, never parses**.

**Decision rule at Checkpoint 1:** if `RTCPeerConnection` is present in any browser installable
on the Fire TV, take Branch A (ten times lower latency). Take Branch B only if no installable
browser has WebRTC. Record the device, the browser and the probe numbers in
`docs/manual-tests.md`; the choice is data, not preference.

### Non-goals (v1, explicitly cut)

**Microphone capture** (system/loopback audio only — see Boundaries), file transfer,
whiteboard, more than one simultaneous viewer, multi-source (split-screen) streaming,
internet/NAT traversal, per-application audio capture (not exposed by Electron), mobile apps,
auto-update, i18n, telemetry, persistent history.

---

## Tech stack

| Concern | Choice | Why |
|---|---|---|
| Shell | Electron (latest stable), ESM main | `desktopCapturer`, `setDisplayMediaRequestHandler` with `audio: 'loopback'`, and a Chromium command line we control (codec/mDNS switches) |
| Language | TypeScript 5.7+ `strict`, `noUncheckedIndexedAccess` | `rewriteRelativeImportExtensions` lets tests run TS directly |
| UI | React 19 + Vite | One Vite build, two entries (host UI, viewer) |
| Server | `node:http` + `ws` | No Express — a static allowlist + 3 routes is less code than the framework's config |
| QR | `qrcode` | Encoding a QR by hand is not a sane use of a day |
| Tests | `node:test` + `node --test --experimental-test-coverage` | Built into Node 24. No Vitest/Jest |
| Lint | ESLint 9 flat config + typescript-eslint, `--max-warnings 0` | devDep only |

Runtime dependency budget: **`ws` + `qrcode` (2)**. Anything else is an "Ask first".

---

## Commands

```
Dev:      npm run dev          # vite build --watch + electron .   (rebuild viewer, launch host)
Build:    npm run build        # tsc -p tsconfig.main.json && vite build
Start:    npm start            # electron .  against existing dist/
Test:     npm test             # node --test tests/  (type-stripped TS enabled by default)
Coverage: npm run coverage     # node --test --experimental-test-coverage tests/
Lint:     npm run lint         # eslint . --max-warnings 0
Verify:   npm run verify       # lint + test + build + no-STUN grep gate  (run before every commit)
```

Dev-loop note: the embedded server serves the **built** viewer from `dist/viewer/`, never the
Vite dev server. A LAN device must reach the same origin that served the pairing API, so the
viewer is served by one origin only. `vite build --watch` gives ~1 s rebuilds; that is the
dev loop. If this proves slow, fall back to `tsc`-compiled tests (see plan, Task 1).

---

## Project structure

```
src/
  main/        Electron main: window, source listing, display-media grant, server bootstrap, IPC bridge
  preload/     contextBridge surface (thin, typed, no node leakage)
  renderer/    Host React UI: URL + QR + PIN, source picker, quality + audio toggles, viewer status, stop
  viewer/      Viewer React app served at / : D-pad PIN pad → <video> + overlay controls + ?debug=1 stats
  server/      http static + /api/* , ws signaling, pairing store, bridge to renderer
  shared/      protocol types + runtime guards + audio capability + codec preference (host, viewer, tests)
tests/         node:test unit + integration
docs/          manual-tests.md, silk-probe.html, measured notes
tasks/         plan.md, todo.md   (created in Phase 2/3)
SPEC.md
```

---

## Code style

```ts
// src/shared/protocol.ts — the contract. Runtime guard lives next to its type.
export type Signal =
  | { type: "offer"; sdp: string }
  | { type: "answer"; sdp: string }
  | { type: "ice"; candidate: RTCIceCandidateInit }
  | { type: "stop"; reason: string }
  | { type: "bye" };

export function parseSignal(raw: string): Signal | null {
  try {
    const v = JSON.parse(raw) as Partial<Signal>;
    return typeof v?.type === "string" ? (v as Signal) : null;
  } catch {
    return null; // boundary: garbage in the socket is dropped, never thrown upward
  }
}
```

Conventions: named exports, no default exports; `async`/`await` only, no raw `.then`; errors
cross boundaries as values (`{ ok: false, error }`) not exceptions; every trust-boundary parse
returns `null`/`Result` rather than throwing; comments only for the *why*.

---

## API contracts

Server binds `0.0.0.0:<port>`, default `4680`, falls back to an ephemeral port if taken.
Ports and IPs are the platform's; no config file.

| Route | Request | Response |
|---|---|---|
| `GET /` | — | viewer HTML (CSP header, no token in path) |
| `GET /assets/*` | — | static viewer bundle; resolved path must stay inside `dist/viewer/` (404 otherwise) |
| `GET /api/info` | — | `200 { name, version, pairingOpen: boolean, lockedUntilMs }` — no secrets |
| `POST /api/pair` | `{ pin: string, deviceName: string }` | `200 { token }` · `401 { error: "invalid_pin" }` · `429 { error: "locked", retryAfterMs }` · `409 { error: "busy" }` |
| `WS /ws?token=<token>` | JSON `Signal` | relay of `Signal` to the opposite peer · `close 1008` on bad/replayed token or bad `Origin` |

Signaling rules: the server **relays, never parses** SDP. Exactly one host and one viewer
socket per session. `stop` from host closes the viewer socket after delivery. Messages are
dropped (not fatal) if `parseSignal` returns `null`. Audio and codec choice need **no** protocol
change: audio is another track, the codec is chosen by `setCodecPreferences` before the offer.

Host renderer ↔ main IPC (preload exposes only this):

```ts
window.mirror = {
  listSources(): Promise<{ id: string; name: string; kind: "screen" | "window" }[]>;
  capabilities(): Promise<{ audio: boolean }>;               // audio capability of this OS
  start(req: { sourceId: string; quality: "native" | "1080p" | "720p"; audio: boolean }): Promise<{ audio: boolean }>;
  setAudio(on: boolean): Promise<boolean>;                   // live toggle, adds/removes the audio track
  stop(): void;
  onSignal(cb: (s: Signal) => void): void;   // viewer → host
  sendSignal(s: Signal): void;               // host → viewer
  onState(cb: (s: HostState) => void): void; // pairing URL/PIN/QR, viewer joined/left, audio state, errors
};
```

`HostState` carries the pairing material for the UI: `{ urls: string[], pin: string, qrDataUrl: string, expiresAt: number }`.
QR payload is `http://<primary-ip>:<port>/?p=<pin>`; the PIN is generated by main, never logged.
Default quality is **1080p** (TV target), user-selectable.

### Pairing design

- 6-digit PIN, `crypto.randomInt`, regenerated on expiry/rotation, TTL 60 s, re-issued on demand.
- 3 failed attempts → 60 s lockout, PIN rotated, failure count reset.
- Success → 32-byte `crypto.randomBytes` hex token, single-use at WS connect, bound to that
  connection, dropped when the connection closes. Max 1 live viewer.
- PIN and token are never logged, never written to disk, never sent to `/api/info`.
- `?p=` is read client-side, used to prefill, then scrubbed with `history.replaceState` so the
  PIN does not sit in the address bar, history, or a Silk bookmark.

### WebRTC configuration (frozen, tested)

```ts
export const RTC_CONFIG = { iceServers: [] } as const; // LAN-only: no STUN/TURN, no leak
```

Viewer receives only (`recvonly`); it never calls `getUserMedia` and needs no camera/mic
permission. Host renderer calls `getDisplayMedia({ video: true, audio: <toggle> })`, granted by
main through `session.setDisplayMediaRequestHandler` using the source chosen in the UI.
`track.contentHint = "detail"`; quality selection is `track.applyConstraints`.

### Video codec — H.264 first (Fire TV requirement)

```ts
// src/shared/codecs.ts
export function preferH264(codecs: RTCRtpCodecCapability[]): RTCRtpCodecCapability[] {
  // Stable sort: H264 family first, everything else keeps its relative order as fallback.
  return [...codecs].sort((a, b) => Number(b.mimeType === "video/H264") - Number(a.mimeType === "video/H264"));
}
```

Applied on the host's video transceiver via `setCodecPreferences` **before** `createOffer`. No
SDP string surgery — the server still never parses SDP. Why: Chrome defaults to VP8, and VP8 at
1080p is CPU-decoded on Fire TV sticks; H.264 hits the hardware decoder. Other viewers keep
VP8/VP9 as fallback (nothing is filtered out, only reordered). Verified on the real device via
the viewer's `?debug=1` overlay reporting the negotiated codec from `pc.getStats()`.

Branch B equivalent, same idea and tested the same way: `pickMimeType(candidates)` chooses the
first supported recording type — `video/mp4;codecs="avc1.4d401f,mp4a.40.2"` (hardware decode,
one muxed stream) before `video/webm;codecs="vp8,opus"`. Same preference logic, same unit test,
different API surface.

Host-side Chromium switches (set in `main` before `app.whenReady`):

```ts
app.commandLine.appendSwitch("disable-features", "WebRtcHideLocalIpsWithMdns");
```

Why: mDNS ICE candidates (`.local`) are the single most common cause of LAN WebRTC that
"should work but doesn't" on home routers. The viewer already knows the host IP — it typed it —
so exposing the real host candidate costs no privacy and removes a whole failure class.
*Unverified until Slice 1*: if the switch is a no-op on the target Electron/Chromium, revert it
and keep the mDNS troubleshooting entry in the README instead.

### Fire TV probe — the gate that decides everything (Branch A vs B)

`docs/silk-probe.html`: one self-contained page (no deps, no build step) served by the host
server at `/probe`, reporting in one trip to the TV:

| # | Check | Decides |
|---|---|---|
| 1 | `typeof RTCPeerConnection`, `navigator.mediaDevices` presence | Branch A vs B |
| 2 | `RTCRtpSender.getCapabilities("video").codecs` (full list, if 1 is true) | which codec to prefer on A |
| 3 | `MediaSource.isTypeSupported` for `video/webm;codecs="vp8,opus"` and `video/mp4;codecs="avc1.4d401f,mp4a.40.2"`; `MediaRecorder.isTypeSupported` for the same | Branch B viability and container choice |
| 4 | **End-to-end MSE loopback in the page**: `MediaRecorder` on a canvas stream → chunks appended to a `MediaSource` → rendered by `<video>`; reports time-to-first-frame, buffer health and dropped frames | Branch B viability without needing a host at all |
| 5 | Rendered fps and dropped frames after 30 s (whichever pipeline exists) | whether the stick holds 1080p30 |

Plus `navigator.userAgent`, screen size, and Silk's rendering mode if detectable — as a reminder
to try "Off (faster on this device)" when accelerated mode misbehaves. Every result is printed
as plain text large enough to read from a sofa, and each check is individually triggered by an
Enter-activatable button so a partial failure still yields partial answers.

Rule: run this on the actual Fire TV **before** any viewer UI work, fill `docs/manual-tests.md`,
and pick the branch by the rule above. If Branch B is chosen, cherry-picking A's architecture is
still possible later — the server, pairing and UI do not change.

### System audio

```ts
// src/shared/audio.ts — the whole capability question, in one pure function.
export const audioModeFor = (platform: NodeJS.Platform): "loopback" | null =>
  platform === "win32" ? "loopback" : null; // Electron: loopback is Windows-only today
```

- Main grants audio as `callback({ video: source, audio: audioModeFor(process.platform) ?? undefined })`,
  and **never rejects the whole request because of audio**: if `audioRequested` and no loopback
  is available, it grants video alone and reports `{ audio: false }` back to the renderer so the
  UI can say why. A missing feature must not cost you the session.
- Loopback captures the **system output mix, not one application**. Sharing a single window
  still sends all system sound — the UI must say exactly that ("viewer hears all system audio")
  rather than implying per-app audio.
- Tracks: video always; audio added via `pc.addTrack`, removed via `pc.removeTrack` on
  `setAudio(false)` and re-added on demand (`replaceTrack` on a held sender is the fallback if
  re-negotiation proves noisy on a live connection).
- Audio never leaves the LAN and is carried inside the same DTLS-SRTP-encrypted peer connection
  as the video; no separate codec, no separate dependency (Opus is built into the browser).
- Default ON, with a visible host toggle and a viewer mute button.

### Viewer playback & 10-foot UI (TV first)

- `<video autoplay playsInline muted>` guarantees video, then attempt unmuted `play()`. On
  `NotAllowedError` (autoplay policy, iOS), keep the video and let the first button press enable
  sound. **Audio never blocks video.**
- Every control is a real `<button>` with a ≥4 px `:focus-visible` outline and logical focus
  order, hotkeys mirrored (`←/→` seek-free, `Enter` activate, `m` mute, `f` fullscreen) so the
  D-pad works.
- **No `<input>` for the PIN.** A numeric pad of 10 buttons, arrow-navigable, auto-submits on the
  6th digit, Backspace/`Delete` clears one — because an `<input>` summons Silk's on-screen
  keyboard on Fire TV, which is the exact friction we are designing away.
- Sizing for a 10-foot viewing distance: digits ≥ 64 px, labels ≥ 24 px, safe-area inset 5% of
  viewport (TV overscan crops edges), `object-fit: contain`, black background.
- Overlay controls auto-hide after 5 s and reappear on any key press.
- `?debug=1` shows negotiated codec, resolution, fps, bitrate, packets lost and audio level —
  the only way to verify Fire TV behaviour without one on the desk.

---

## Electron security posture

`contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, no `remote`, preload
exposes the 9 functions above and nothing else. `setWindowOpenHandler` → deny;
`will-navigate` → deny. Renderer loads local files only. CSP on every served page:
`default-src 'self'; connect-src 'self' ws:; img-src 'self' data:`. Permission requests:
`display-capture` allowed for the host page, everything else (`media`, `hid`, `usb`,
`notifications`, `geolocation`, …) denied.

Explicitly accepted risks, with mitigation:
- **The pairing PIN and session token travel over plain HTTP on the LAN.** 60 s TTL, single use,
  3-strike lockout, one viewer, no data off-LAN, media always DTLS-SRTP encrypted.
- **The QR code is a photographable secret** — anyone who can see the host screen can read the
  same PIN off it, so the QR is no weaker than the digits; TTL and single-use bound the damage.
- Self-signed TLS is the upgrade path if someone runs this on an untrusted network.

---

## Testing strategy

| Level | Tool | Scope |
|---|---|---|
| Unit | `node:test` | `pairing.ts` (PIN shape, TTL, single-use, lockout, rotation, concurrent pair), `protocol.ts` (guards reject garbage/foreign types), `audio.ts` (`audioModeFor` → `loopback` on win32, `null` on darwin/linux), `codecs.ts` (H.264 first, stable order, nothing filtered), `RTC_CONFIG` has no `iceServers` |
| Integration | `node:test`, server on port 0 | static allowlist + path traversal blocked; wrong PIN 401; 3 failures 429; valid pair → WS connect; replayed token → 1008; foreign `Origin` → 1008; signal relay host↔viewer; `stop` propagates; second viewer while busy → 409; `/probe` served and dependency-free |
| Manual (logged in `docs/manual-tests.md`) | **Actual Fire TV** | probe results for all five checks (WebRTC present? codec list? MSE/MediaRecorder types? MSE loopback time-to-first-frame? fps after 30 s) → branch decision; then: remote-only pairing; Enter-on-6th-digit submit; no on-screen keyboard; fullscreen and overscan; mute; host audio toggle mid-session; video latency (≤250 ms on A, ≤1.5 s on B); first frame ≤ 3 s; Wi-Fi drop/reconnect; Silk accelerated vs Off |
| Manual | Phone/tablet | QR scan → prefilled PIN → connect; PIN absent from the address bar afterwards; iOS autoplay tap path |

Test files: `tests/*.test.ts`, importing source with `.ts` specifiers. No browser automation:
the parts that fail in practice (a Fire TV, real Wi-Fi, real speakers) cannot be faked, so they
are scripted as a manual log instead of pretending Playwright covers them.

---

## Quality gates (Phase 4 formalizes these into `CONSTRAINTS.md`)

- `npm run verify` green, zero lint warnings, zero suppressions (`@ts-ignore`, `eslint-disable`)
  added to reach green.
- Coverage ≥ 90% lines on `pairing.ts`, `protocol.ts`, `audio.ts`, `codecs.ts`.
- No test deleted or skipped to pass a gate; no assertion removed.
- No dependency added beyond `ws` + `qrcode` without explicit approval.
- Every trust boundary (HTTP body, WS frame, IPC payload, file path) has a runtime check.

---

## Boundaries

**Always:** validate at the boundary; single-use tokens; random crypto for secrets; run
`npm run verify` before every commit; keep the viewer dependency-free at runtime (no CDN);
degrade audio loss into a video-only session instead of failing the session; keep the viewer
usable with arrow keys + Enter only.

**Ask first:** any new runtime dependency; changing the pairing crypto or TTLs; making the
server reachable beyond the LAN; adding microphone capture; adding a second viewer; changing
the codec preference policy.

**Never:** configure a STUN/TURN server; log or persist PINs/tokens; request camera or
microphone permission; serve a path outside `dist/viewer/`; enable `nodeIntegration`; ship a
build with an unhandled `uncaughtException`; remove the VP8 fallback from the codec order.

---

## Known limits (accepted, documented in README)

- **System audio is Windows-only** per Electron's current docs (`audio: 'loopback'`). macOS
  loopback exists behind a feature flag and a newer Chromium; Linux is unsupported. The app
  detects this at runtime, states it, and runs video-only.
- **Loopback is the whole system mix**, not per-application. Sharing one window still sends all
  sound, including notifications. UI wording must not promise otherwise.
- **Silk is reported to have no WebRTC at all.** Branch A therefore requires installing a
  D-pad-friendly Chromium browser on the Fire TV (one-time, documented); Branch B keeps Silk and
  accepts ~1.5 s latency instead of 250 ms. Either way the README states which branch this build
  implements and why.
- **Silk accelerated rendering** may break other web-platform features on some Fire TV models;
  the documented workaround is switching Silk's rendering mode off.
- Fire TV URLs must be typed once with the remote; the README documents bookmarking the URL.
- Browser autoplay policy may require one button press on the viewer before sound is audible
  (iOS Safari in particular) — the mute button covers it.
- AP/client isolation or guest networks block peer-to-peer; symptom and diagnosis go in the README.
- Windows Firewall prompt appears on first run; documented with a screenshot path.
- No reconnect logic beyond ICE restart on `failed`; if that fails the viewer reloads and re-pairs.

---

## Decisions recorded (rev 4)

QR code: **in** (phones/tablets; not usable from a Fire TV remote). Name: **screenmirror**.
Viewer: **React**, TV-first. Viewers: **1**. Audio: **on by default**, host toggle + viewer mute.
Primary viewer: **Fire TV**, D-pad only, no camera, no keyboard. Default quality: 1080p.
Microphone: out of scope (system audio only) — reverse by changing the "Ask first" line.
**Transport: pending the probe** — Branch A (install a WebRTC-capable Chromium browser on the TV,
keep WebRTC, 250 ms) versus Branch B (keep Silk, MSE + WebSocket chunks, ~1.5 s). Decision rule,
probe checks and Branch B deltas are specified above. Unknown until Checkpoint 1: whether
`RTCPeerConnection` exists in Silk or in any browser installable on the Fire TV.
