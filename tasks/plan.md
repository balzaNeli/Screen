# Implementation Plan: screenmirror

## Overview

Mirror the host PC's screen + system audio to a Fire TV (Silk browser) and phones/tablets over
the LAN, with no cloud, no install on the viewer and no traffic off the network. Built as an
Electron host (capture + embedded HTTP/WS server + pairing) and a React viewer served from that
same server. 14 tasks across 4 phases, with 4 verification checkpoints. The Fire TV is the
device we cannot test from here, so the plan puts a probe on real hardware before any viewer UI
exists.

Source of truth for behaviour: `SPEC.md` (rev 3, approved).

## Architecture decisions

1. **The host UI is loaded from `file://`, never served over the LAN.** It displays the PIN; if
   it were served on `0.0.0.0` any LAN device could read the PIN by loading a URL. LAN surface =
   viewer page + `/api/*` + `/ws` + `/probe` only. (This is why `setDisplayMediaRequestHandler`
   is wired for a `file://` origin, and why the host page talks to the server over IPC rather
   than `fetch`.)
2. **Server first, Electron later.** Pairing, static serving and signaling are the risky logic
   and all of it is testable headlessly with `node:test`. Electron is a shell added in Task 8,
   and by then the protocol is already proven.
3. **`/probe` is a gate, not a nicety.** Task 4 runs on the real Fire TV, reports whether Silk
   does WebRTC and which codec it decodes, and Checkpoint 1 blocks the rest of the plan on that
   answer. If it fails, the transport changes (MJPEG, no audio) and that is a spec change.
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
- [ ] Task 1: Repo scaffold (build, lint, test wiring)
- [ ] Task 2: `src/shared` protocol, audio and codec modules + unit tests
- [ ] Task 3: Static HTTP server with path allowlist, `/api/info`, `/probe`
- [ ] Task 4: `docs/silk-probe.html` + manual test log skeleton

### Checkpoint 1 — Fire TV gate (blocking)
- [ ] `/probe` runs on the real Fire TV; all five checks (WebRTC present, codec list, MSE and
      MediaRecorder types, MSE loopback time-to-first-frame, fps after 30 s) are recorded in
      `docs/manual-tests.md`
- [ ] Branch A or Branch B chosen by the rule in `SPEC.md` (A if any installable browser has
      `RTCPeerConnection`)
- [ ] `npm run lint && npm test && npm run build` green
- [ ] Review with human before Phase 2 (if neither branch is viable, stop and revise `SPEC.md`)

### Phase 2 — Pairing and signaling
- [ ] Task 5: Pairing store (PIN TTL, rotation, 3-strike lockout, single-use tokens) + unit tests
- [ ] Task 6: `POST /api/pair` + integration tests
- [ ] Task 7: WebSocket signaling relay with token/origin validation + two-peer integration tests

### Checkpoint 2 — Protocol proven headlessly
- [ ] Two fake peers complete offer/answer/ICE relay through the real server
- [ ] Replayed token, foreign origin and 4th failed PIN all rejected
- [ ] `npm run verify` green

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
| Silk has no WebRTC (reported) and no installable browser on the Fire TV has it either | High | Already realised for Silk; both branches specified with their own probe checks in Task 4; Checkpoint 1 decides on evidence. Branch B (MSE + WS) still needs MSE, which is what Silk is built for |
| Branch B's MSE live edge drifts or stalls | Med | Live-edge trimming kept to the simplest working rule; buffer health exposed in `?debug=1`; Branch B is only taken if A is impossible |
| A Fire TV Stick cannot sustain 1080p30 on either branch | Med | Probe check 5 measures it before UI work; quality selector defaults to 1080p and can drop to 720p |
| `audio: 'loopback'` produces silence on this Windows build | Med | Task 9 checks the track exists with sane `getSettings()`; real audibility at Checkpoint 3; degrade path to video-only is already specified |
| The mDNS Chromium switch is a no-op or renamed | Med | Treated as unverified until Task 7/9; README keeps mDNS troubleshooting; revert is one line |
| Node type stripping + `rewriteRelativeImportExtensions` fights the Electron/tsc build | Med | Tasks 1–2 prove the route before any real code; documented fallback to compiled tests |
| Fire TV remote focus/hotkeys behave differently in Silk | Med | All controls are real `<button>`s first, hotkeys second; hotkey list kept to four keys |
| `file://` origin is refused for `display-capture` permission | Med | Task 8 verifies immediately; fallback is a second loopback-only listener for the host page |
| LAN devices blocked by Windows Firewall | Low | README documents the prompt and the allow rule |
| Fire TV model differs from assumptions (4K, older Silk) | Low | Model and Silk rendering mode recorded in the manual log |

## Open questions

None blocking. Two data points to capture during Checkpoint 1: the exact Fire TV model and
whether Silk is in accelerated or on-device rendering mode.
