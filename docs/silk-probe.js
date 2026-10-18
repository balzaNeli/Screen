/* screenmirror probe — answers the branch question on the real device.
   Plain script, no build step, no dependencies. Nothing here talks to the host. */
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

/* Containers worth testing, best first: a muxed H.264 file means hardware decode on the TV. */
var TYPES = [
  'video/mp4;codecs="avc1.4d401f,mp4a.40.2"',
  'video/mp4;codecs="avc1.64001f,mp4a.40.2"',
  'video/webm;codecs="h264,opus"',
  'video/webm;codecs="vp8,opus"',
  'video/webm;codecs="vp9,opus"'
];
var AUDIO_TYPES = ['audio/webm;codecs=opus', 'audio/mp4;codecs=mp4a.40.2'];

/* ---------------------------------------------------------------- 1 environment */
function runEnv() {
  line("=== 1 ENVIRONMENT (" + new Date().toLocaleString() + ") ===");
  line("RTCPeerConnection:        " + has(window.RTCPeerConnection));
  line("navigator.mediaDevices:   " + (navigator.mediaDevices ? "yes" : "no"));
  line("MediaSource:              " + has(window.MediaSource));
  line("MediaRecorder:            " + has(window.MediaRecorder));
  line("setCodecPreferences:      " + has(window.RTCRtpTransceiver && window.RTCRtpTransceiver.prototype.setCodecPreferences));
  line("requestVideoFrameCallback:" + has(stage.requestVideoFrameCallback));
  line("screen:                   " + screen.width + "x" + screen.height + " @" + devicePixelRatio + "x");
  line("ua: " + navigator.userAgent);
  var rtc = typeof window.RTCPeerConnection === "function";
  line(rtc ? "RESULT: WebRTC present -> Branch A possible here" : "RESULT: NO WebRTC -> Branch A impossible here", rtc ? "ok" : "no");
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
  var best = null;
  TYPES.concat(AUDIO_TYPES).forEach(function (type) {
    var mse = window.MediaSource && window.MediaSource.isTypeSupported ? window.MediaSource.isTypeSupported(type) : false;
    var mr = window.MediaRecorder && window.MediaRecorder.isTypeSupported ? window.MediaRecorder.isTypeSupported(type) : false;
    if (mse && mr && !best && TYPES.indexOf(type) !== -1) best = type;
    line("  " + type);
    line("    MediaSource=" + (mse ? "yes" : "no") + "  MediaRecorder=" + (mr ? "yes" : "no"), mse && mr ? "ok" : undefined);
  });
  line(best ? "RESULT: recordable+playable container: " + best : "RESULT: no usable container -> Branch B not viable here", best ? "ok" : "no");
  return best;
}

/* ---------------------------------------------------------------- 4/5 loopback */
var session = null;

function stopSession() {
  if (!session) return;
  var s = session;
  session = null;
  clearTimeout(s.timer);
  cancelAnimationFrame(s.raf);
  try {
    if (s.recorder.state !== "inactive") s.recorder.stop();
  } catch (err) {
    line("recorder stop: " + err.message);
  }
  s.stream.getTracks().forEach(function (track) {
    track.stop();
  });
  if (s.audio) {
    try {
      s.audio.close();
    } catch (err) {
      /* an already-closed audio context is not worth reporting */
    }
  }
  try {
    URL.revokeObjectURL(s.url);
  } catch (err) {
    /* revoking twice is harmless */
  }
  stage.removeAttribute("src");
  stage.load();
  stageNote.textContent = "stopped";
  line("stopped", "no");
}

function pickMime() {
  for (var i = 0; i < TYPES.length; i++) {
    var type = TYPES[i];
    var mse = window.MediaSource && window.MediaSource.isTypeSupported ? window.MediaSource.isTypeSupported(type) : false;
    var mr = window.MediaRecorder && window.MediaRecorder.isTypeSupported ? window.MediaRecorder.isTypeSupported(type) : false;
    if (mse && mr) return type;
  }
  return null;
}

/* A 220 Hz hum proves the audio track survives record -> append -> decode -> speakers. */
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

