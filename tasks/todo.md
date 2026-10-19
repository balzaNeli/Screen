# Task List: screenmirror

Source of truth: `SPEC.md` (rev 5, approved) and `tasks/plan.md`.

**Progress:** Tasks 1–9 implemented — Phases 1–2, the Electron shell and the host capture engine. Checkpoint
2 passed headlessly (39 tests green); **Checkpoint 1 passed 2026-10-18 → transport is WebRTC in Silk
(Branch A); the MSE alternative is rejected on evidence.** Probe check 4 also ran on the TV that
day: connected, `video/H264` negotiated, first frame 942 ms. The host shell (Task 8) was verified
against the real window on 2026-10-19; the capture engine (Task 9) was verified the same day with a
real offer/answer, H.264, live quality/audio changes and a stop/restart cycle. The one open Task 9
item is the audio-unsupported OS check, which needs a non-Windows host. Next: Task 10 (viewer app).
**Checkpoint 3 remains the human gate.**

**Definition of Done — every task:**
- [ ] `npm test` passes (no new skips, no deleted assertions)
- [ ] `npm run lint` clean, zero warnings, no `@ts-ignore`/`eslint-disable` added
- [ ] `npm run build` succeeds
- [ ] Acceptance criteria below checked off
- [ ] Files touched stay within the list given (flag it if not)

---

## Phase 1 — Skeleton and fail-fast gate

### Task 1: Repo scaffold (build, lint, test wiring)

**Description:** Create the project skeleton: package.json (ESM, scripts `dev`/`build`/`start`/
`test`/`coverage`/`lint`/`verify`), two tsconfigs (base with `strict`, `noUncheckedIndexedAccess`,
`lib: ["ES2023","DOM"]`, `rewriteRelativeImportExtensions`; `tsconfig.main.json` emitting
main/preload/shared), Vite config with two entries (host `src/renderer/index.html`, viewer
`src/viewer/index.html` → `dist/renderer`, `dist/viewer`), ESLint 9 flat config with
typescript-eslint, `.gitignore`, and `git init` + first commit.

**Acceptance criteria:**
- [ ] `npm run lint` runs and passes on an empty source tree
- [ ] `npm run build` produces `dist/renderer/index.html` and `dist/viewer/index.html` from stub pages
- [ ] `npm test` runs `node --test tests/` and exits 0 with one placeholder test that is deleted in Task 2
- [ ] A `.ts` test file importing another `.ts` file with an explicit `.ts` specifier runs under `node --test` (proves the type-stripping route before real code exists)
- [ ] `npm run verify` chains lint + test + build

**Verification:**
- [ ] Run: `npm run lint && npm test && npm run build && npm run verify`
- [ ] Manual: confirm `dist/` contains both entry HTML files and their assets

**Dependencies:** None
**Files:** `package.json`, `tsconfig.json`, `tsconfig.main.json`, `vite.config.ts`,
`eslint.config.js`, `.gitignore`
**Scope:** M (config; almost no logic)

---

### Task 2: `src/shared` protocol, audio and codec modules + unit tests

**Description:** Write the pure modules every other layer depends on: `protocol.ts` (`Signal`
union + `parseSignal` guard that returns `null` on garbage), `audio.ts` (`audioModeFor(platform)`
→ `"loopback"` only on `win32`), `codecs.ts` (`preferH264` stable reorder, nothing filtered) and
`rtc.ts` (`RTC_CONFIG` with `iceServers: []`, frozen). Unit-test all four, including the frozen
config, since that is how "no STUN/TURN" stays true.

**Acceptance criteria:**
- [ ] `parseSignal` returns `null` for invalid JSON, `{}`, `{type: 1}` and `{type:"nope"}`-shaped junk; returns the value for each valid variant
- [ ] `audioModeFor("win32") === "loopback"`, and `darwin`/`linux` → `null`
- [ ] `preferH264` puts every `video/H264` entry first, preserves relative order otherwise, drops nothing, and is a no-op on an all-VP8 list
- [ ] `RTC_CONFIG.iceServers` is empty and frozen (mutating throws in strict mode)
- [ ] No imports from Node, Electron or the DOM runtimes in these four modules

