import type { Quality } from "./ipc.ts";

/**
 * The capture side of the quality selector. `null` means "leave the source alone"; every other
 * value is a cap applied with `track.applyConstraints`, never a new getDisplayMedia call.
 */
export function videoConstraints(quality: Quality): MediaTrackConstraints | null {
  if (quality === "native") return null;
  const [width, height] = quality === "1080p" ? [1920, 1080] : [1280, 720];
  return { width: { max: width }, height: { max: height }, frameRate: { max: 30 } };
}
