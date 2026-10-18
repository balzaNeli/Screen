/**
 * System audio capability, as a pure function so both the host app and the tests can ask the
 * question without touching Electron.
 *
 * Electron's `setDisplayMediaRequestHandler` takes `audio: 'loopback' | 'loopbackWithMute'`, and
 * captures the system output mix. Per Electron docs that is Windows-only today; macOS needs a
 * feature flag and a newer Chromium, Linux is unsupported.
 *
 * shortcut: Windows-only audio. Upgrade path is to widen this function once Electron ships
 * loopback elsewhere — nothing else in the codebase needs to change.
 */
export function audioModeFor(platform: NodeJS.Platform): "loopback" | null {
  return platform === "win32" ? "loopback" : null;
}