**Verification:**
- [ ] Tests: `npm test` (new: `tests/shared.test.ts`)
- [ ] Build: `npm run build`

**Dependencies:** Task 1
**Files:** `src/shared/protocol.ts`, `src/shared/audio.ts`, `src/shared/codecs.ts`,
`src/shared/rtc.ts`, `tests/shared.test.ts`
**Scope:** M

---

### Task 3: Static HTTP server with path allowlist, `/api/info`, `/probe`

**Description:** `node:http` server bound to `0.0.0.0`, default port 4680 with ephemeral fallback.
Serves `dist/viewer/` under `/assets/*` through a resolver that refuses anything resolving
outside that directory, `GET /` → viewer HTML, `GET /api/info` → non-secret status,
`GET /probe` → `docs/silk-probe.html`. Security headers on every response (CSP, nosniff,
no-referrer). Export a `startServer({ port })` returning `{ port, close }` so tests can bind
port 0.

**Acceptance criteria:**
- [ ] `/assets/../../SPEC.md` and encoded variants return 404, never file contents
- [ ] `/api/info` returns name/version/pairingOpen and never the PIN or token
- [ ] Every response carries the CSP + `X-Content-Type-Options: nosniff` headers
- [ ] Binding port 0 works and reports the real port (test harness requirement)
- [ ] Server closes cleanly with no open handles left behind

**Verification:**
- [ ] Tests: `npm test` (new: `tests/http.test.ts`, real `fetch` against a port-0 server)
- [ ] Manual: `npm start`-less dev check — boot the server with `node --experimental-strip-types` and open `/` in a browser

**Dependencies:** Task 2
**Files:** `src/server/http.ts`, `src/server/routes.ts`, `tests/http.test.ts`
**Scope:** M

---

### Task 4: `docs/silk-probe.html` + manual test log skeleton

**Description:** One self-contained diagnostic page (no build step, no dependencies, no CDN) that
answers the branch question on real hardware. As built: check 1 capabilities, check 2 codec list,
check 3 container support, check 4 **WebRTC loopback** (640x360@15, H.264 preferred, self-stops
after 30 s, reports connection state, negotiated codec, painted frames), check 4b the same at
720p30 on demand, check 6 the capped, double-confirmed MSE test kept only as evidence against the
rejected transport. Results and safety rules in `docs/manual-tests.md`.

**Acceptance criteria:**
- [x] Checks 1–3 print results without any user permission or device access
- [x] Check 4 proves a peer connection on the device: connection state, negotiated codec, first painted frame, fps, and it stops itself
- [x] Check 6 cannot brick a TV by accident: second confirming click, 640x360@15, append queue capped at 24, self-stop at 20 s
- [x] Every check is reachable and triggerable with the D-pad alone at `http://<lan-ip>:4680/probe`
- [x] No dependency, no build step (external css/js so the CSP can stay strict)
- [x] `docs/manual-tests.md` holds the measured results, the branch decision and the safety rules
- [ ] Check 4 run on the real Fire TV and its numbers written down (still open — Checkpoint 3 depends on it)

**Verification:**
- [ ] Manual (required): run `/probe` on the actual Fire TV and fill the table
- [ ] Manual: run it in desktop Chrome as a control
- [ ] Tests: `npm test` (asserts `/probe` is served and contains no `<script src=`)

**Dependencies:** Task 3
**Files:** `docs/silk-probe.html`, `docs/manual-tests.md`, `tests/http.test.ts`
**Scope:** S

---

## Checkpoint 1 — Fire TV gate (PASSED 2026-10-18)

- [x] `/probe` run on a real `AFTCA002` (Silk 144): `RTCPeerConnection` yes, `navigator.mediaDevices` no, MediaSource/MediaRecorder/setCodecPreferences/rVFC yes, screen 1920x1080@1x
- [x] Codecs offered: VP8, H264, AV1, VP9, H265 + rtx/red/fec. Recording: no H.264 container on this device
- [x] **Decision: WebRTC in Silk. No browser install needed.** The old MSE loopback test froze the device hard → that transport is rejected and the test is now capped and double-confirmed
- [x] Consequence recorded as a requirement: **the viewer is receive-only** and must never touch `navigator.mediaDevices`
- [x] `npm run verify` green
- [x] Probe check 4 (capped WebRTC loopback 640x360@15) run on the TV, 2026-10-18 17:33: connected, H.264 negotiated, first frame 942 ms, 420/450 frames painted
- [x] Probe check 4b (720p30) run on the TV, 2026-10-18: **it hung the `AFTCA002` hard (power cycle)**, log stopped at `connecting → connected`, no frame numbers. Read as: the stick must never *encode*; the receive-only ceiling stays a Checkpoint 3 measurement (720p30 first). The check now asks twice, like check 6, and is not re-run on this device

