/* screenmirror probe — answers the branch question on the real device.
   Plain script, no build step, no dependencies. Nothing here talks to the host.

   Safety rules learned the hard way on an AFTCA002 (Fire TV Stick 4K Max) on 2026-10-18:
   a 720p30 MediaRecorder -> MediaSource loopback hung the whole device. Check 5 is therefore
   capped in size, time and queue, and gated behind a second confirming click. */
"use strict";

var out = document.getElementById("out");
var stage = document.getElementById("stage");
var stageNote = document.getElementById("stage-note");

function line(text, cls) {
  var span = document.createElement("span");
  if (cls) span.className = cls;
  span.textContent = text + "\n";
  out.appendChild(span);
  out.scrollTop = out.scrollHeight;
}

function has(value) {
  return typeof value === "function" ? "yes" : "no";
}

/* Same rule as src/shared/codecs.ts: H.264 first, everything else stays as fallback. */
function preferH264(codecs) {
  return codecs.slice().sort(function (a, b) {
    return Number(/h264/i.test(b.mimeType)) - Number(/h264/i.test(a.mimeType));
  });
}

/* Containers for check 5 only. A muxed H.264 file would mean hardware decode, and this device
   reports MediaRecorder=no for all of them — which is why Branch B is not the plan. */
var TYPES = [
  'video/mp4;codecs="avc1.4d401f,mp4a.40.2"',
  'video/mp4;codecs="avc1.64001f,mp4a.40.2"',
  'video/webm;codecs="h264,opus"',
  'video/webm;codecs="vp8,opus"',
  'video/webm;codecs="vp9,opus"'
];
var AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2'];

var session = null;

function stopSession() {
  if (!session) return;
  var s = session;
  session = null;
  clearTimeout(s.timer);
  clearInterval(s.drawer);
  cancelAnimationFrame(s.raf);
  try {
    if (s.recorder && s.recorder.state !== "inactive") s.recorder.stop();
  } catch (err) {
    line("recorder stop: " + err.message);
  }
  if (s.stream) {
    s.stream.getTracks().forEach(function (track) {
      track.stop();
    });
  }
  if (s.peers) {
    s.peers.forEach(function (pc) {
      try {
        pc.close();
      } catch (err) {
        /* already closed */
      }
    });
  }
  if (s.audio) {
    try {
      s.audio.close();
    } catch (err) {
      /* an already-closed audio context is not worth reporting */
    }
  }
  if (s.url) {
    try {
      URL.revokeObjectURL(s.url);
    } catch (err) {
      /* revoking twice is harmless */
    }
  }
  stage.removeAttribute("src");
  stage.srcObject = null;
  stage.load();
  stageNote.textContent = "stopped";
}

/* ---------------------------------------------------------------- 1 environment */
function runEnv() {
  line("=== 1 ENVIRONMENT (" + new Date().toLocaleString() + ") ===");
  line("RTCPeerConnection:         " + has(window.RTCPeerConnection));
  line("navigator.mediaDevices:    " + (navigator.mediaDevices ? "yes" : "no") + "  (only needed to SEND from this device)");
  line("MediaSource:               " + has(window.MediaSource));
  line("MediaRecorder:             " + has(window.MediaRecorder));
  line("setCodecPreferences:       " + has(window.RTCRtpTransceiver && window.RTCRtpTransceiver.prototype.setCodecPreferences));
  line("requestVideoFrameCallback: " + has(stage.requestVideoFrameCallback));
  line("screen:                    " + screen.width + "x" + screen.height + " @" + devicePixelRatio + "x");
  line("ua: " + navigator.userAgent);
  var rtc = typeof window.RTCPeerConnection === "function";
  line(rtc ? "RESULT: WebRTC present -> Branch A (receive-only works even without mediaDevices)" : "RESULT: NO WebRTC -> Branch A impossible here", rtc ? "ok" : "no");
  return rtc;
}

/* ---------------------------------------------------------------- 2 capabilities */
function runCaps() {
  line("=== 2 CODEC CAPABILITIES ===");
  var send = window.RTCRtpSender && window.RTCRtpSender.getCapabilities ? window.RTCRtpSender.getCapabilities("video") : null;
  var recv = window.RTCRtpReceiver && window.RTCRtpReceiver.getCapabilities ? window.RTCRtpReceiver.getCapabilities("video") : null;
  var mimes = [];
  [send, recv].forEach(function (caps) {
    (caps && caps.codecs ? caps.codecs : []).forEach(function (codec) {
      if (mimes.indexOf(codec.mimeType) === -1) mimes.push(codec.mimeType);
    });
  });
  line("codecs: " + (mimes.length ? mimes.join(", ") : "none reported"));
  var h264 = mimes.filter(function (m) {
    return /h264/i.test(m);
  });
  line("H.264 variants: " + (h264.length ? h264.join(", ") : "none"), h264.length ? "ok" : "no");
}

