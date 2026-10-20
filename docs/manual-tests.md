# Manual tests

Automated tests cover the server, the protocol guards and the pairing store. Everything that
depends on a real screen, a real Wi-Fi link and a real TV is logged here, because that is where
this project actually fails.

## Checkpoint 1 — Fire TV probe results (2026-10-18, DONE)

Device: `AFTCA002` (Silk 144.12.355919, Chromium 144.0.7559.246, reported as Android 7.1.2).
TV rendering mode at the time of the run: _fill in if you remember it_.

| Check | Result |
|---|---|
| 1 · `RTCPeerConnection` | **yes** |
| 1 · `navigator.mediaDevices` | **no** — no camera/mic on a TV, so Silk hides the whole object |
| 1 · `MediaSource` / `MediaRecorder` | yes / yes |
| 1 · `setCodecPreferences` / `requestVideoFrameCallback` | yes / yes |
| 1 · screen | 1920x1080 @1x |
| 2 · codecs | VP8, rtx, **H264**, AV1, VP9, red, ulpfec, H265, flexfec-03 |
| 3 · recordable + playable container | only `video/webm;codecs="vp8,opus"` and `vp9,opus` |
| 3 · H.264 recording | **impossible**: `MediaSource=yes` but `MediaRecorder=no` for every `avc1`/`mp4` type |
| 4 · MSE loopback (old check) | **hung the Fire TV hard** — needed a power cycle |
| 4 · WebRTC loopback, 640x360@15, 30 s | **connected, paints, H.264 negotiated.** first frame 942 ms; 420 painted frames (13.9 fps of 15); playback quality total=429 dropped=64 |
| 4b · same at 720p30 | **hung the device hard** — needed a power cycle, exactly like the old MSE loopback. The log reached `connecting → connected` and stopped there: no frame numbers. Not re-run |

### Decision: Branch A (WebRTC)

The decision rule fired on check 1: `RTCPeerConnection` is present **in Silk itself**, so no
browser install is needed. Branch B is dead on evidence, not on preference:

- no H.264 container can be recorded, so Branch B could only ever send CPU-decoded VP8/VP9 —
  exactly the workload that froze the device during the MSE loopback test;
- the MSE path has no flow control; a slow decoder turns into an unbounded buffer.

**Consequences that are now requirements:**

1. **The viewer is receive-only.** It must never call `getUserMedia`/`getDisplayMedia`, never
   request a permission, and never feature-detect on `navigator.mediaDevices`. Sites that do
   report "Silk has no WebRTC" — the capability is there, the media *device* object is not.
2. H.264 stays first in the codec preference: H264 is offered, and hardware decode is the
   difference between 1080p30 and a slideshow on this stick.
3. `preferH264` must not filter VP8/VP9 out — Silk's H.264 hardware path is per-codec, and a
   failed H.264 negotiation must still fall back.

### What check 4 proved, and what it did not (2026-10-18, 17:33)

Measured on the same `AFTCA002`: `connecting → connected`, **negotiated codec `video/H264`** (the
preference took effect), first painted frame at 942 ms, 420 painted frames over 30 s (13.9 of the
15 requested), `getVideoPlaybackQuality` total=429 dropped=64.

Reading it honestly:

- **It works.** ICE and DTLS complete in Silk, H.264 negotiates and hardware-paints. The single
  biggest remaining unknown — "connects on paper but not in practice" — is answered.
- **942 ms is a same-device loopback** with no network RTT, and it includes keyframe wait. The
  ≤3 s first-frame criterion has plenty of room, but the real number comes from Checkpoint 3.
- **64 dropped frames (15%) is a worst case, not a forecast.** In that test the stick was
  simultaneously capturing a canvas, encoding H.264 *and* decoding it, while compositing a 1080p
  screen. In the real product the Fire TV only decodes, and the encoding happens on the PC.
- **720p30 and 1080p30 are still unmeasured for the receive-only path** — check 4b answered a
  different question, and answered it loudly (below).