---

## Phase 2 — Pairing and signaling

### Task 5: Pairing store (PIN TTL, rotation, 3-strike lockout, single-use tokens)

**Description:** `pairing.ts` as a pure, injectable module (takes a clock and a random source so
tests need no timers): generates a 6-digit PIN with `crypto.randomInt`, TTL 60 s, rotates on
expiry and on the 3rd failure, then locks for 60 s; `verify(pin)` returns a single-use 32-byte
hex token bound to a session id; `consume(token)` succeeds exactly once; `revoke(sessionId)`
drops it. Never logs secrets.

**Acceptance criteria:**
- [x] PIN matches `/^\d{6}$/` over 10 000 generated PINs (and is not always the same)
- [x] An expired PIN fails even when correct; a fresh one is issued on demand, and an expired attempt is not counted as a failure
- [x] 3 wrong attempts → locked (`retryAfterMs > 0`), PIN rotated, counter reset; correct PIN during lockout is rejected
- [x] A token is accepted once and rejected the second time; a token from a revoked session is rejected
- [x] Max one live viewer: `verify()` answers `busy` while a session holds the seat, and `revoke()` frees it. A viewer that never connects loses the seat (and its token) after `connectTtlMs`
- [x] Junk at the trust boundary (`undefined`, numbers, arrays, wrong lengths, non-ASCII digits) is an invalid attempt, never a throw

**Verification:**
- [ ] Tests: `npm test` (new: `tests/pairing.test.ts`, injected clock — no `setTimeout`, no sleeps)

**Dependencies:** Task 2
**Files:** `src/server/pairing.ts`, `tests/pairing.test.ts`
**Scope:** M

---

### Task 6: `POST /api/pair` + integration tests

**Description:** Wire the store into the HTTP layer: parse and validate the JSON body at the
boundary (wrong shape → 400, never a throw), map outcomes to `200 {token}` / `401 invalid_pin` /
`401 expired` / `429 locked+retryAfterMs` / `409 busy`, cap body size at 4 KB, and never echo the
PIN back. `startServer` takes an injected `Pairing` (the host window owns the store) and generates
the boot `hostToken` that the host socket will need in Task 7.

**Acceptance criteria:**
- [x] Wrong PIN → 401; 3 wrong in a row → 429 with `retryAfterMs`; correct PIN → 200 with a token
- [x] Malformed body, missing fields, oversized body and non-JSON all → 400 without an unhandled rejection
- [x] Response bodies never contain the current PIN (and the token appears only in the 200 that carries it)
- [x] A malformed body is a bad request, not an attempt: 1 000 of them leave the lockout untouched, and the next real attempt still has three tries
- [x] Second pair while a session is live → 409 (and the already-issued token still works)
- [x] Over-limit bodies are drained rather than reset, so an abusive client still reads its 400

**Verification:**
- [x] Tests: `npm test` (extends `tests/http.test.ts`, real server on port 0, injected clock)
- [x] Manual: the built server driven over HTTP (lockout path, happy path, one viewer, junk bodies)

**Dependencies:** Task 3, Task 5
**Files:** `src/server/http.ts`, `src/server/pairing.ts`, `tests/http.test.ts`, `scripts/serve.mjs`
**Scope:** M

---

### Task 7: WebSocket signaling relay with token/origin validation + two-peer tests

**Description:** `ws.ts` on the same HTTP server: validate `Origin` (no cross-site upgrade),
consume the single-use token at connect (bad/replayed → `close 1008`), pair exactly one host
socket with one viewer socket, relay `Signal` frames in both directions (drop unparseable frames,
never throw), propagate `stop`, and clean up both sockets when either side disconnects. The host
socket authenticates with the boot `hostToken` over loopback, and `onViewerChange` tells the host
window who attached ({ sessionId, userAgent }) or that the viewer left. Plus
`tests/fixtures/fake-peer.ts`, a bounded-wait `ws` client used by the tests and by manual
debugging before Electron exists.