/* ---------------------------------------------------------------- 3 supported types */
function runTypes() {
  line("=== 3 MSE / MEDIARECORDER TYPES ===");
  TYPES.concat(AUDIO_TYPES).forEach(function (type) {
    var mse = window.MediaSource && window.MediaSource.isTypeSupported ? window.MediaSource.isTypeSupported(type) : false;
    var mr = window.MediaRecorder && window.MediaRecorder.isTypeSupported ? window.MediaRecorder.isTypeSupported(type) : false;
    line("  " + type);
    line("    MediaSource=" + (mse ? "yes" : "no") + "  MediaRecorder=" + (mr ? "yes" : "no"), mse && mr ? "ok" : undefined);
  });
  var recordable = TYPES.filter(function (type) {
    return window.MediaRecorder && window.MediaRecorder.isTypeSupported(type);
  });
  line(
    "RESULT: no H.264 container can be recorded here (" + (recordable.join(", ") || "nothing") + ") -> Branch B could only send CPU-decoded VP8/VP9",
    /avc1/i.test(recordable.join(",")) ? "ok" : "no"
  );
}

/* A 220 Hz hum proves an audio track survives record -> append -> decode -> speakers. */
function attachTone(stream, mime) {
  if (!/opus|mp4a/i.test(mime)) return null;
  var Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    var ctx = new Ctx();
    var osc = ctx.createOscillator();
    var gain = ctx.createGain();
    var dest = ctx.createMediaStreamDestination();
    osc.frequency.value = 220;
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(dest);
    osc.start();
    dest.stream.getAudioTracks().forEach(function (track) {
      stream.addTrack(track);
    });
    ctx.resume();
    return ctx;
  } catch (err) {
    line("audio track not attached: " + err.message);
    return null;
  }
}

