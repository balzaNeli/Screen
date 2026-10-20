import { useCallback, useEffect, useRef, useState } from "react";

import { parseSignal } from "../shared/protocol.ts";
import { RTC_CONFIG } from "../shared/rtc.ts";

type WatchProps = { token: string; debug: boolean; onEnded: (message: string) => void };

type DebugInfo = {
  codec: string;
  resolution: string;
  fps: number;
  kbps: number;
  lost: number;
  audio: number | null;
};

type InboundStats = RTCStats & {
  kind?: string;
  codecId?: string;
  bytesReceived?: number;
  frameWidth?: number;
  frameHeight?: number;
  framesPerSecond?: number;
  packetsLost?: number;
  audioLevel?: number;
};

export function Watch({ token, debug, onEnded }: WatchProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const muteRef = useRef<HTMLButtonElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const finishRef = useRef<(message: string) => void>(() => undefined);
  const hideTimer = useRef<number | null>(null);
  const [status, setStatus] = useState("Connecting...");
  const [hasStream, setHasStream] = useState(false);
  const [muted, setMuted] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [controls, setControls] = useState(true);
  const [stats, setStats] = useState<DebugInfo | null>(null);

  const showControls = useCallback(() => {
    setControls(true);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setControls(false), 5000);
  }, []);

  useEffect(() => {
    showControls();
    const onKey = () => showControls();
    const onPointer = () => showControls();
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerdown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    };
  }, [showControls]);

  useEffect(() => {
    muteRef.current?.focus();
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement !== null);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  useEffect(() => {
    let disposed = false;
    let finished = false;
    let remoteReady = false;
    let statsTimer: number | null = null;
    let previousVideo: { bytes: number; timestamp: number } | null = null;
    const pendingIce: RTCIceCandidateInit[] = [];
    const video = videoRef.current;
    const peer = new RTCPeerConnection(RTC_CONFIG);
    const url = new URL("/ws", window.location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.searchParams.set("token", token);
    const socket = new WebSocket(url.toString());
    socketRef.current = socket;

    function finish(message: string): void {
      if (finished) return;
      finished = true;
      if (statsTimer !== null) window.clearInterval(statsTimer);
      socket.onclose = null;
      socket.close();
      peer.close();
      if (!disposed) onEnded(message);
    }
    finishRef.current = finish;

    async function tryUnmute(): Promise<void> {
      if (video === null) return;
      video.muted = false;
      try {
        await video.play();
        if (!disposed) setMuted(false);
      } catch {
        video.muted = true;
        if (!disposed) setMuted(true);
      }
    }

    async function acceptOffer(sdp: string): Promise<void> {
      try {
        await peer.setRemoteDescription({ type: "offer", sdp });
        remoteReady = true;
        for (const candidate of pendingIce.splice(0)) {
          await peer.addIceCandidate(candidate).catch(() => undefined);
        }
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        if (peer.localDescription !== null && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "answer", sdp: peer.localDescription.sdp }));
        }
      } catch {
        finish("Could not start playback. Pair again.");
      }
    }

    peer.ontrack = (event) => {
      if (video === null || disposed) return;
      const [stream] = event.streams;
      if (stream === undefined) return;
      if (video.srcObject !== stream) video.srcObject = stream;
      setHasStream(true);
      setStatus("Connected");
      void video.play().catch(() => setStatus("Press Sound to play."));
      void tryUnmute();
    };

    peer.onicecandidate = (event) => {
      if (event.candidate === null || socket.readyState !== WebSocket.OPEN) return;
      const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = event.candidate;
      socket.send(
        JSON.stringify({
          type: "ice",
          candidate: { candidate, sdpMid, sdpMLineIndex, usernameFragment },
        }),
      );
    };

    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") setStatus("Connected");
      if (peer.connectionState === "failed") finish("Connection failed. Pair again.");
    };

    socket.onopen = () => setStatus("Waiting for the host...");
    socket.onerror = () => finish("Connection lost. Pair again.");
    socket.onclose = () => {
      if (!disposed && !finished) finish("Connection lost. Pair again.");
    };
    socket.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const signal = parseSignal(event.data);
      if (signal === null) return;
      if (signal.type === "offer") {
        void acceptOffer(signal.sdp);
      } else if (signal.type === "ice") {
        if (remoteReady) void peer.addIceCandidate(signal.candidate).catch(() => undefined);
        else pendingIce.push(signal.candidate);
      } else if (signal.type === "stop") {
        finish("The host stopped sharing.");
      }
    };

    if (debug) {
      statsTimer = window.setInterval(() => {
        void (async () => {
          try {
            const report = await peer.getStats();
            const inbound: InboundStats[] = [];
            report.forEach((entry) => {
              if (entry.type === "inbound-rtp") inbound.push(entry as InboundStats);
            });
            const videoStats = inbound.find((entry) => entry.kind === "video");
            if (videoStats === undefined) return;
            const audioStats = inbound.find((entry) => entry.kind === "audio");
            const codec =
              videoStats.codecId === undefined
                ? undefined
                : (report.get(videoStats.codecId) as { mimeType?: string } | undefined);
            const bytes = videoStats.bytesReceived ?? 0;
            const timestamp = videoStats.timestamp;
            let kbps = 0;
            if (previousVideo !== null && timestamp > previousVideo.timestamp) {
              kbps = ((bytes - previousVideo.bytes) * 8) / (timestamp - previousVideo.timestamp);
            }
            previousVideo = { bytes, timestamp };
            if (!disposed) {
              setStats({
                codec: codec?.mimeType ?? "unknown",
                resolution: `${videoStats.frameWidth ?? 0}x${videoStats.frameHeight ?? 0}`,
                fps: Math.round(videoStats.framesPerSecond ?? 0),
                kbps: Math.round(kbps),
                lost: videoStats.packetsLost ?? 0,
                audio: typeof audioStats?.audioLevel === "number" ? audioStats.audioLevel : null,
              });
            }
          } catch {
            // stats are best-effort; a closed connection rejects getStats()
          }
        })();
      }, 1000);
    }

    return () => {
      disposed = true;
      finishRef.current = () => undefined;
      if (statsTimer !== null) window.clearInterval(statsTimer);
      socket.onclose = null;
      socket.close();
      peer.close();
      socketRef.current = null;
      if (video !== null) video.srcObject = null;
    };
  }, [token, debug, onEnded]);

  async function toggleMute(): Promise<void> {
    const video = videoRef.current;
    if (video === null) return;
    if (!muted) {
      setMuted(true);
      return;
    }
    video.muted = false;
    try {
      await video.play();
      setMuted(false);
    } catch {
      video.muted = true;
      setMuted(true);
    }
  }

  async function toggleFullscreen(): Promise<void> {
    try {
      if (document.fullscreenElement !== null) await document.exitFullscreen();
      else await shellRef.current?.requestFullscreen();
    } catch {
      // fullscreen is optional on browsers that refuse it
    }
  }

  function stopWatching(): void {
    const socket = socketRef.current;
    if (socket !== null && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "stop", reason: "viewer stopped" }));
    }
    finishRef.current("You stopped watching.");
  }

  return (
    <div className="watch" ref={shellRef}>
      <video ref={videoRef} className="watch-video" autoPlay playsInline muted={muted} />

      {!hasStream && (
        <p className="watch-message" role="status">
          {status}
        </p>
      )}

      {debug && (
        <pre className="watch-debug">
          {stats === null
            ? "waiting for media..."
            : `codec  ${stats.codec}
video  ${stats.resolution} @ ${stats.fps} fps
net    ${stats.kbps} kbps · ${stats.lost} lost
audio  ${stats.audio === null ? "n/a" : `${Math.round(stats.audio * 100)}%`}`}
        </pre>
      )}

      <div className={controls ? "watch-controls" : "watch-controls is-hidden"}>
        <button ref={muteRef} type="button" onClick={() => void toggleMute()}>
          {muted ? "Sound" : "Mute"}
        </button>
        <button type="button" onClick={() => void toggleFullscreen()}>
          {fullscreen ? "Exit fullscreen" : "Fullscreen"}
        </button>
        <button type="button" onClick={stopWatching}>
          Stop
        </button>
      </div>
    </div>
  );
}