**Acceptance criteria:**
- [x] Connect without token, with a replayed token, with a foreign `Origin` or with a wrong host token → `1008`, no session created
- [x] Host and viewer sockets in one session relay offer/answer/ICE in both directions, unchanged
- [x] Sending garbage over the socket is dropped without killing the session
- [x] `stop` from the host is delivered to the viewer and closes both sockets; a viewer drop wakes the host with `bye`, frees the seat, and the next viewer can pair immediately
- [x] Two fake peers complete a full offer/answer/ICE exchange against the real server (no mock of our own code)
- [x] An oversized frame (>256 KB) closes that socket (`1009`) and tears the session down cleanly
- [x] A second host socket replaces the first (`1008`), so a restarted host window is never locked out
- [x] `onViewerChange` fires with `{ sessionId, userAgent }` on attach and `null` on leave

**Verification:**
- [x] Tests: `npm test` (new: `tests/ws.test.ts`, 9 tests)
- [x] Manual: the built `dist/` relay driven by two peers over real sockets — pair → token → offer/answer relay → `stop` closes both with `1000` → seat freed → no-token socket gets `1008`

**Dependencies:** Task 6
**Files:** `src/server/ws.ts`, `tests/ws.test.ts`, `tests/fixtures/fake-peer.ts`, `src/server/http.ts`
**Scope:** M

---

## Checkpoint 2 — Protocol proven headlessly

- [x] Two fake peers complete offer/answer/ICE relay through the real server
- [x] Replayed token, foreign origin, wrong host token, missing token and the 4th failed PIN all rejected with the right codes (`1008` / `429`)
- [x] `npm run verify` green, zero suppressions, no test skipped or deleted
- [x] Human review before the Electron shell is written (Task 8) — approved 2026-10-19; coverage on shared + pairing ≥ 80% is still checked at Task 14

---

## Phase 3 — First real frame (walking skeleton)

### Task 8: Electron shell: security posture, permission handlers, switches, preload IPC

**Description:** `main.ts`: create the window with `contextIsolation: true`, `sandbox: true`,
`nodeIntegration: false`, deny `setWindowOpenHandler` and `will-navigate`, apply the
`WebRtcHideLocalIpsWithMdns` switch before `app.whenReady`, install permission handlers that
allow only `display-capture` for the host page, start the server, and bridge IPC
(`listSources`, `capabilities`, `start`, `setAudio`, `stop`, `signal` both ways, `state` push).
`display-media.ts` wires `setDisplayMediaRequestHandler` to grant the chosen source plus
`loopback` audio when available. `preload.ts` exposes exactly the documented 9-function surface
and nothing else. Host UI stays on `file://`.

**Acceptance criteria:**
- [x] App launches, loads the host page from `file://`, and `window.mirror` exposes only the documented functions (8 in the SPEC code block; the prose says 9 — the block is the contract)
- [x] Renderer cannot reach `require`/`process`/`fs` (typed in devtools: all undefined)
- [x] `display-capture` is granted for the host page; `media`, `geolocation`, `usb` requests are denied (Electron 44 reports getDisplayMedia as a `media` request: allowed only for the host page while a source is armed, and the display-media handler still picks the source)
- [x] `start()` grants the selected source; with audio requested on a supported OS the returned stream has an audio track, and on an unsupported OS it returns video-only plus `{ audio: false }` (Windows capture: 1920x1080@30 + "System audio"; the unsupported branch is the tested `audioModeFor` pure function)
- [x] Clicking an external link or navigating does nothing (open handler and navigation denied)

**Verification:**
- [x] Tests: `npm test` (new: `tests/ipc.test.ts` — pure IPC boundary guard; the Electron path is verified manually)
- [x] Manual: devtools — call each `window.mirror` function, confirm source list, confirm no Node globals
- [x] Manual: `/api/info` reachable from the LAN while the app runs