/* ---------------------------------------------------------------- 4 WebRTC loopback (safe) */
function runWebrtc(width, height, fps) {
  width = width || 640;
  height = height || 360;
  fps = fps || 15;
  stopSession();
  line("=== 4 WEBRTC LOOPBACK " + width + "x" + height + "@" + fps + " (30 s) ===");
  if (typeof window.RTCPeerConnection !== "function") {
    line("no RTCPeerConnection — nothing to test", "no");
    return;
  }

  var canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  var ctx2d = canvas.getContext("2d");
  var started = performance.now();

  var draw = function () {
    var ms = Math.round(performance.now() - started);
    ctx2d.fillStyle = "#000";
    ctx2d.fillRect(0, 0, width, height);
    ctx2d.fillStyle = "#7ee787";
    ctx2d.fillRect(((ms % 1000) / 1000) * (width - 100), height * 0.45, 100, 100);
    ctx2d.fillStyle = "#fff";
    ctx2d.font = Math.round(height / 8) + "px monospace";
    ctx2d.fillText(ms + " ms", height / 10, height / 4);
  };

  var stream = canvas.captureStream(fps);
  var pcSend = new RTCPeerConnection({ iceServers: [] });
  var pcRecv = new RTCPeerConnection({ iceServers: [] });
  stream.getVideoTracks().forEach(function (track) {
    pcSend.addTrack(track, stream);
  });
  var transceiver = pcSend.getTransceivers()[0];
  if (transceiver && transceiver.setCodecPreferences && window.RTCRtpSender.getCapabilities) {
    try {
      transceiver.setCodecPreferences(preferH264(window.RTCRtpSender.getCapabilities("video").codecs));
      line("codec preference: H.264 first");
    } catch (err) {
      line("setCodecPreferences refused: " + err.message);
    }
  }

  pcSend.onicecandidate = function (event) {
    if (event.candidate) pcRecv.addIceCandidate(event.candidate);
  };
  pcRecv.onicecandidate = function (event) {
    if (event.candidate) pcSend.addIceCandidate(event.candidate);
  };
  pcRecv.ontrack = function (event) {
    stage.srcObject = event.streams[0];
    stage.muted = true;
    stageNote.textContent = "live";
    stage.play().catch(function (err) {
      line("play() refused: " + err.message, "no");
    });
  };

  session = {
    peers: [pcSend, pcRecv],
    stream: stream,
    drawer: setInterval(draw, Math.round(1000 / fps)),
    raf: 0,
    timer: 0
  };
  draw();

  var connectStart = performance.now();
  pcRecv.onconnectionstatechange = function () {
    line("pcRecv connectionState: " + pcRecv.connectionState);
  };

  pcSend
    .createOffer()
    .then(function (offer) {
      return pcSend.setLocalDescription(offer);
    })
    .then(function () {
      return pcRecv.setRemoteDescription(pcSend.localDescription);
    })
    .then(function () {
      return pcRecv.createAnswer();
    })
    .then(function (answer) {
      return pcRecv.setLocalDescription(answer);
    })
    .then(function () {
      return pcSend.setRemoteDescription(pcRecv.localDescription);
    })
    .catch(function (err) {
      line("negotiation failed: " + err.name + " " + err.message, "no");
    });

  var paints = 0;
  var firstFrame = null;
  if (stage.requestVideoFrameCallback) {
    var count = function () {
      if (!session) return;
      paints++;
      if (firstFrame === null) firstFrame = Math.round(performance.now() - started);
      stage.requestVideoFrameCallback(count);
    };
    stage.requestVideoFrameCallback(count);
  }

  session.timer = setTimeout(function () {
    var elapsed = (performance.now() - started) / 1000;
    var negotiated = "unknown";
    try {
      var receiver = pcRecv.getReceivers()[0];
      var params = receiver && receiver.getParameters();
      if (params && params.codecs && params.codecs.length) negotiated = params.codecs[0].mimeType;
    } catch (err) {
      /* reported as unknown below */
    }
    var quality = stage.getVideoPlaybackQuality ? stage.getVideoPlaybackQuality() : null;

    line("=== 5 AFTER " + Math.round(elapsed) + "s ===");
    line("connectionState: " + pcSend.connectionState + " / " + pcRecv.connectionState, pcRecv.connectionState === "connected" ? "ok" : "no");
    line("negotiated codec: " + negotiated, /h264|avc/i.test(negotiated) ? "ok" : "no");
    line("first painted frame: " + (firstFrame === null ? "NEVER" : firstFrame + " ms"), firstFrame !== null && firstFrame < 3000 ? "ok" : "no");
    line("painted frames: " + paints + "  (~" + (paints / elapsed).toFixed(1) + " fps of " + fps + " requested)", paints / elapsed > fps * 0.6 ? "ok" : "no");
    line("quality: total=" + (quality ? quality.totalVideoFrames : "n/a") + " dropped=" + (quality ? quality.droppedVideoFrames : "n/a"));
    line(
      pcRecv.connectionState === "connected" && firstFrame !== null
        ? "RESULT: WebRTC loopback renders on this device -> Branch A confirmed"
        : "RESULT: WebRTC loopback did NOT render -> report the lines above",
      pcRecv.connectionState === "connected" && firstFrame !== null ? "ok" : "no"
    );
  }, 30000);
}

/* ---------------------------------------------------------------- 6 MSE loopback (can hang!) */
var mseArmed = false;

function runMse(seconds) {
  var button = document.querySelector('[data-run="mse"]');
  if (!mseArmed) {
    mseArmed = true;
    button.textContent = "6 · MSE — SURE? CAN HANG THIS TV";
    line("*** check 6 can freeze this Fire TV hard. It froze an AFTCA002 on 2026-10-18. Tap again to run anyway. ***", "no");
    return;
  }
  mseArmed = false;
  button.textContent = "6 · MSE loopback (may hang the TV)";
  seconds = seconds || 20;
  stopSession();
  line("=== 6 MSE LOOPBACK (capped: 640x360@15, 20 s, queue 24) ===");
  var mime = null;
  for (var i = 0; i < TYPES.length; i++) {
    if (window.MediaSource.isTypeSupported(TYPES[i]) && window.MediaRecorder.isTypeSupported(TYPES[i])) {
      mime = TYPES[i];
      break;
    }
  }
  if (!mime) {
    line("no recordable+playable container — nothing to test", "no");
    return;
  }
  line("container: " + mime);

  var canvas = document.createElement("canvas");
  canvas.width = 640;
  canvas.height = 360;
  var ctx2d = canvas.getContext("2d");
  var started = performance.now();
  var draw = function () {
    var ms = Math.round(performance.now() - started);
    ctx2d.fillStyle = "#000";
    ctx2d.fillRect(0, 0, 640, 360);
    ctx2d.fillStyle = "#7ee787";
    ctx2d.fillRect(80 + (ms % 300), 140, 80, 80);
    ctx2d.fillStyle = "#fff";
    ctx2d.font = "40px monospace";
    ctx2d.fillText(ms + " ms", 40, 60);
  };

  var stream = canvas.captureStream(15);
  var audio = attachTone(stream, mime);
  var recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 1500000 });
  var mediaSource = new MediaSource();
  var url = URL.createObjectURL(mediaSource);

  session = {
    recorder: recorder,
    stream: stream,
    audio: audio,
    drawer: setInterval(draw, 66),
    raf: 0,
    url: url,
    timer: 0
  };
  draw();
  stage.src = url;
  stage.muted = true;
  stageNote.textContent = "records " + mime;

  var queue = [];
  var appending = false;
  var source = null;

  function pump() {
    if (!source || !session || source.updating || appending || !queue.length) return;
    var buffer = queue.shift();
    try {
      appending = true;
      source.appendBuffer(buffer);
    } catch (err) {
      appending = false;
      line("appendBuffer failed: " + err.name, "no");
    }
  }

  mediaSource.addEventListener(
    "sourceopen",
    function () {
      try {
        source = mediaSource.addSourceBuffer(mime);
      } catch (err) {
        line("addSourceBuffer failed: " + err.message, "no");
        stopSession();
        return;
      }
      session.source = source;
      source.addEventListener("updateend", function () {
        appending = false;
        if (source.buffered.length && stage.currentTime > 6 && !source.updating) {
          try {
            source.remove(0, stage.currentTime - 3);
          } catch (err) {
            /* removing while busy is expected */
          }
        }
        pump();
      });
      recorder.addEventListener("dataavailable", function (event) {
        if (!event.data || !event.data.size) return;
        queue.push(event.data);
        while (queue.length > 24) queue.shift(); // the cap that keeps a weak TV alive
        pump();
      });
      recorder.start(250);
      stage.play().catch(function (err) {
        line("play() refused: " + err.message, "no");
      });
      monitorMse(source, stream, seconds);
    },
    { once: true }
  );
}

