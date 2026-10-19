# screenmirror — agent notes

Lan-only screen + system audio mirroring. An Electron host captures the screen and sends it over
WebRTC to a browser viewer. The primary viewer is an Amazon Fire TV running Silk; phones/tablets
are secondary. Nothing ever leaves the local network — no STUN, no TURN, no cloud.

`SPEC.md` (rev 5, approved) is the source of truth for behaviour, `tasks/plan.md` maps phases and
checkpoints, `tasks/todo.md` holds the per-task acceptance criteria. Spec first, then tasks, then
code — and keep all three in step with the code: commits name the spec task they implement.
`README.md` was drafted early; Task 13 re-verifies it once the whole app runs.

## Commands

- `npm run verify` — lint + test + build. This is the gate; **there is no CI**. Run it before
  every commit.
- `npm test` / `npm run coverage` — `node --test "tests/**/*.test.ts"`. The glob form is required;
  `node --test tests/` does not work. Node 24 strips the types, there is no compile step.
- `npm run build` — `build:main` (`tsc -p tsconfig.main.json` → `dist/`) then `build:web`
  (vite → `dist/renderer`, `dist/viewer`).
- `npm run serve` — standalone HTTP server on `:4680` (`PORT=` overrides), for the Fire TV.
  It loads `dist/`, so build first.
- `npm start` — the Electron host shell against the existing `dist/` (build first).
- `npm run dev` — one full build, then Vite `build --watch` + `npx electron .`; restart it after
  main/preload edits because only the web bundles are watched.
- `npm run lint` — `eslint . --max-warnings 0`. `docs/**` is ignored on purpose.

## Type checking stops short of the React apps

`npm run build:main` checks only `src/main`, `src/preload`, `src/server`, `src/shared`. Nothing
type-checks `src/renderer`, `src/viewer`, `tests/` or `scripts/` — Vite strips types without
checking them, and the eslint config is not type-aware. Run `npx tsc -p tsconfig.json` (noEmit,
covers everything, currently clean) after touching those.

## TypeScript quirks that will bite

- Relative imports carry the real extension: `import { startServer } from "../src/server/http.ts"`.
  `rewriteRelativeImportExtensions` turns them into `.js` in `dist`. Do not "fix" the `.ts`.
- `erasableSyntaxOnly`: no `enum`, no `namespace`, no constructor parameter properties.
- `verbatimModuleSyntax`: type-only imports need `import type` / inline `type`.
- `strict` + `noUncheckedIndexedAccess`.
- No formatter is configured — match the surrounding style (double quotes, semicolons, 2 spaces,
  ~100 columns).
- Tests use `node:test` + `node:assert/strict`, and they exercise the real code: `startServer({
  port: 0, ... })` against a temp web root (`fixture` / `withServer` in `tests/http.test.ts`).
  Do not mock our own modules.
- Git prints "LF will be replaced by CRLF" on this Windows checkout (`core.autocrlf=true`, LF in
  the index). Expected, not a bug to fix.

## Wiring worth knowing before you touch it

- `src/shared/` is runtime-free and pure — the only place testable without a browser or Electron:
  `protocol.ts` (`Signal` union + `parseSignal`, the boundary guard for anything off a socket),
  `codecs.ts` (`preferH264`), `audio.ts` (`audioModeFor`), `rtc.ts` (`RTC_CONFIG`),
  `capture.ts` (`videoConstraints`, the quality caps applied with `applyConstraints`).
- `src/renderer/mirror.ts` owns the host capture + peer connection: one `getDisplayMedia`, H.264
  preference before the offer, first offer withheld until `HostState.viewer` is non-null, live audio
  via `replaceTrack` on the held sender (no renegotiation), and `release()` on stop/bye/error.
- `src/server/http.ts` is the entire LAN surface: viewer page at `/`, `/assets/*` through a
  containment check, `/api/info`, `/api/pair`, `/probe*` from a fixed-name allowlist
  (`PROBE_FILES`), and the `ws` upgrade for `/ws`. The host UI is deliberately **not** served
  here — it shows the PIN, so it stays on `file://`.
- `src/server/ws.ts` is the signalling relay: one host socket (boot `hostToken`, loopback only)
  and one viewer socket (single-use pairing token, same-origin), frames validated by `parseSignal`
  and never buffered. `stop` closes both; a drop frees the seat and tells the host with `bye`.
- `src/server/pairing.ts` is a pure store with the clock injected: PIN TTL/rotation/lockout,
  single-use tokens, one viewer seat. `src/server/lan.ts` is pure when handed an interface map.
- `src/main/` is the Electron shell: `main.ts` starts the server, owns the host WebSocket (the boot
  token never reaches the renderer), pushes `HostState`, and enforces the window security posture;
  `display-media.ts` grants the chosen source; `ipc.ts` is the IPC surface; `src/shared/ipc.ts`
  holds the typed contract and the IPC boundary guard.
- `src/preload/preload.cts` must stay CommonJS (and compile to `preload.cjs`): a sandboxed preload
  cannot be an ES module. It may `require("electron")` and nothing else.
- Electron 44 reports `getDisplayMedia` to `setPermissionRequestHandler` as a **`media`** request,
  not `display-capture`. The handler allows `media` only for the host page while a source is armed;
  `setDisplayMediaRequestHandler` is the actual source gate. Camera/mic are denied otherwise.
- The server is built, tested and usable without Electron (`scripts/serve.mjs`); `npm start` is the
  shell around the same server.

## Non-negotiables

- **The viewer is receive-only.** Never `getUserMedia`, `getDisplayMedia`, a permission request or
  a `navigator.mediaDevices` feature test — Silk on Fire TV hides that object (no camera/mic), and
  that hidden object is why the web believes "Silk has no WebRTC". It does.
- **No STUN/TURN, ever.** `RTC_CONFIG.iceServers` stays empty and frozen. Task 14 adds the grep
  gate to `npm run verify`; until then it is enforced by review.
- **Strict CSP on every response** (`src/server/http.ts`), so no served page may use inline
  `<script>`/`<style>` — that is why `docs/silk-probe.*` are separate files that Vite never sees.
- Signaling relays `Signal` frames verbatim and never parses SDP.
- New runtime dependencies need a very good reason: `ws` + `qrcode` are the budget (`react`,
  `react-dom` are bundled into the two SPAs by Vite).
- Nothing heavy runs on a Fire TV for fun. Two loopbacks — a 720p30 `MediaRecorder` → `MediaSource`
  and a 720p30 WebRTC one (probe check 4b) — each froze an `AFTCA002` hard enough to need a power
  cycle; the MSE transport is rejected in `SPEC.md`, and the rule they teach is that the stick
  never *encodes*. Hardware results live in `docs/manual-tests.md`, and the probe page at `/probe`
  puts both risky checks (4b, 6) behind a second confirming click.