**Files as built:** `src/main/main.ts`, `src/main/display-media.ts`, `src/main/ipc.ts`,
`src/preload/preload.cts` (CJS is required for a sandboxed preload; `.ts` → `.cts`),
`src/renderer/index.html`, plus the extra pieces the shell needs: `src/shared/ipc.ts` (typed
contract + IPC guard), `src/renderer/global.d.ts`, `tests/ipc.test.ts`, `vite.config.ts` (`base:
"./"` for `file://`), `eslint.config.js` (CommonJS preload rule), `package.json` (Electron +
scripts), `docs/manual-tests.md`.

**Dependencies:** Checkpoint 2
**Files:** `src/main/main.ts`, `src/main/display-media.ts`, `src/main/ipc.ts`,
`src/preload/preload.ts`, `src/renderer/index.html`
**Scope:** M

---

### Task 9: Host capture engine: `getDisplayMedia`, H.264 preference, quality/audio, peer wiring

**Branch A (WebRTC) — confirmed by Checkpoint 1 (probe evidence, Silk 144: `RTCPeerConnection`
present, H.264 offered).** No fork: the MSE alternative is rejected in `SPEC.md` and the expected
codec is H.264 rather than unknown. Everything else is as described.

**Description:** `mirror.ts` in the renderer: request display media, attach the video track with
`contentHint = "detail"`, apply the chosen quality cap via `applyConstraints`, create the
`RTCPeerConnection` with the frozen `RTC_CONFIG`, set `preferH264` on the video transceiver
**before** `createOffer`, add the audio track when granted, relay `Signal` messages over
`window.mirror`, add/remove the audio track on `setAudio`, and tear everything down on `stop`
(tracks stopped, pc closed, ICE sent to the viewer first).

**Acceptance criteria:**
- [x] Offer SDP contains H.264 as the first video payload type; VP8/VP9 still present as fallback
- [x] The peer connection uses `iceServers: []` (asserted at runtime, not only in the constant)
- [x] Quality selection caps the resolution via `applyConstraints` without restarting capture
- [x] `setAudio(false)` removes the track live; `setAudio(true)` restores it; no re-negotiation glitch that drops video
- [x] `stop()` stops every track and closes the pc; a second `start()` works without reloading the app
- [ ] Audio-unsupported OS: `start()` succeeds, video flows, `HostState.audio === false` — **not run**: this host has Windows loopback; needs a macOS/Linux run (code path implemented)

**Verification:**
- [x] Tests: `npm test` (pure SDP/codec-order helper)
- [x] Manual: devtools — inspect `getStats()` for `codecId`/`framesPerSecond` locally before any TV test
- [x] Manual: verify with a fake peer in the same browser session that offer/answer completes

**Files as built:** `src/renderer/mirror.ts`, `src/renderer/App.tsx`, `src/renderer/main.tsx`, plus
`src/shared/capture.ts` and `tests/capture.test.ts` (the pure quality-cap helper was not in the
planned file list). The engine withholds the first offer until `HostState.viewer` is non-null, so the
SPEC order ("pick a screen, a viewer joins") does not drop the offer. Audio uses
`replaceTrack(null)`/`replaceTrack(track)` on the sender held from the offer (the SPEC fallback), so
the live toggle never renegotiates. Evidence is in `docs/manual-tests.md`.

**Dependencies:** Task 8
**Files:** `src/renderer/mirror.ts`, `src/renderer/App.tsx`, `src/renderer/main.tsx`
**Scope:** M

---

### Task 10: Viewer app: D-pad PIN pad, `<video>`, overlay controls, `?debug=1` stats

**Branch A (WebRTC) — confirmed by Checkpoint 1.** One constraint from the probe, non-negotiable:
the viewer is **receive-only**. It must never call `getUserMedia`/`getDisplayMedia`, never request
a permission, and never feature-detect on `navigator.mediaDevices` — Silk on Fire TV hides that
object (a TV has no camera or microphone) and a naive feature test is exactly what makes people
report "Silk has no WebRTC". `RTCPeerConnection` on its own is all a recv-only viewer needs.