### What check 4b proved (2026-10-18, later): never make this device encode

`4b` is the same loopback at 1280x720@30. Result: the Fire TV **hung hard and needed a power
cycle**, exactly like the MSE loopback. The log only reached `connecting → connected`; nothing was
printed before it stopped responding.

Read it with the right workload in mind:

- in the probe loopback **the stick is the sender**: it captures a canvas, *encodes* 720p30 H.264,
  then decodes its own stream, while Silk is still compositing a 1080p UI. The likely culprit is
  the encode path — software H.264 on a stick CPU — not decode;
- **the product never does that.** The viewer is receive-only: the PC captures and encodes, the TV
  decodes one stream, which is the workload the stick is built for;
- so 4b does **not** prove that 720p30 cannot be *received* here. It does prove this device has no
  headroom for anything extra: asking it to produce media is how you brick it.

Consequences, now requirements:

1. Nothing that captures or encodes media ever runs on the viewer. That was already a
   non-negotiable; 4b is the second measurement that says why.
2. The receive-only budget is unproven, so Checkpoint 3 measures **720p30 first**, and 1080p30 only
   if 720p30 holds flat over two minutes. A slowdown there is a product finding, not a test
   finding — it lowers the default quality.
3. Check 4b is not re-run on this device; it now asks for a second confirming tap, like check 6.

## Task 8 — Electron shell (2026-10-19, Windows 11 build 26200, Electron 44.9.0)

Driven over the Chrome DevTools Protocol against the real `npm start` window and main process
(remote debugging on 9222; no mocks, no browser automation framework).

| Check | Result |
|---|---|
| Host page from `file://` | yes, `dist/renderer/index.html`; the meta CSP applies and Electron shows no security warning |
| `window.mirror` | exactly the 8 functions in the SPEC code block (listSources, capabilities, start, setAudio, stop, onSignal, sendSignal, onState). SPEC prose says "9"; the block lists 8 |
| Node backdoors | `require`, `process`, `module`, `fs` are all `undefined` in the renderer |
| Permissions before capture | `getUserMedia` -> `NotAllowedError`; geolocation -> `User denied Geolocation`; no camera/mic grant |
| Display capture | screen `1920x1080@30` plus a `"System audio"` loopback track; `start()` returned `{ audio: true }` |
| Navigation | `window.open(...)` returns `null` (denied); assigning `location.href` leaves the `file://` URL unchanged |
| Host socket + IPC relay | a viewer paired over HTTP; its offer arrived through `onSignal`; an answer from `sendSignal` reached the viewer |
| State push | LAN URL + 6-digit PIN once a second; viewer join/leave reflected in `viewer`, audio state follows the selection |
| `/api/info` from the LAN IP | `200` while the Electron app runs |
| Window close | `window.close()` exits the app; the port is released |

**Electron 44 permission detail:** `getDisplayMedia` reaches `setPermissionRequestHandler` as a
`media` request, not `display-capture`. The handler allows `media` only for the host
`webContents` while a source is armed, and `setDisplayMediaRequestHandler` remains the gate that
chooses the source. Camera/microphone requests without an armed source are denied (verified);
other permissions (`geolocation`, `hid`, `usb`, ...) are denied unconditionally.

## Task 9 — host capture engine (2026-10-19, Windows 11 build 26200, Electron 44.9.0)

Driven over CDP against the real host window, with a Node viewer socket paired through the real
server and a fake `RTCPeerConnection` in the host renderer. The fake peer had its own `<video>`
sink, so `getStats()` reflects a real decode. No Task 10 viewer and no TV were involved.

