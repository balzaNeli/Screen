# screenmirror

Mirror your PC's screen **and its system audio** to a device on the same Wi-Fi, in a browser.
No account, no cloud, nothing to install on the viewer, and no traffic that leaves the LAN.

It exists for the case Deskreen makes awkward: an **Amazon Fire TV running Silk with a D-pad
remote** as the screen. Phones and tablets are supported, but every decision is made for the Fire
TV first — keyboard-less, touch-less, camera-less, weak SoC — and must not break the others.

> **Status: working, pre-release.** The LAN server, pairing, signalling, the Electron host UI
> (URL/PIN/QR panel), the capture engine and the viewer are written and tested. There is no
> installer or release; viewer polish, the security/README pass and the final acceptance remain.
> See [Status](#status).

## How it works

```
  host PC                                          viewer (Fire TV · phone · tablet)
  ┌────────────────────────────────┐               ┌──────────────────────────────┐
  │ Electron host window (file://) │               │ browser, no install, no app  │
  │  · screen + system audio       │               │  · receive-only WebRTC       │
  │  · screen capture, H.264 first │               │  · one <video>, D-pad or tap │
  └───────────────┬────────────────┘               └───────────────┬──────────────┘
                  │ IPC                                            │ HTTP + WebSocket
  ┌───────────────▼────────────────────────────────────────────────▼──────────────┐
  │ embedded Node server — 0.0.0.0:<port>                                          │
  │   GET  /            viewer page            POST /api/pair   PIN → token        │
  │   WS   /ws          signalling relay (offer / answer / ICE; never parses SDP)   │
  │   GET  /probe       hardware probe, for when a TV misbehaves                    │
  └────────────────────────────────────────────────────────────────────────────────┘
        the media never touches the server: WebRTC flows host ⇄ viewer, peer to peer
```

Pairing: the host window shows a URL, a QR code and a 6-digit PIN. The viewer submits the PIN
over plain HTTP on the LAN, gets a **single-use token**, and opens one WebSocket with it. The
server relays the SDP/ICE handshake between host and viewer and then gets out of the way — the
video and audio travel directly between the two devices.

## Status

| Piece | State |
|---|---|
| LAN server: static serving, `/api/info`, `POST /api/pair`, `/ws` relay | **done**, suite green |
| Pairing store: PIN TTL, rotation, 3-strike lockout, single-use tokens | **done** |
| Probe page at `/probe` for real-hardware questions | **done**, and it decided the transport |
| Electron host shell: window, permissions, IPC, host socket | **done**, verified against the real window (Task 8) |
| Host capture engine: `getDisplayMedia`, H.264, peer wiring | **done**, verified with a fake peer (Task 9) |
| Viewer UI: PIN pad, `<video>`, remote controls, `?debug=1` | **done**, verified in Edge and on the Fire TV (Task 10 / Checkpoint 3) |
| Host UI: LAN URLs, PIN countdown, QR, viewer status, source/quality/audio controls, failure text | **done**, verified over CDP and with a phone scan (Task 11) |

What you can run today: the full host and viewer. The host window shows every LAN URL, the rotating
PIN and the QR code, and starts the capture; scan the QR on a phone or type the PIN on the Fire TV.
The viewer walks the full pair → stream → mute/fullscreen/stop cycle, and the pairing endpoint can
still be exercised with `curl`. `npm run serve` runs the LAN server and viewer without the Electron
host (the PIN is printed in the terminal), so it is a protocol/dev tool, not the mirroring product.

## Requirements

- **Node.js 24+** — the source and the tests run as TypeScript with no compile step.
- **Windows** for system audio (Electron only exposes `audio: 'loopback'` there today). On macOS
  and Linux the app runs **video only** and says so.
- A **LAN** where devices can reach each other: no guest network, no AP/client isolation.
- For the primary target: a Fire TV with Silk. The measured reference is an `AFTCA002`.

## Quick start

```bash
npm install
npm run build        # compiles src/ to dist/ and bundles the two SPAs
npm start            # Electron host: capture, LAN URLs, PIN and QR
# or, without Electron:
npm run serve        # LAN server on :4680 (PORT=4681 to change), prints the PIN
```

The host window shows the QR, the LAN URLs and the PIN. Scan the QR with a phone, or open the URL
on the Fire TV and enter the PIN. `http://<lan-ip>:4680/probe` is the hardware probe; it runs its
safe checks (1–4) from a single button. `npm run serve` runs the viewer and API without capture
(the PIN is printed in the terminal), for protocol checks.

The pairing endpoint, by hand:

```bash
# POSIX shell, Git Bash, WSL
curl -X POST http://127.0.0.1:4680/api/pair \
  -H "content-type: application/json" -d '{"pin":"482720"}'
```

```powershell
# Windows PowerShell — verified on PS 5.1, which mangles inner quotes on the way to a native
# curl.exe (the JSON arrives as {pin:482720} and the server rightly calls it bad_request).
# Invoke-WebRequest has no such problem, and the catch prints the error body:
$body = '{"pin":"482720"}'
try   { (Invoke-WebRequest -Method Post -Uri http://127.0.0.1:4680/api/pair -ContentType application/json -Body $body -UseBasicParsing).Content }
catch { (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() }
```

Either way: `200 {"token":"…"}` · `401 {"error":"invalid_pin","attemptsLeft":2}` ·
`429 {"error":"locked","retryAfterMs":…}` · `409 {"error":"busy"}` ·
`400 {"error":"bad_request"}` for a malformed body. Substitute the PIN the server printed.

`npm start` launches the Electron shell against the existing `dist/`; run `npm run build` first.
`npm run dev` builds once, then rebuilds the web bundles on change and launches Electron
(main/preload are not watched, so restart it after main-process edits). `npm run serve` keeps the
server available without Electron, for probe and pairing checks.

## Commands

| Command | What it does |
|---|---|
| `npm run verify` | lint + test + build. **This is the gate** — there is no CI, run it before every commit |
| `npm test` | whole suite (`node --test`). The glob form is required |
| `npm run coverage` | the same, with line/branch numbers |
| `npm run lint` | `eslint . --max-warnings 0` — zero warnings allowed |
| `npm run build` | `tsc` for main/preload/server → `dist/`, then Vite for the renderer and viewer |
| `npm start` | the Electron host shell against the existing `dist/` (build first) |
| `npm run dev` | build once, then rebuild the web bundles on change and launch Electron |
| `npm run serve` | the LAN server alone, no Electron (`PORT=` overrides) |

## Privacy and security model

The whole point is that nothing leaves the house, so the rules are strict and written down:

- **No STUN, no TURN, no cloud.** `RTC_CONFIG.iceServers` is empty and frozen, asserted by unit
  test (and, from Task 14, by a `grep` gate in `verify`). Peer-to-peer is only ever attempted
  across the LAN, which is why the app is useless outside it — by design.
- **The host window is `file://`, never served over the LAN.** It shows the PIN; if it were on
  `0.0.0.0`, any device on the network could read the PIN by loading a URL.
- **The viewer is receive-only.** It never calls `getUserMedia`/`getDisplayMedia`, never asks for a
  permission, and never feature-detects `navigator.mediaDevices` — Silk hides that object on a TV
  with no camera, which is the origin of the "Silk has no WebRTC" myth. The peer connection is
  there. This rule is a `grep` gate as well.
- **One viewer at a time.** A second pairing is refused (`409`) while a session is live.
- PIN: 6 digits, 60 s TTL, rotates on expiry, on success and on the third failure, then a 60 s
  lockout. Tokens: 32 random bytes, single-use at WebSocket connect, dropped with the connection.
  The PIN never appears in a response body, in a log line, or on disk.
- The **host socket** additionally needs a per-boot secret token *and* must come from loopback, so
  a viewer can never claim the host role.
- **Accepted limit: HTTP is plain.** Anyone who can sniff the Wi-Fi can read the PIN and the
  token during the 60 s window. That is the home-LAN threat model; TLS with self-signed certs on a
  TV browser was judged not worth the friction.

## Known limits

These are real, measured, and documented on purpose — the interesting part of a mirroring tool is
where it breaks:

- **The Fire TV must never encode.** Two loopback probes at 720p30 froze an `AFTCA002` hard enough
  to need a power cycle (an MSE chunk-streaming test and a WebRTC one). The device has no headroom
  for anything beyond decode-and-display, which is exactly what it does here. See
  `docs/manual-tests.md`.
- **The receive ceiling is not measured yet**: 720p30 first, 1080p30 only if it holds flat, at
  Checkpoint 3 on real hardware. Until then the default quality is provisional.
- **System audio is Windows-only** and it is the **whole system mix**, not per application:
  sharing one window still sends every notification sound. The UI does not pretend otherwise.
- **`navigator.mediaDevices` is hidden** in Silk, so any future viewer-side capture (voice,
  screenshots) is off the table on this device.
- **Silk's accelerated rendering** may break other web-platform features on some Fire TV models;
  turning that setting off is the documented workaround.
- The Fire TV URL must be typed once with the remote — bookmark it.
- Browser autoplay policies may need one button press on the viewer before sound is audible
  (iOS Safari in particular); the mute button covers it.
- **AP/client isolation or a guest network kills it** — no route, no stream. Symptom and diagnosis
  live in the troubleshooting notes.
- Windows Firewall asks for permission on first run.
- Reconnect logic stops at ICE restart on `failed`; if that fails, the viewer reloads and re-pairs.
- Maximum one viewer, one screen at a time. Microphone capture, file transfer, whiteboard,
  multi-viewer and internet traversal are explicit non-goals for v1.

## Troubleshooting

- **Nothing loads on the TV**: Windows Firewall prompt never answered, or you are on the wrong
  network. The server prints every LAN URL it has — use that exact one.
- **Connects, then the picture freezes**: AP/client isolation. Same symptom from a VPN on the host.
- **A site claims Silk has no WebRTC**: the sites test for `navigator.mediaDevices`, which a Fire
  TV hides. The probe at `/probe` reports the truth in ten seconds.
- **Stutter or a slideshow instead of video**: check the negotiated codec (it should be H.264 —
  hardware decode) and whether something else on the network is saturating the link.
- **The TV became unresponsive during testing**: it was asked to encode. Power-cycle it, and do
  not re-run probe checks 4b or 6 on that device.

## Testing

```bash
npm run verify     # the gate: lint + tests + build, zero warnings
npm run coverage   # line/branch numbers for the suite
```

The suite runs TypeScript directly on Node 24 (`node --test`), starts **real servers on port 0**
and talks to them over real HTTP and WebSocket connections — nothing of ours is mocked, because
the mocks are what would be wrong. `npm run coverage` prints the numbers; the pairing store and
the signalling relay are the best covered files in the repo.

Everything that depends on a real screen, a real Wi-Fi link and a real TV is logged in
`docs/manual-tests.md`, including the runs that froze the hardware. That file is the project's
memory: it is where "it should work" gets replaced by a number.

## Roadmap

1. **Checkpoint 2** — protocol proven headlessly (done: two peers relay offer/answer/ICE through
   the real server; replayed token, foreign origin and three failed PINs (lockout) all rejected).
2. **Tasks 8–10** — Electron shell, capture engine and viewer app **done** (window, permissions,
   IPC, host socket, H.264 preference, live quality/audio; D-pad PIN pad, stream, controls and
   `?debug=1`).
3. **Checkpoint 3** — end-to-end on the Fire TV: **functionally passed 2026-10-19** (remote-only
   pairing, 1080p stream, audio and overlay controls); first-frame timing and a locked 1080p30
   remain measurement/tuning follow-ups.
4. **Task 11 — host UI done 2026-10-22**: LAN URLs, rotating PIN, QR with prefilled viewer, live
   viewer status, source/quality/audio controls and readable failure states; verified over CDP and
   by scanning the QR from a phone. **Tasks 12–14** — viewer polish, security/README pass, and the
   coverage + constraint gates in `verify`.

## Repository map

| Path | What is in it |
|---|---|
| `SPEC.md` | the source of truth for behaviour (rev 5, approved) |
| `tasks/plan.md` | phases, checkpoints, risks |
| `tasks/todo.md` | every task with its acceptance criteria |
| `docs/manual-tests.md` | hardware results, probe safety rules, acceptance runs |
| `src/shared/` | pure, runtime-free logic: protocol guard, codec and audio choice, `RTC_CONFIG` |
| `src/server/` | the entire LAN surface: static serving, pairing store, signalling relay |
| `src/renderer/`, `src/viewer/` | the two React SPAs: host window (`file://`) and viewer |
| `AGENTS.md` | notes for contributors working with an AI agent: commands, quirks, non-negotiables |

## Contributing

- Read `SPEC.md` first, then `tasks/todo.md`. Behaviour is specified before it is built, and the
  three files (spec, tasks, code) are kept in step — a commit names the task it implements.
- `npm run verify` must be green before a commit, with **zero** lint warnings and no skipped or
  deleted tests to get there.
- New runtime dependencies need a very good reason: `ws` and `qrcode` are the entire budget.
- Non-negotiables, in one line each: the viewer never captures, `iceServers` stays empty, the host
  UI stays off the LAN, and the signalling relay never parses SDP.

## License

MIT — see [LICENSE](LICENSE).
