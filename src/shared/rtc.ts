/**
 * The whole ICE configuration, frozen so no code path can quietly add a STUN/TURN server and
 * leak the session off the LAN. `npm run verify` greps the build output to keep it that way.
 */
export const RTC_CONFIG: Readonly<RTCConfiguration> = Object.freeze({
  // Freezing the array too: RTCConfiguration demands a mutable array type, so this is asserted.
  iceServers: Object.freeze([] as RTCIceServer[]),
}) as Readonly<RTCConfiguration>;
