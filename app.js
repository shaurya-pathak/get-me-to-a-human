const API_BASE = ["localhost", "127.0.0.1"].includes(location.hostname)
  ? "http://127.0.0.1:8765"
  : "https://api.human.shauryapathak.com";
const EMAIL = "shaurypathak24@gmail.com";
const terminalStatuses = new Set(["completed", "succeeded", "partial", "needs_user", "failed", "canceled"]);
const statusLabels = {
  draft: "Preparing", queued: "Queued", dialing: "Calling company",
  in_progress: "Navigating and waiting", human_found: "Human found",
  connecting: "Calling you", connected: "Connected", completed: "Complete",
  succeeded: "Complete", partial: "Partly complete", needs_user: "Needs you",
  failed: "Call failed", canceled: "Canceled",
};

const state = {
  online: false,
  token: sessionStorage.getItem("callboxOperatorToken") || "",
  caseId: "",
  poller: null,
};

const $ = (selector) => document.querySelector(selector);

function normalizePhone(value) {
  const raw = value.trim();
  if (raw.startsWith("+")) return `+${raw.slice(1).replace(/\D/g, "")}`;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return raw;
}

async function api(path, options = {}, authenticated = true) {
  const headers = new Headers(options.headers || {});
  if (authenticated && state.token) headers.set("Authorization", `Bearer ${state.token}`);
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers, cache: "no-store" });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const payload = await response.json();
      if (typeof payload.detail === "string") message = payload.detail;
    } catch (_) {}
    throw new Error(message);
  }
  return response.json();
}

async function checkStatus() {
  const panel = $("#server-status");
  panel.className = "server-status checking";
  $("#server-state").textContent = "Checking MacBook";
  $("#server-message").textContent = "The public site stays online. Live voice processing runs on my MacBook.";
  $("#status-retry").classList.add("hidden");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${API_BASE}/api/public-status`, { cache: "no-store", signal: controller.signal });
    const payload = await response.json();
    state.online = response.ok && payload.status === "online";
  } catch (_) {
    state.online = false;
  } finally {
    clearTimeout(timeout);
  }

  if (state.online) {
    panel.className = "server-status online";
    $("#server-state").textContent = "MacBook online";
    $("#server-message").textContent = "Parakeet and Qwen are ready for a live operator demo.";
    $("#unlock-form").classList.remove("hidden");
    if (state.token) void verifyToken();
  } else {
    panel.className = "server-status offline";
    $("#server-state").textContent = "MacBook offline";
    $("#server-message").innerHTML = `The static demo still works. Email <a href="mailto:${EMAIL}?subject=Get%20Me%20to%20a%20Human%20demo">${EMAIL}</a> if you want me to turn on the live voice server.`;
    $("#status-retry").classList.remove("hidden");
    $("#unlock-form").classList.add("hidden");
    $("#call-form").classList.add("hidden");
  }
}

async function verifyToken(event) {
  event?.preventDefault();
  state.token = $("#operator-token").value.trim() || state.token;
  $("#unlock-error").textContent = "";
  try {
    await api("/api/operator/verify");
    sessionStorage.setItem("callboxOperatorToken", state.token);
    $("#unlock-form").classList.add("hidden");
    $("#call-form").classList.remove("hidden");
  } catch (error) {
    state.token = "";
    sessionStorage.removeItem("callboxOperatorToken");
    $("#unlock-error").textContent = error.message;
    $("#unlock-form").classList.remove("hidden");
  }
}

function renderCase(current) {
  $("#active-company").textContent = current.company;
  $("#active-status").textContent = statusLabels[current.status] || current.status;
  $("#active-objective").textContent = current.objective;
  const transcript = $("#transcript");
  transcript.replaceChildren();
  const session = current.sessions?.[0];
  for (const turn of session?.transcript || []) {
    const row = document.createElement("div");
    row.className = "turn";
    const speaker = document.createElement("strong");
    speaker.textContent = turn.role === "assistant" ? "Agent" : "Company";
    const text = document.createElement("p");
    text.textContent = turn.text;
    row.append(speaker, text);
    transcript.append(row);
  }
  $("#cancel-call").classList.toggle("hidden", terminalStatuses.has(current.status));
  if (terminalStatuses.has(current.status)) stopPolling();
}

async function refreshCase() {
  if (!state.caseId) return;
  try {
    renderCase(await api(`/api/support/cases/${state.caseId}`));
  } catch (error) {
    $("#active-error").textContent = error.message;
  }
}

function stopPolling() {
  if (state.poller) clearInterval(state.poller);
  state.poller = null;
}

async function startCall(event) {
  event.preventDefault();
  if (!confirm("Place this real paid call through Twilio?")) return;
  $("#call-error").textContent = "";
  const request = {
    company: $("#company").value.trim(),
    phone_number: normalizePhone($("#company-phone").value),
    callback_number: normalizePhone($("#callback-phone").value),
    caller_name: $("#caller-name").value.trim(),
    objective: $("#objective").value.trim(),
    success_criteria: ["A live employee is ready to speak with the caller."],
    private_values: {},
    max_call_minutes: 20,
    max_attempts: 1,
  };

  try {
    const created = await api("/api/support/cases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request),
    });
    state.caseId = created.id;
    $("#call-form").classList.add("hidden");
    $("#active-call").classList.remove("hidden");
    renderCase(created);
    const placed = await api(`/api/support/cases/${created.id}/call`, { method: "POST" });
    renderCase(placed.case);
    state.poller = setInterval(refreshCase, 1200);
  } catch (error) {
    $("#call-error").textContent = error.message;
  }
}

async function cancelCall() {
  if (!state.caseId || !confirm("Stop the call and disconnect every active phone leg?")) return;
  try {
    const result = await api(`/api/support/cases/${state.caseId}/cancel`, { method: "POST" });
    renderCase(result.case);
  } catch (error) {
    $("#active-error").textContent = error.message;
  }
}

let walkthroughTimer = null;
function playWalkthrough() {
  const items = [...document.querySelectorAll("#walkthrough li")];
  if (walkthroughTimer) clearInterval(walkthroughTimer);
  items.forEach((item) => item.classList.remove("visible"));
  let index = 0;
  items[index++].classList.add("visible");
  walkthroughTimer = setInterval(() => {
    if (index >= items.length) {
      clearInterval(walkthroughTimer);
      walkthroughTimer = null;
      return;
    }
    items[index++].classList.add("visible");
  }, 650);
}

$("#status-retry").addEventListener("click", checkStatus);
$("#play-walkthrough").addEventListener("click", playWalkthrough);
$("#unlock-form").addEventListener("submit", verifyToken);
$("#call-form").addEventListener("submit", startCall);
$("#cancel-call").addEventListener("click", cancelCall);
$("#operator-token").value = state.token;
playWalkthrough();
