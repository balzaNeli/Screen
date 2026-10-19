import type { MirrorApi } from "../shared/ipc.ts";

declare global {
  interface Window {
    readonly mirror: MirrorApi;
  }
}

export {};