function monitorMse(source, stream, seconds) {
  var started = performance.now();
  var firstFrame = null;
  var paints = 0;

  if (stage.requestVideoFrameCallback) {
    var count = function () {
      if (!session) return;
      paints++;
      if (firstFrame === null) firstFrame = Math.round(performance.now() - started);
      stage.requestVideoFrameCallback(count);
    };
    stage.requestVideoFrameCallback(count);
  }

  session.timer = setTimeout(function () {
    var elapsed = (performance.now() - started) / 1000;
    var quality = stage.getVideoPlaybackQuality ? stage.getVideoPlaybackQuality() : null;
    var buffered = source.buffered.length ? source.buffered.end(source.buffered.length - 1) - source.buffered.start(0) : 0;
    var lag = elapsed - stage.currentTime;

    line("=== SUMMARY AFTER " + Math.round(elapsed) + "s (MSE) ===");
    line("first painted frame: " + (firstFrame === null ? "NEVER" : firstFrame + " ms"), firstFrame !== null ? "ok" : "no");
    line("painted frames: " + paints + "  (~" + (paints / elapsed).toFixed(1) + " fps)", paints / elapsed > 9 ? "ok" : "no");
    line("video.currentTime: " + stage.currentTime.toFixed(2) + "s   buffered: " + buffered.toFixed(2) + "s");
    line("approximate pipeline delay: " + lag.toFixed(2) + "s");
    line("quality: total=" + (quality ? quality.totalVideoFrames : "n/a") + " dropped=" + (quality ? quality.droppedVideoFrames : "n/a"));
    line("audio tracks in recording: " + stream.getAudioTracks().length, stream.getAudioTracks().length ? "ok" : "no");
    stopSession();
    line("stopped after " + seconds + "s on purpose", "ok");
  }, seconds * 1000);
}

/* ---------------------------------------------------------------- wiring */
var actions = {
  env: runEnv,
  caps: runCaps,
  types: runTypes,
  webrtc: function () {
    runWebrtc(640, 360, 15);
  },
  mse: function () {
    runMse(20);
  }
};

Array.prototype.forEach.call(document.querySelectorAll("[data-run]"), function (button) {
  button.addEventListener("click", function () {
    actions[button.getAttribute("data-run")]();
  });
});

document.getElementById("run-all").addEventListener("click", function () {
  out.textContent = "";
  runEnv();
  runCaps();
  runTypes();
  runWebrtc(640, 360, 15);
});

document.getElementById("boost").addEventListener("click", function () {
  runWebrtc(1280, 720, 30);
});

document.getElementById("stop").addEventListener("click", stopSession);

document.getElementById("sound").addEventListener("click", function () {
  stage.muted = !stage.muted;
  line("sound: " + (stage.muted ? "muted" : "ON — you should hear a 220 Hz hum"));
});

line("screenmirror probe ready. Press 'Run all' (checks 1-4, safe). Check 6 is the risky one.");