| Check | Result |
|---|---|
| Offer order | first video payload `H264/90000`; VP8 and VP9 still offered as fallback; no codec filtered |
| Peer configuration | wrapper observed exactly `[{"iceServers":[]}]` at construction; the engine also refuses a non-empty list at runtime |
| Negotiated codec | fake peer `codecId` -> `video/H264`; host outbound `codecId` -> `video/H264` |
| Resolution / frames | 1920x1080; fake peer decoded 10 frames; host `framesSent=10`, `framesEncoded=10`, `bytesSent=367787` |
| Frame rate | 1 fps in both `getStats()` reports because the captured desktop was static; the live track reports 1920x1080@30 and the capture was capped at 30. This is not a throughput result — Checkpoint 3 measures that on the TV |
| `contentHint` | `"detail"` on the captured video track |
| Quality cap, live | 1080p -> 720p: track settings 1280x720@30, constraints `width.max=1280`, `height.max=720`, `frameRate.max=30`; back to 1080p: 1920x1080@30, same track, no new capture |
| Audio off/on, live | inbound audio bytes over 1.5 s: 2625 on -> 35 off -> 2660 on again; `pc.connectionState` stayed `connected`; `HostState.audio` followed false/true |
| Stop | video track `readyState` -> `ended`, preview cleared, viewer socket closed by the server, `HostState.audio` false |
| Second start | new capture at 1920x1080@30 and a new offer, no app reload |
| Start before the viewer | capture waits at "Capturing. Waiting for a viewer."; after a viewer paired and connected, the offer arrived. This is the SPEC user story order |
| Audio-unsupported OS | **not run** — this host has Windows loopback. The branch is covered by `audioModeFor` unit tests and the main-process grant; it still needs a macOS/Linux run |
| Unit tests | `npm test` 39 passing (2 new `videoConstraints` tests; existing `preferH264` coverage) |