function runLoop(seconds) {
  seconds = seconds || 30;
  stopSession();
  line("=== 4 MSE LOOPBACK (" + seconds + "s) ===");
  var mime = pickMime();
  if (!mime) {
    line("RESULT: no container supported by both MediaSource and MediaRecorder -> Branch B not viable", "no");
    return;
  }
  line("container: " + mime);

  var canvas = document.createElement("canvas");
  canvas.width = 1280;
  canvas.height = 720;
  var ctx2d = canvas.getContext("2d");
  var started = performance.now();

  var draw = function () {
    var ms = Math.round(performance.now() - started);
    ctx2d.fillStyle = "#000";
    ctx2d.fillRect(0, 0, 1280, 720);
    ctx2d.fillStyle = "#7ee787";
    ctx2d.fillRect((ms % 1000) + 60, 320, 120, 120);
    ctx2d.fillStyle = "#fff";
    ctx2d.font = "70px monospace";
    ctx2d.fillText(ms + " ms", 60, 120);
    ctx2d.font = "44px monospace";
    ctx2d.fillText("screenmirror probe", 60, 600);
    if (session) session.raf = requestAnimationFrame(draw);
  };

  var stream = canvas.captureStream(30);
  var audio = attachTone(stream, mime);
  var recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2500000 });
  var mediaSource = new MediaSource();
  var url = URL.createObjectURL(mediaSource);

  session = { recorder: recorder, stream: stream, audio: audio, raf: 0, url: url, timer: 0 };
  session.raf = requestAnimationFrame(draw);
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

  function trim() {
    if (!source || !session || source.updating || !source.buffered.length) return;
    var now = stage.currentTime;
    if (now > 8) {
      try {
        source.remove(0, now - 4);
      } catch (err) {
        /* removing while busy is expected; the next updateend retries */
      }
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
        trim();
        pump();
      });
      recorder.addEventListener("dataavailable", function (event) {
        if (event.data && event.data.size) {
          queue.push(event.data);
          pump();
        }
      });
      recorder.start(250);
      stage.play().catch(function (err) {
        line("play() refused: " + err.message, "no");
      });
      monitor(source, stream);
    },
    { once: true }
  );
}

function monitor(source, stream) {
  var started = performance.now();
  var firstFrame = null;
  var painted = 0;

  if (stage.requestVideoFrameCallback) {
    var count = function () {
      if (!session) return;
      painted++;
      if (firstFrame === null) firstFrame = Math.round(performance.now() - started);
      stage.requestVideoFrameCallback(count);
    };
    stage.requestVideoFrameCallback(count);
  }

  session.timer = setTimeout(function () {
    var elapsed = (performance.now() - started) / 1000;
    var quality = stage.getVideoPlaybackQuality ? stage.getVideoPlaybackQuality() : null;
    var buffered = source.buffered.length ? source.buffered.end(source.buffered.length - 1) - source.buffered.start(0) : 0;
    var fps = painted / elapsed;
    var lag = elapsed - stage.currentTime;

    line("=== 5 AFTER " + Math.round(elapsed) + "s ===");
    line("first painted frame: " + (firstFrame === null ? "NEVER" : firstFrame + " ms"), firstFrame !== null && firstFrame < 3000 ? "ok" : "no");
    line("painted frames: " + painted + "  (~" + fps.toFixed(1) + " fps)", fps >= 20 ? "ok" : "no");
    line("video.currentTime: " + stage.currentTime.toFixed(2) + "s   buffered: " + buffered.toFixed(2) + "s");
    line("approximate pipeline delay: " + lag.toFixed(2) + "s", lag <= 1.5 ? "ok" : "no");
    line("quality: total=" + (quality ? quality.totalVideoFrames : "n/a") + " dropped=" + (quality ? quality.droppedVideoFrames : "n/a"));
    line("audio tracks in recording: " + stream.getAudioTracks().length, stream.getAudioTracks().length ? "ok" : "no");
    line("audio context state: " + (session && session.audio ? session.audio.state : "none"));
    line(
      firstFrame !== null
        ? "RESULT: MSE loopback renders -> Branch B viable (press 'Sound on/off', a hum means audio works end to end)"
        : "RESULT: MSE loopback did NOT render -> Branch B not viable",
      firstFrame !== null ? "ok" : "no"
    );
  }, 30000);
}

/* ---------------------------------------------------------------- wiring */
var actions = {
  env: runEnv,
  caps: runCaps,
  types: runTypes,
  loop: runLoop
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
  runLoop(30);
});

document.getElementById("stop").addEventListener("click", stopSession);

document.getElementById("sound").addEventListener("click", function () {
  stage.muted = !stage.muted;
  line("sound: " + (stage.muted ? "muted" : "ON — you should hear a 220 Hz hum"));
});

line("screenmirror probe ready. Press 'Run all'.");
