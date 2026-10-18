# Implementation Plan: screenmirror

## Overview

Mirror the host PC's screen + system audio to a Fire TV (Silk browser) and phones/tablets over
the LAN, with no cloud, no install on the viewer and no traffic off the network. Built as an
Electron host (capture + embedded HTTP/WS server + pairing) and a React viewer served from that
same server. 14 tasks across 4 phases, with 4 verification checkpoints. The Fire TV is the
device we cannot test from here, so the plan puts a probe on real hardware before any viewer UI
exists.

Source of truth for behaviour: `SPEC.md` (rev 5, approved — transport decided by probe evidence).

## Architecture decisions

1. **The host UI is loaded from `file://`, never served over the LAN.** It displays the PIN; if
   it were served on `0.0.0.0` any LAN device could read the PIN by loading a URL. LAN surface =
   viewer page + `/api/*` + `/ws` + `/probe` only. (This is why `setDisplayMediaRequestHandler`
   is wired for a `file://` origin, and why the host page talks to the server over IPC rather
   than `fetch`.)
2. **Server first, Electron later.** Pairing, static serving and signaling are the risky logic
   and all of it is testable headlessly with `node:test`. Electron is a shell added in Task 8,
   and by then the protocol is already proven.
3. **`/probe` was a gate, and it is now a regression tool.** Task 4 ran on the real Fire TV and
   answered the transport question before any viewer UI existed (see Checkpoint 1). The page
   stays because a second Fire TV model, a Silk update or a friend's device will ask the same
   questions again.
4. **Renderer owns the peer connection; main owns capture + server + IPC.** One message envelope
   (`Signal`) is used on the wire and over IPC, so no translation layer can drift.
5. **Pure logic lives in `src/shared/`** (protocol guards, `audioModeFor`, `preferH264`, pairing
   store) so it is unit-testable without a browser or Electron.
6. **Two runtime dependencies only**: `ws` and `qrcode`. Everything else is Node/Electron/Vite
   built-in or dev-only.
7. **Tests run straight on TypeScript** via Node 24 type stripping + tsc's
   `rewriteRelativeImportExtensions`. If that route fights the Electron build, the documented
   fallback is `tsc -p tsconfig.test.json && node --test dist-test` (Task 1/2 prove it early).

## Task list

Tasks are recorded in full in `tasks/todo.md` (index below mirrors it).

### Phase 1 — Skeleton and fail-fast gate
- [x] Task 1: Repo scaffold (build, lint, test wiring)
- [x] Task 2: `src/shared` protocol, audio and codec modules + unit tests
- [x] Task 3: Static HTTP server with path allowlist, `/api/info`, `/probe`
- [x] Task 4: probe page + manual test log (check 6 capped and double-confirmed after it froze a TV)

### Checkpoint 1 — Fire TV gate (PASSED 2026-10-18)
- [x] `/probe` run on a real `AFTCA002` (Silk 144); results and safety rules in `docs/manual-tests.md`
- [x] **Branch A chosen**: `RTCPeerConnection` is present in Silk itself — no browser install, no
      sideload. Branch B was rejected on evidence (no recordable H.264 container; the MSE loopback
      test froze the device hard)
- [x] Requirement derived from the probe: **the viewer is receive-only** and never touches
      `navigator.mediaDevices`, which Silk hides
- [x] `npm run lint && npm test && npm run build` green
- [x] Review with human
- [x] Probe check 4 (capped WebRTC loopback, 640x360@15) run on the TV: connected, `video/H264`
      negotiated, first frame 942 ms, 420 of 450 frames painted — the "connects on paper only" risk
      is closed
- [ ] Probe check 4b (720p30) run on the TV. Not blocking Phase 2

### Phase 2 — Pairing and signaling
- [x] Task 5: Pairing store (PIN TTL, rotation, 3-strike lockout, single-use tokens) + unit tests
- [x] Task 6: `POST /api/pair` + integration tests
- [x] Task 7: WebSocket signaling relay with token/origin validation + two-peer integration tests

### Checkpoint 2 — Protocol proven headlessly
- [x] Two fake peers complete offer/answer/ICE relay through the real server
- [x] Replayed token, foreign origin, wrong/missing host token and the 4th failed PIN all rejected
- [x] `npm run verify` green (35 tests)
- [ ] Human review before the Electron shell is written