**Design note:** audio removal uses `replaceTrack(null)` on the sender held from the offer (the
SPEC's fallback), not `removeTrack` + renegotiation. That is what keeps the video connection from
glitching; the track is kept alive so `setAudio(true)` can restore it without a new SDP exchange.
The first offer is also withheld until a viewer seat exists: main pushes `HostState.viewer`, and the
engine offers on the join instead of sending an offer into an empty relay.

## Task 10 — viewer app (2026-10-19, Windows 11 build 26200, Electron 44.9.0, Edge 155)

The viewer at `http://127.0.0.1:4680/` was driven over CDP against the real Electron host and the
real signalling server; the host captured the full 1920x1080 desktop. No TV or phone was involved.
Edge was launched with `--disable-features=CalculateNativeWinOcclusion
--disable-background-timer-throttling --disable-backgrounding-occluded-windows
--disable-renderer-backgrounding` because a covered/background tab throttles timers and does not
paint `:focus`; both are artifacts of testing a viewer in a desktop tab, not of the foreground TV.

| Check | Result |
|---|---|
| QR link / URL scrub | `?p=<pin>&debug=1` → six slots prefilled; address bar `/?debug=1`; `history.state === null`. `replaceState` replaces the entry, so the `?p=` URL is never a Back target |
| No virtual keyboard | `document.querySelectorAll("input").length === 0` on the pad, before and after failed attempts |
| Keyboard-only pairing | prefilled PIN: focus is on Connect, Enter pairs. Empty pad: focus is on "1", Tab + Enter enters digits (desktop Chrome has no D-pad spatial navigation; Silk's arrow model is Checkpoint 3 item 4) |
| Pair → stream | Enter → real offer/answer through the server; `<video>` playing at 1920x1080, unmuted because the Enter was a user gesture; host `HostState.viewer` set |
| `?debug=1` | `codec video/H264`, `video 1920x1080`, fps 0–34 on a static desktop, moving bitrate and audio level; not the TV throughput result |
| Mute / Sound | button toggles `video.muted` true/false; `srcObject` and playback survive |
| Fullscreen | enters and exits with a real click; `document.fullscreenElement` follows |
| Controls | hide after 5 s, any key brings them back; focused button shows a 4 px white outline (measured with CDP focus emulation, because a background page does not paint `:focus`) |
| Viewer Stop | sends `stop`, closes peer/socket, returns to the pad with "You stopped watching."; the consumed QR PIN is not prefilled again (empty pad, focus "1"); host Ready and seat free, no reload |
| Host Stop | viewer shows "The host stopped sharing." and returns to the pad; host Ready |
| Wrong PIN / lockout | 000000 typed with Tab + Enter only: "Wrong PIN. 2 attempts left." → "1 attempt left" → "Too many attempts. Try again in 60 s."; keys disabled; the 6th digit auto-submits |
| Focus after failure | found a race: `focus()` ran while React still had the keys disabled, so focus could leave the pad. The restore now runs in an effect keyed on a reset tick; retest lands on "1" every time |
| Receive-only grep | no `getUserMedia`, `getDisplayMedia`, `navigator.mediaDevices`, permission call, inline style or `innerHTML` in `src/viewer` |
| CSP / styling | the only stylesheet is the built `/assets/viewer-*.css`; no inline `<script>`/`<style>`; the page renders under the server's `default-src 'self'` |
| Tests | `npm test`: 4 new `pin.ts` tests (pad reducer, completion, scrub, invalid/missing `p`), 43 total; `npm run verify` green; `npx tsc -p tsconfig.json` clean |

**Not verified here:** first-frame latency, real D-pad arrow navigation, 1080p30 throughput,
hardware decode and audible audio on the Fire TV — all Checkpoint 3. The viewer attempts unmuted
playback because Enter was a trusted gesture; when autoplay refuses it falls back to muted with the
Sound control, which is the path a TV may take.

## Checkpoint 3 — end-to-end acceptance (Fire TV)

| # | Check | Result |
|---|---|---|
| 1 | Host window shows every LAN URL and a 6-digit PIN | |
| 2 | Viewer starts within 3 s of submitting a valid PIN | |
| 3 | Glass-to-glass latency ≤ 250 ms | |
| 4 | Pairing completable with the remote alone, no on-screen keyboard | |
| 5 | Codec in `?debug=1` is H.264 | |
| 6 | Walk up: **640x360@15** (known-good from the probe) → **720p30** → **1080p30** only if each holds flat over 2 min. Any slowdown: stop, power-cycle, and that step is the product's ceiling | |
| 7 | Fullscreen fills the panel, host screen edges not cropped | |
| 8 | Audio audible and in sync (click a window, hear the click) | |
| 9 | Viewer mute button silences and restores | |
| 10 | Host audio toggle mid-session stops viewer audio within 1 s | |
| 11 | Host Stop ends playback within 1 s; viewer shows "host stopped" | |
| 12 | Wrong PIN → error text; the third failure shows the 60 s lockout time | |
| 13 | Re-pair after Stop works without reloading the viewer | |
| 14 | Wi-Fi drop → reconnect prompt appears, re-pair succeeds | |
| 15 | Fire TV Back exits the viewer without leaving a stalled stream | |

## Phone / tablet pass (fill after Checkpoint 3)

| # | Check | Result |
|---|---|---|
| 1 | QR code scans from arm's length and opens the viewer | |
| 2 | PIN is prefilled and absent from the address bar afterwards | |
| 3 | Sound plays after one button press at most (iOS autoplay policy) | |
| 4 | Mute and fullscreen work on a touch device | |

## Probe safety rules (added after the freeze)

- Check 6 (MSE) requires a second confirming click, runs at 640x360@15, caps its append queue at
  24 buffers and stops itself after 20 s. It is a diagnostic, and a diagnostic that bricks the
  device is worse than no diagnostic.
- The WebRTC check defaults to 640x360@15 and stops itself after 30 s. "Retry at 720p30" is an
  explicit, deliberate escalation — **and it hung this device hard on 2026-10-18** (power cycle,
  `connecting → connected`, no numbers). It now asks for a second confirming tap, like check 6, and
  it is not re-run on this TV.
- Two hard hangs, both times when the stick had to *produce* media: MSE loopback, and the 720p30
  WebRTC loopback. The rule that follows: media never leaves the viewer.
