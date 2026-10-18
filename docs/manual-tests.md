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
| 4b · same at 720p30 | not run yet |

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
- **Not measured: 720p30 and 1080p30.** Check 4b raises the canvas to 1280x720@30, which says more
  about the stick than 640x360 did. The 1080p30 criterion is still a Checkpoint 3 item.

## Checkpoint 3 — end-to-end acceptance (Fire TV)

| # | Check | Result |
|---|---|---|
| 1 | Host window shows every LAN URL and a 6-digit PIN | |
| 2 | Viewer starts within 3 s of submitting a valid PIN | |
| 3 | Glass-to-glass latency ≤ 250 ms | |
| 4 | Pairing completable with the remote alone, no on-screen keyboard | |
| 5 | Codec in `?debug=1` is H.264 | |
| 6 | 1080p30 holds, dropped frames flat over 2 min | |
| 7 | Fullscreen fills the panel, host screen edges not cropped | |
| 8 | Audio audible and in sync (click a window, hear the click) | |
| 9 | Viewer mute button silences and restores | |
| 10 | Host audio toggle mid-session stops viewer audio within 1 s | |
| 11 | Host Stop ends playback within 1 s; viewer shows "host stopped" | |
| 12 | Wrong PIN → error text; 4th attempt shows lockout time | |
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
  explicit, deliberate escalation.
