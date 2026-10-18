/**
 * Codec preference. Chrome offers VP8 first, and VP8 at 1080p is CPU-decoded on a Fire TV stick;
 * H.264 hits the hardware decoder there.
 */
export type Codec = { mimeType: string };

const isH264 = (codec: Codec): number => Number(codec.mimeType.toLowerCase() === "video/h264");

/**
 * Puts the H.264 family first and keeps every other codec as a fallback, in its original order.
 * Nothing is filtered out — other viewers must keep negotiating VP8/VP9.
 *
 * Feed the result to `RTCRtpTransceiver.setCodecPreferences` before `createOffer`, so no SDP
 * string surgery is needed anywhere.
 */
export function preferH264<T extends Codec>(codecs: readonly T[]): T[] {
  return [...codecs].sort((a, b) => isH264(b) - isH264(a)); // sort is stable: equal ranks keep order
}
