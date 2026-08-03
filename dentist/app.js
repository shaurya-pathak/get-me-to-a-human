const ALLOW_BARGE_IN = false;
const API_BASE = String(window.CALLBOX_API_BASE || "").replace(/\/$/, "");
const state = {
  phase: "warming",
  session: null,
  stream: null,
  recorder: null,
  chunks: [],
  audioContext: null,
  analyser: null,
  monitorFrame: null,
  speechStarted: false,
  quietSince: null,
  captureStarted: null,
  callStarted: null,
  timer: null,
  agentAudio: null,
  suppressRecorderStop: false,
};

const $ = (selector) => document.querySelector(selector);
const startButton = $("#start-call");
const stopTurnButton = $("#stop-turn");
const endButton = $("#end-call");
const voiceState = $("#voice-state");
const conversation = $("#conversation");
const textForm = $("#text-form");

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, options);
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try { message = (await response.json()).detail || message; } catch (_) {}
    throw new Error(message);
  }
  return response.json();
}

function resourceUrl(path) {
  if (!path || /^(?:https?:|blob:|data:)/.test(path)) return path;
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

function setPhase(phase, message) {
  state.phase = phase;
  voiceState.className = `voice-state ${phase}`;
  voiceState.querySelector("span:last-child").textContent = message;
  $("#call-title").textContent = phase === "listening" ? "Listening" : phase === "speaking" ? "Assistant speaking" : phase === "thinking" ? "Thinking locally" : state.session ? "Call in progress" : "Ready when you are";
  const textDisabled = phase === "speaking" || phase === "thinking";
  $("#text-input").disabled = textDisabled;
  textForm.querySelector("button").disabled = textDisabled;
}

async function pollHealth() {
  try {
    const health = await api("/api/health");
    $("#system-message").textContent = health.status === "ready" ? "All models warm · network-free inference" : health.status === "error" ? health.error : "Warming local models… first launch may download assets";
    for (const kind of ["asr", "llm", "tts"]) {
      $(`#${kind}-dot`).className = `dot ${health.status === "error" ? "error" : health[kind].ready ? "ready" : ""}`;
      $(`#${kind}-model`).textContent = health[kind].model || kind;
    }
    if (health.status === "ready") {
      startButton.disabled = false;
      if (!state.session) setPhase("idle", "Ready for a local call");
      return;
    }
  } catch (error) {
    $("#system-message").textContent = error.message;
  }
  setTimeout(pollHealth, 1800);
}

function appendMessage(role, text, timings = null) {
  conversation.querySelector(".empty-state")?.remove();
  const item = document.createElement("div");
  item.className = `message ${role}`;
  const who = role === "assistant" ? "HD" : "You";
  const latency = timings?.total ? `<span class="meta">${Math.round(timings.total)} ms local turn</span>` : "";
  item.innerHTML = `<div class="avatar">${who}</div><div class="bubble"></div>`;
  item.querySelector(".bubble").textContent = text;
  if (latency) item.querySelector(".bubble").insertAdjacentHTML("beforeend", latency);
  conversation.appendChild(item);
  conversation.scrollTop = conversation.scrollHeight;
}

async function initializeMicrophone() {
  if (state.stream) return;
  state.stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  state.audioContext = new AudioContext();
  const source = state.audioContext.createMediaStreamSource(state.stream);
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 1024;
  source.connect(state.analyser);
}

async function startCall() {
  startButton.disabled = true;
  try {
    setPhase("thinking", "Starting private call…");
    const result = await api("/api/sessions", { method: "POST" });
    state.session = result.session;
    state.callStarted = Date.now();
    state.timer = setInterval(updateTimer, 1000);
    startButton.classList.add("hidden");
    endButton.classList.remove("hidden");
    textForm.classList.remove("hidden");
    appendMessage("assistant", result.assistant_text);
    await playAgent(result.assistant_audio_url);
  } catch (error) {
    setPhase("error", error.message);
    startButton.disabled = false;
  }
}

function pickMimeType() {
  const options = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
  return options.find((value) => MediaRecorder.isTypeSupported(value)) || "";
}

async function beginCapture() {
  if (!state.session || state.session.stage === "complete") return;
  try {
    await initializeMicrophone();
  } catch (error) {
    setPhase("error", "Microphone unavailable · type your response below");
    return;
  }
  const mimeType = pickMimeType();
  state.chunks = [];
  state.speechStarted = false;
  state.quietSince = null;
  state.captureStarted = performance.now();
  state.recorder = new MediaRecorder(state.stream, mimeType ? { mimeType } : undefined);
  state.recorder.ondataavailable = (event) => { if (event.data.size) state.chunks.push(event.data); };
  state.recorder.onstop = sendCapturedTurn;
  state.recorder.start(100);
  stopTurnButton.classList.remove("hidden");
  setPhase("listening", "Speak now · stops after a pause");
  monitorSilence();
}

function monitorSilence() {
  if (state.phase !== "listening" || !state.recorder) return;
  const samples = new Uint8Array(state.analyser.fftSize);
  state.analyser.getByteTimeDomainData(samples);
  let power = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    power += normalized * normalized;
  }
  const rms = Math.sqrt(power / samples.length);
  const now = performance.now();
  if (rms > 0.025) {
    state.speechStarted = true;
    state.quietSince = null;
  } else if (state.speechStarted) {
    state.quietSince ||= now;
    if (now - state.quietSince > 900) return finishCapture();
  }
  if (!state.speechStarted && now - state.captureStarted > 12000) return finishCapture(true);
  if (now - state.captureStarted > 25000) return finishCapture();
  state.monitorFrame = requestAnimationFrame(monitorSilence);
}