**Description:** The viewer React app served at `/`: fetch `/api/info`, show a 10-button numeric
pad (no `<input>` — this is deliberate, it summons Silk's on-screen keyboard), auto-submit on the
6th digit, `POST /api/pair`, open the WebSocket, create the recv-only peer connection, answer the
offer, render the stream in `<video autoplay playsInline muted>`, then attempt unmuted playback.
Overlay controls (mute, fullscreen, stop) as real buttons with visible focus, auto-hiding after
5 s, arrow-key + Enter navigable. `?debug=1` shows codec, resolution, fps, bitrate, packets lost
and audio level from `getStats()`. `?p=` prefills the PIN and is scrubbed with
`history.replaceState`. 10-foot sizing with a 5% safe-area inset.

**Acceptance criteria:**
- [ ] Pairing is completable with arrow keys + Enter only; no element summons a virtual keyboard
- [ ] Enter on the 6th digit submits; wrong PIN shows the server's error text; lockout shows the retry time
- [ ] Stream renders, mute toggles audio, fullscreen works, `?debug=1` reports the negotiated codec
- [ ] Blurred focus is always visible (≥4 px outline) on every control
- [ ] After load with `?p=`, the PIN is gone from the address bar and from `history.length` navigation
- [ ] No viewer file references `getUserMedia`, `getDisplayMedia`, `navigator.mediaDevices` or any permission API (grep gate — receive-only on a camera-less device)

**Verification:**
- [ ] Tests: `npm test` (PIN-pad state machine and URL scrubbing as pure helpers)
- [ ] Manual: desktop Chrome — full pair → stream → mute → stop cycle with a fake or real host
- [ ] Manual: keyboard-only pass (no mouse) on the same flow

**Dependencies:** Task 9
**Files:** `src/viewer/index.html`, `src/viewer/main.tsx`, `src/viewer/PinPad.tsx`,
`src/viewer/Watch.tsx`, `src/viewer/viewer.css`
**Scope:** M

---

## Checkpoint 3 — End-to-end on the Fire TV (blocking)

- [ ] First frame within 3 s of PIN submission; pairing done with the remote alone; no on-screen keyboard
- [ ] `?debug=1` reports H.264 and stable 1080p30 with no growing dropped frames
- [ ] Audio audible and in sync; mute works; Stop ends playback within 1 s
- [ ] `npm run verify` green
- [ ] Human review: record results in `docs/manual-tests.md` before Phase 4

---

## Phase 4 — Host UI, polish and hardening

### Task 11: Host UI: URL list, QR code, viewer status, quality/audio toggles, error states

**Description:** Build the actual host window: every non-internal IPv4 URL as selectable text, a
QR code for the primary URL rendered in main with `qrcode` and passed through `HostState`
(payload `http://<ip>:<port>/?p=<pin>`), a large readable PIN with a countdown, source picker
(screen/window), quality selector (default 1080p) and audio switch (default on), live viewer
status with the device name, and human-readable errors instead of silent failures (source
capture denied, audio unavailable, no LAN interface, port fallback).

**Acceptance criteria:**
- [ ] QR encodes the reachable URL with the PIN and is scannable from a phone at arm's length
- [ ] PIN and countdown refresh visibly at expiry; scanning the QR opens the viewer with the PIN prefilled
- [ ] Start/Stop, quality and audio toggles reflect real engine state (no optimistic UI that lies)
- [ ] Each failure path from the spec shows a specific message, never a raw exception or a dead button
- [ ] No LAN-reachable page exposes the host UI or the PIN

**Verification:**
- [ ] Tests: `npm test` (QR payload builder and URL selection helpers)
- [ ] Manual: scan the QR with a phone, confirm prefill; toggle audio mid-session and watch the viewer

**Dependencies:** Checkpoint 3
**Files:** `src/main/qr.ts`, `src/main/main.ts`, `src/renderer/PairPanel.tsx`,
`src/renderer/App.tsx`
**Scope:** M

---

### Task 12: Viewer polish: autoplay-tap, mute/fullscreen/hotkeys, ICE-restart reconnect

**Description:** Handle the real-room cases: keep video playing when unmuted playback is blocked
and surface a single "press OK for sound" state; wire `m`/`f`/Enter hotkeys alongside the
buttons; auto-hide and restore controls; on `iceConnectionState === "failed"` attempt
`restartIce()` once, then show a reload prompt with a reconnect button; on host `stop`, show a
"host stopped sharing" screen rather than a frozen frame; keep the video filling the screen with
`object-fit: contain` and correct overscan margins.

**Acceptance criteria:**
- [ ] Unmuted playback blocked → video still plays, one clear affordance enables sound, no error toast
- [ ] `restartIce()` is attempted exactly once per failure and recovers a simulated drop (toggle the host's Wi-Fi or kill the server socket)
- [ ] Host `stop` produces the stopped screen within 1 s, and the viewer can re-pair without a reload
- [ ] Hotkeys and buttons stay in sync (mute state reflected in both)
- [ ] No control is reachable only by mouse or only by touch

**Verification:**
- [ ] Tests: `npm test` (reconnect state machine as a pure reducer)
- [ ] Manual: network-drop test on the real device; blocked-autoplay test in a fresh browser profile

**Dependencies:** Checkpoint 3
**Files:** `src/viewer/Watch.tsx`, `src/viewer/stats.ts`, `src/viewer/viewer.css`
**Scope:** M

---

### Task 13: Security pass, README and troubleshooting

**Description:** Consolidate the security posture with tests: CSP present on every served route,
origin check, token single-use, lockout, path traversal, and no secrets in any response. **The
README half was drafted early (user request, 2026-10-18)** — what it is, requirements, quick start,
the API by hand, the security model, known limits, troubleshooting and the license; what remains
here is re-verifying it from a clean checkout once there is an app to run, finishing the Fire TV
pairing walkthrough (type the URL once, bookmark it, then PIN only) and covering Silk accelerated
rendering, Windows Firewall, mDNS/AP-isolation symptoms, autoplay policies and the
audio-unsupported path in the troubleshooting table. Document the accepted risks from the spec
plainly.

**Acceptance criteria:**
- [ ] A test asserts the security headers and CSP on every route, including 404s
- [ ] A test asserts no response body contains the current PIN or an issued token
- [ ] README lets a stranger run the app, pair a Fire TV and diagnose the four documented failure modes
- [ ] Accepted risks (plain HTTP pairing, photographable QR, whole-system audio) are stated, not buried
- [ ] No **runtime** dependency added beyond `ws` and `qrcode` (`@types/ws` and the build tooling are dev-only)

**Verification:**
- [ ] Tests: `npm test` (new: `tests/security.test.ts`)
- [ ] Manual: follow the README from scratch on a clean checkout path and fix anything that lies

**Dependencies:** Task 11, Task 12
**Files:** `tests/security.test.ts`, `README.md`, `docs/manual-tests.md`, `src/server/http.ts`
**Scope:** M

---

### Task 14: Coverage ≥ 90%, `npm run verify` gate, full acceptance run

**Description:** Reach and hold the quality bar: ≥90% line coverage on `protocol.ts`, `audio.ts`,
`codecs.ts` and `pairing.ts`; `npm run verify` = lint + test + coverage + build + the no-STUN
`grep` gate; record every `SPEC.md` success criterion with its evidence (test name or manual log
entry) in `docs/manual-tests.md`.

**Acceptance criteria:**
- [ ] Coverage report shows ≥90% lines on the four pure modules
- [ ] `npm run verify` fails if `iceServers:` appears non-empty anywhere in `src/` or `dist/`, or if viewer code mentions `getUserMedia`, `getDisplayMedia` or `navigator.mediaDevices`
- [ ] Every one of the 17 spec success criteria has a named evidence row, or is explicitly marked "not verified" with the reason
- [ ] No skipped tests, no suppressed lint errors
- [ ] Working tree committed in logical chunks with messages that reference the spec sections

**Verification:**
- [ ] `npm run verify` green from a clean `node_modules` install
- [ ] Manual: full acceptance run on the Fire TV with the log filled in

**Dependencies:** Task 13
**Files:** `package.json`, `docs/manual-tests.md`, `tests/*.test.ts` (coverage gaps only)
**Scope:** M

---

## Checkpoint: Complete

- [ ] All 17 success criteria verified with evidence
- [ ] `npm run verify` green on a clean install
- [ ] Fire TV acceptance run logged with the device model and Silk rendering mode
- [ ] Human review and sign-off
