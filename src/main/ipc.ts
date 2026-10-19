import { desktopCapturer, ipcMain } from "electron";

import { audioModeFor } from "../shared/audio.ts";
import { parseStartRequest, type SourceInfo } from "../shared/ipc.ts";
import { parseSignal, type Signal } from "../shared/protocol.ts";
import type { CaptureSelection } from "./display-media.ts";

export type IpcOptions = {
  getSelection: () => CaptureSelection | null;
  setSelection: (selection: CaptureSelection | null) => void;
  sendToViewer: (signal: Signal) => void;
  /** Pushed after a selection or a permission change, so the host UI reflects real state. */
  pushState: () => void;
};

/** IPC is a trust boundary too: rebuild the envelope instead of trusting the renderer's shape. */
function ipcSignal(value: unknown): Signal | null {
  try {
    return parseSignal(JSON.stringify(value));
  } catch {
    return null;
  }
}

export function registerIpc(options: IpcOptions): void {
  const audioSupported = (): boolean => audioModeFor(process.platform) !== null;

  ipcMain.handle("mirror:listSources", async (): Promise<SourceInfo[]> => {
    const sources = await desktopCapturer.getSources({
      types: ["screen", "window"],
      thumbnailSize: { width: 0, height: 0 },
    });
    return sources.map((source) => ({
      id: source.id,
      name: source.name,
      kind: source.id.startsWith("screen:") ? "screen" : "window",
    }));
  });

  ipcMain.handle("mirror:capabilities", () => ({ audio: audioSupported() }));

  ipcMain.handle("mirror:start", (_event, raw: unknown) => {
    const request = parseStartRequest(raw);
    if (request === null) {
      options.setSelection(null);
      options.pushState();
      return { audio: false };
    }
    const audio = request.audio && audioSupported();
    options.setSelection({ sourceId: request.sourceId, audio });
    options.pushState();
    return { audio };
  });

  ipcMain.handle("mirror:setAudio", (_event, on: unknown) => {
    if (typeof on !== "boolean") return false;
    const audio = on && audioSupported();
    const selection = options.getSelection();
    if (selection !== null) options.setSelection({ ...selection, audio });
    options.pushState();
    return audio;
  });

  ipcMain.on("mirror:stop", () => {
    options.setSelection(null);
    options.pushState();
  });

  ipcMain.on("mirror:sendSignal", (_event, raw: unknown) => {
    const signal = ipcSignal(raw);
    if (signal !== null) options.sendToViewer(signal);
  });
}
