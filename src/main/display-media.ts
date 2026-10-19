import { desktopCapturer, type Session } from "electron";

import { audioModeFor } from "../shared/audio.ts";

/** The source and audio grant chosen by the host renderer for the next getDisplayMedia call. */
export type CaptureSelection = { sourceId: string; audio: boolean };

export type CaptureTarget = {
  get: () => CaptureSelection | null;
  set: (selection: CaptureSelection | null) => void;
};

export function createCaptureTarget(): CaptureTarget {
  let selection: CaptureSelection | null = null;
  return {
    get: () => selection,
    set: (next) => {
      selection = next;
    },
  };
}

/**
 * Grants getDisplayMedia to the host page only, using the source chosen in the UI.
 *
 * Audio is never a reason to refuse the request: an OS without loopback gets video alone and the
 * caller learns about it from `start()`. Denials use `callback(null)`, which rejects the request.
 */
export function installDisplayMediaHandler(
  session: Session,
  target: CaptureTarget,
  hostUrl: string,
): void {
  session.setDisplayMediaRequestHandler(async (request, callback) => {
    if (request.frame?.url !== hostUrl) return callback(null);
    const selection = target.get();
    if (selection === null) return callback(null);

    try {
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 0, height: 0 },
      });
      const source = sources.find((entry) => entry.id === selection.sourceId);
      if (source === undefined) return callback(null);
      const audio = selection.audio ? audioModeFor(process.platform) : null;
      callback(audio === null ? { video: source } : { video: source, audio });
    } catch {
      callback(null); // a capture backend that throws must not leave the request hanging
    }
  });
}