function finishCapture(noSpeech = false) {
  if (!state.recorder || state.recorder.state === "inactive") return;
  cancelAnimationFrame(state.monitorFrame);
  stopTurnButton.classList.add("hidden");
  state.recorder.datasetNoSpeech = noSpeech ? "true" : "false";
  state.recorder.stop();
}

async function sendCapturedTurn() {
  if (state.suppressRecorderStop) {
    state.suppressRecorderStop = false;
    return;
  }
  const noSpeech = state.recorder.datasetNoSpeech === "true" || !state.speechStarted;
  if (noSpeech) {
    setPhase("idle", "I didn't hear anything · listening again");
    setTimeout(beginCapture, 700);
    return;
  }
  setPhase("thinking", "Transcribing and finding a match…");
  const type = state.recorder.mimeType || "audio/webm";
  const extension = type.includes("mp4") ? "m4a" : "webm";
  const blob = new Blob(state.chunks, { type });
  const data = new FormData();
  data.append("audio", blob, `caller.${extension}`);
  data.append("expected_revision", state.session.revision);
  try {
    const result = await api(`/api/sessions/${state.session.id}/turn-audio`, { method: "POST", body: data });
    handleTurnResult(result);
    await playAgent(result.assistant_audio_url);
  } catch (error) {
    setPhase("error", error.message);
    setTimeout(beginCapture, 1200);
  }
}

function handleTurnResult(result) {
  state.session = result.session;
  appendMessage("caller", result.user_text);
  appendMessage("assistant", result.assistant_text, result.timings_ms);
  refreshCalendar();
}

async function playAgent(url) {
  setPhase("speaking", "Assistant is speaking");
  const separator = resourceUrl(url).includes("?") ? "&" : "?";
  state.agentAudio = new Audio(`${resourceUrl(url)}${separator}v=${Date.now()}`);
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      resolve();
    };
    const watchdog = setTimeout(() => {
      state.agentAudio?.pause();
      finish();
    }, 30000);
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      reject(error);
    };
    state.agentAudio.onended = finish;
    state.agentAudio.onerror = fail;
    state.agentAudio.play().catch(fail);
  }).catch(() => {});
  state.agentAudio = null;
  if (state.session?.stage === "complete") {
    setPhase("complete", "Appointment penciled in");
  } else {
    await beginCapture();
  }
}

// Explicit cancellation boundary for future barge-in. It is intentionally dormant in v1.
function interruptAgentPlayback() {
  if (!ALLOW_BARGE_IN || !state.agentAudio) return false;
  state.agentAudio.pause();
  state.agentAudio.currentTime = 0;
  state.agentAudio = null;
  beginCapture();
  return true;
}
window.interruptAgentPlayback = interruptAgentPlayback;

async function sendText(event) {
  event.preventDefault();
  const input = $("#text-input");
  const text = input.value.trim();
  if (!text || !state.session || state.phase === "thinking") return;
  if (state.phase === "listening") {
    state.suppressRecorderStop = true;
    finishCapture(true);
  }
  input.value = "";
  setPhase("thinking", "Understanding locally…");
  try {
    const result = await api(`/api/sessions/${state.session.id}/turn-text`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, expected_revision: state.session.revision }),
    });
    handleTurnResult(result);
    await playAgent(result.assistant_audio_url);
  } catch (error) { setPhase("error", error.message); }
}

function endCall() {
  if (state.recorder?.state === "recording") finishCapture(true);
  state.agentAudio?.pause();
  clearInterval(state.timer);
  state.session = null;
  state.callStarted = null;
  $("#timer").textContent = "00:00";
  startButton.classList.remove("hidden");
  startButton.disabled = false;
  endButton.classList.add("hidden");
  stopTurnButton.classList.add("hidden");
  textForm.classList.add("hidden");
  setPhase("idle", "Ready for another local call");
}

function updateTimer() {
  const seconds = Math.floor((Date.now() - state.callStarted) / 1000);
  $("#timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

async function refreshCalendar() {
  try {
    const data = await api("/api/calendar");
    const groups = new Map();
    for (const slot of data.slots) {
      const start = new Date(slot.starts_at);
      const key = start.toISOString().slice(0, 10);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push({ ...slot, start });
    }
    $("#calendar").innerHTML = [...groups.values()].map((slots) => {
      const day = slots[0].start;
      const title = day.toLocaleDateString([], { weekday: "long" });
      const date = day.toLocaleDateString([], { month: "short", day: "numeric" });
      return `<section class="calendar-day"><h3>${title}<span>${date}</span></h3><div class="slots">${slots.map((slot) => `<span class="slot ${slot.status}">${slot.start.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span>`).join("")}</div></section>`;
    }).join("");
  } catch (error) { $("#calendar").innerHTML = `<p class="muted">${error.message}</p>`; }
}

startButton.addEventListener("click", startCall);
stopTurnButton.addEventListener("click", () => finishCapture());
endButton.addEventListener("click", endCall);
textForm.addEventListener("submit", sendText);
$("#refresh-calendar").addEventListener("click", refreshCalendar);
pollHealth();
refreshCalendar();
