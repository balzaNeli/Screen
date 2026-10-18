# Manual tests

Automated tests cover the server, the protocol guards and the pairing store. Everything that
depends on a real screen, a real Wi-Fi link and a real TV is logged here, because that is where
this project actually fails.

## How to run the probe

1. Start the host: `npm run dev` (or `npm start` after `npm run build`).
2. Read the LAN URL from the host window (e.g. `http://192.168.1.23:4680`).
3. On the Fire TV, open `<url>/probe` and press **Run all** with the remote.
4. Photograph the screen and fill in the table below.
5. Decide the branch with the rule underneath, then say it out loud in the commit message.

## Fire TV probe results

| Field | Value |
|---|---|
| Fire TV model | _fill in_ |
| Fire OS version | _fill in_ |
| Browser (from the `ua:` line) | _fill in_ |
| Silk rendering mode (Settings → Silk → Accelerated/Off) | _fill in_ |
| 1 · `RTCPeerConnection` present | _yes / no_ |
| 2 · H.264 variants reported | _list / none_ |
| 3 · Best recordable+playable container | _type / none_ |
| 4 · MSE loopback rendered | _yes / no_ |
| 4 · Time to first painted frame | _ms_ |
| 4 · Container actually used | _type_ |
| 5 · Painted fps after 30 s | _fps_ |
| 5 · Dropped frames | _n_ |
| 5 · Approximate pipeline delay | _s_ |
| 5 · Audio track present + hum audible | _yes / no_ |
| Notes / error text on screen | _fill in_ |

### Decision rule

- `RTCPeerConnection` = **yes** in any browser installable on this TV → **Branch A** (WebRTC,
  250 ms target). Record which browser and how it was installed.
- `RTCPeerConnection` = **no** and check 4 renders → **Branch B** (MSE + WebSocket, ~1.5 s).
- Both **no** → stop. The spec's transport section needs revisiting before more code is written.

## Checkpoint 1 — worked? (fill after the probe)

- [ ] Probe reachable at `<url>/probe` and every button worked with the remote alone
- [ ] Branch decided: **A** / **B**
- [ ] `npm run verify` green on this commit

## Checkpoint 3 — end-to-end acceptance (Fire TV)

| # | Check | Result |
|---|---|---|
| 1 | Host window shows every LAN URL and a 6-digit PIN | |
| 2 | Viewer starts within 3 s of submitting a valid PIN | |
| 3 | Glass-to-glass latency (A: ≤250 ms · B: ≤1.5 s) | |
| 4 | Pairing completable with the remote alone, no on-screen keyboard | |
| 5 | Codec in `?debug=1`: H.264 (A) or MP4/AVC container (B) | |
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