### Phase 3 — First real frame (walking skeleton)
- [ ] Task 8: Electron shell: security posture, permission handlers, Chromium switches, preload IPC
- [ ] Task 9: Host capture engine: `getDisplayMedia`, H.264 preference, quality/audio, peer wiring
- [ ] Task 10: Viewer app: D-pad PIN pad, `<video>`, overlay controls, `?debug=1` stats

### Checkpoint 3 — End-to-end on the Fire TV (blocking)
- [ ] First frame within 3 s of PIN submission, remote-only pairing, no on-screen keyboard
- [ ] H.264 negotiated, 1080p30 holds, audio audible, mute works, Stop ends playback ≤ 1 s
- [ ] Review with human before Phase 4

### Phase 4 — Host UI, polish and hardening
- [ ] Task 11: Host UI: URL list, QR code, viewer status, quality/audio toggles, error states
- [ ] Task 12: Viewer polish: autoplay-tap, mute/fullscreen/hotkeys, ICE-restart reconnect
- [ ] Task 13: Security pass, README and troubleshooting (Silk accelerated mode, firewall, mDNS)
- [ ] Task 14: Coverage ≥ 90% on the four pure modules, `npm run verify` gate, full acceptance run

### Checkpoint: Complete
- [ ] Every success criterion in `SPEC.md` verified, with Fire TV items logged in
      `docs/manual-tests.md`
- [ ] `npm run verify` green, no suppressions added, no test skipped or deleted
- [ ] README lets a stranger reproduce setup, pairing and the known limits

**Parallelization:** Task 11 and Task 12 are independent once Checkpoint 3 passes. Everything
else is sequential through the dependency chain. Tasks 5–7 and 11–12 are the safest places to
split work across sessions.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| **Silk has no WebRTC** (the claim repeated all over the web) | Was High | **Answered by the probe, 2026-10-18**: Silk 144 has `RTCPeerConnection`. What it hides is `navigator.mediaDevices` — a TV has no camera or microphone — which is what sites really mean when they report "no WebRTC". The viewer is receive-only, so it never needs that object |
| **A real Fire TV peer connection connects on paper but not in practice** (ICE/DTLS under Silk, accelerated rendering) | Was High | **Closed 2026-10-18**: probe check 4 connected and negotiated `video/H264` on the real device (first frame 942 ms). Remaining exposure is throughput at 1080p30, measured at Checkpoint 3 |
| MSE chunk streaming as a fallback transport | — | **Rejected**: the loopback test froze the Fire TV hard (needed a power cycle) and this device cannot record an H.264 container. `SPEC.md` records the rejection; the probe keeps a capped, double-confirmed version of the test purely as evidence |
| A Fire TV Stick cannot sustain 1080p30 | Med | **4b, 2026-10-18: the 720p30 loopback hung the device hard (power cycle)** — but as the *sender*, which the product never is. The receive-only path is still unmeasured: Checkpoint 3 tries 720p30 first, 1080p30 only if it holds flat, and a slowdown lowers the default quality. H.264 hardware decode is the main mitigation |
| `audio: 'loopback'` produces silence on this Windows build | Med | Task 9 checks the track exists with sane `getSettings()`; real audibility at Checkpoint 3; degrade path to video-only is already specified |
| The mDNS Chromium switch is a no-op or renamed | Med | Treated as unverified until Task 7/9; README keeps mDNS troubleshooting; revert is one line |
| Node type stripping + `rewriteRelativeImportExtensions` fights the Electron/tsc build | Med | Tasks 1–2 prove the route before any real code; documented fallback to compiled tests |
| Fire TV remote focus/hotkeys behave differently in Silk | Med | All controls are real `<button>`s first, hotkeys second; hotkey list kept to four keys |
| `file://` origin is refused for `display-capture` permission | Med | Task 8 verifies immediately; fallback is a second loopback-only listener for the host page |
| LAN devices blocked by Windows Firewall | Low | README documents the prompt and the allow rule |
| Fire TV model differs from assumptions (4K, older Silk) | Low | Model and Silk rendering mode recorded in the manual log |

## Open questions

None blocking. Checkpoint 1 answered both data points: device `AFTCA002`, Silk 144, and the
rendering mode still worth recording in `docs/manual-tests.md` when it is next noticed.
