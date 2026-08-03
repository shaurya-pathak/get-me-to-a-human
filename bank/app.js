const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const speech = window.speechSynthesis;
let manualTimer = null;
let manualSeconds = 0;
let manualStage = "idle";
let currentUtterance = null;
let agentTimers = [];
let agentSeconds = 0;
let agentClock = null;
let callMuted = false;

const prompts = {
  welcome: {
    text: "Thank you for calling Northstar Bank. Your call may be monitored or recorded for quality and training purposes. Before we begin, Northstar customers can earn sixty thousand bonus points with our new Horizon Premier credit card after qualifying purchases. Visit northstar bank dot com slash horizon to learn more. To continue in English, press one. Para español, oprima el dos.",
    next: { "1": "main", "2": "spanish" },
  },
  main: {
    text: "Please listen carefully, as our menu options have recently changed. For account balances, recent transactions, or statements, press one. For debit cards, credit cards, or to report a card lost or stolen, press two. For transfers, payments, or bill pay, press three. For loans or mortgages, press four. For all other banking needs, press five. To hear these options again, press nine.",
    next: { "1": "accounts", "2": "cards", "3": "transfers", "4": "loans", "5": "other", "9": "main" },
  },
  accounts: {
    text: "For checking accounts, press one. For savings accounts, press two. For certificates of deposit, press three. To return to the previous menu, press star.",
    next: { "1": "checking", "2": "representative", "3": "representative", "*": "main" },
  },
  checking: {
    text: "For your balance, press one. For recent activity, press two. To order checks, press three. To close an account or speak with a banker, press four. To return to the previous menu, press star.",
    next: { "1": "selfservice", "2": "selfservice", "3": "selfservice", "4": "hold", "*": "accounts" },
  },
  cards: {
    text: "If your card was lost or stolen, press one. To dispute a transaction, press two. For rewards or a new card application, press three. For all other card questions, press four.",
    next: { "1": "hold", "2": "hold", "3": "selfservice", "4": "hold" },
  },
  transfers: { text: "For transfers between Northstar accounts, press one. For external transfers, press two. For bill pay, press three. To speak with a banker, press zero.", next: { "0": "hold", "1": "selfservice", "2": "hold", "3": "hold" } },
  loans: { text: "For mortgage servicing, press one. For home equity, press two. For auto loans, press three. For personal loans, press four.", next: { "1": "hold", "2": "hold", "3": "hold", "4": "hold" } },
  other: { text: "To change your address, press one. To find a branch, press two. To speak with a banker about another request, press zero.", next: { "0": "hold", "1": "selfservice", "2": "selfservice" } },
  spanish: { text: "Esta demostración continúa solamente en inglés. Oprima uno para continuar.", next: { "1": "main" } },
  selfservice: { text: "You can complete this request faster in the Northstar mobile app. To receive a text message with a link, press one. To speak with a banker, press zero.", next: { "0": "hold", "1": "hold" } },
  hold: { text: "Please hold while we connect you. Your estimated wait time is greater than twenty minutes.", next: {} },
};

const agentPaths = {
  close: [
    ["Bank", "Your call may be recorded. Before we begin, hear about our new Horizon Premier credit card…"], ["Agent", "Recognized the opening menu · pressed 1 for English"],
    ["Bank", "For account balances, recent transactions, or statements, press 1…"], ["Agent", "Pressed 1 · Accounts"],
    ["Bank", "For checking accounts, press 1…"], ["Agent", "Pressed 1 · Checking"],
    ["Bank", "To close an account or speak with a banker, press 4."], ["Agent", "Pressed 4 · Close account or banker"],
  ],
  stolen: [
    ["Bank", "Your call may be recorded. Before we begin, hear about our new Horizon Premier credit card…"], ["Agent", "Recognized the opening menu · pressed 1 for English"],
    ["Bank", "For debit cards, credit cards, or a lost or stolen card, press 2…"], ["Agent", "Pressed 2 · Cards"],
    ["Bank", "If your card was lost or stolen, press 1."], ["Agent", "Pressed 1 · Lost or stolen card"],
  ],
  dispute: [
    ["Bank", "Your call may be recorded. Before we begin, hear about our new Horizon Premier credit card…"], ["Agent", "Recognized the opening menu · pressed 1 for English"],
    ["Bank", "For debit cards, credit cards, or a lost or stolen card, press 2…"], ["Agent", "Pressed 2 · Cards"],
    ["Bank", "To dispute a transaction, press 2."], ["Agent", "Pressed 2 · Dispute transaction"],
  ],
  mortgage: [
    ["Bank", "Your call may be recorded. Before we begin, hear about our new Horizon Premier credit card…"], ["Agent", "Recognized the opening menu · pressed 1 for English"],
    ["Bank", "For loans or mortgages, press 4…"], ["Agent", "Pressed 4 · Loans or mortgages"],
    ["Bank", "For mortgage servicing, press 1."], ["Agent", "Pressed 1 · Mortgage servicing"],
  ],
  other: [
    ["Bank", "Your call may be recorded. Before we begin, hear about our new Horizon Premier credit card…"], ["Agent", "Recognized the opening menu · pressed 1 for English"],
    ["Bank", "For all other banking needs, press 5."], ["Agent", "Pressed 5 · Other banking needs"],
    ["Bank", "Please briefly tell me what you are calling about."], ["Agent", "Explained the caller's requested outcome"],
  ],
};

function formatTime(seconds) {
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function stopSpeech() {
  speech?.cancel();
  currentUtterance = null;
}

function say(text, { slow = false, onend } = {}) {
  stopSpeech();
  if (!speech || callMuted) {
    const timer = setTimeout(() => onend?.(), Math.min(2600, 450 + text.length * 7));
    agentTimers.push(timer);
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = slow ? 0.72 : 1.05;
  utterance.pitch = slow ? 0.92 : 1;
  utterance.volume = 1;
  utterance.onend = () => onend?.();
  utterance.onerror = () => onend?.();
  currentUtterance = utterance;
  speech.speak(utterance);
}

function setKeys(enabled) {
  $$("#keypad button").forEach((button) => { button.disabled = !enabled; });
}

function startManualClock() {
  clearInterval(manualTimer);
  manualSeconds = 0;
  $("#manual-time").textContent = "00:00";
  manualTimer = setInterval(() => {
    manualSeconds += 1;
    $("#manual-time").textContent = formatTime(manualSeconds);
  }, 1000);
}

function playManualStage(stage) {
  manualStage = stage;
  const prompt = prompts[stage];
  $("#manual-transcript").textContent = prompt.text;
  $("#manual-state").textContent = stage === "hold" ? "Waiting for a banker" : "Automated system speaking";
  $(".phone-shell").classList.add("calling");
  $("#manual-progress").style.setProperty("--progress", stage === "hold" ? "100%" : "38%");
  setKeys(false);
  $("#skip-prompt").classList.remove("hidden");
  say(prompt.text, {
    slow: true,
    onend: () => {
      setKeys(stage !== "hold");
      $("#manual-state").textContent = stage === "hold" ? "Estimated wait: 20+ minutes" : "Waiting for your selection";
      $("#skip-prompt").classList.add("hidden");
    },
  });
}

function startManual() {
  $("#manual-call").classList.add("hidden");
  $("#manual-end").classList.remove("hidden");
  startManualClock();
  playManualStage("welcome");
}

function endManual() {
  clearInterval(manualTimer);
  stopSpeech();
  manualStage = "idle";
  $(".phone-shell").classList.remove("calling");
  $("#manual-call").classList.remove("hidden");
  $("#manual-end").classList.add("hidden");
  $("#skip-prompt").classList.add("hidden");
  $("#manual-state").textContent = "Ready to call";
  $("#manual-transcript").textContent = "Press call to enter the automated phone system.";
  $("#manual-progress").style.setProperty("--progress", "0%");
  setKeys(false);
}

function pressManualKey(key) {
  if (manualStage === "idle") return;
  const next = prompts[manualStage]?.next[key];
  $("#manual-state").textContent = `You pressed ${key}`;
  if (next) {
    setTimeout(() => playManualStage(next), 300);
  } else {
    say("That is not a valid selection. Please try again.", { slow: true, onend: () => setKeys(true) });
  }
}

function switchMode(mode) {
  stopSpeech();
  $$(".mode").forEach((button) => button.classList.toggle("active", button.dataset.mode === mode));
  $("#manual-demo").classList.toggle("hidden", mode !== "manual");
  $("#agent-demo").classList.toggle("hidden", mode !== "agent");
  if (mode !== "manual") endManual();
}

function classifyIntent(intent) {
  const value = intent.toLowerCase();
  if (/close|checking/.test(value)) return "close";
  if (/stolen|lost/.test(value)) return "stolen";
  if (/dispute|charge|transaction/.test(value)) return "dispute";
  if (/mortgage|home loan/.test(value)) return "mortgage";
  return "other";
}

function clearAgentTimers() {
  agentTimers.forEach(clearTimeout);
  agentTimers = [];
  clearInterval(agentClock);
  agentClock = null;
  stopSpeech();
}

function addAgentLog(speaker, text) {
  const row = document.createElement("li");
  row.className = speaker === "Agent" ? "action" : "prompt";
  const label = document.createElement("span");
  label.textContent = speaker;
  const copy = document.createElement("p");
  copy.textContent = text;
  row.append(label, copy);
  $("#agent-log").append(row);
  row.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function scheduleAgentStep(path, index) {
  if (index >= path.length) {
    $("#agent-status").textContent = "Waiting on hold";
    addAgentLog("Bank", "Please hold. Your estimated wait time is greater than twenty minutes.");
    say("Please hold. Your estimated wait time is greater than twenty minutes.", { slow: true });
    const holdTimer = setTimeout(() => {
      addAgentLog("System", "Representative detected after simulated hold");
      $("#agent-status-label").textContent = "HUMAN FOUND";
      $("#agent-status").textContent = "Calling you now";
      $("#user-card").className = "user-card ringing";
      $("#user-state").textContent = "Your phone is ringing";
      $("#user-detail").textContent = "A Northstar representative is on the line. Answer to be connected.";
      $("#restart-agent").classList.remove("hidden");
      $(".agent-call").classList.remove("running");
      $(".agent-call").classList.add("complete");
      clearInterval(agentClock);
      say("A representative is ready. Calling you now.");
    }, 4200);
    agentTimers.push(holdTimer);
    return;
  }

  const [speaker, text] = path[index];
  addAgentLog(speaker, text);
  $("#agent-status").textContent = speaker === "Bank" ? "Listening to the phone tree" : text;
  if (speaker === "Agent") {
    const digit = text.match(/Pressed ([0-9*#])/i)?.[1];
    if (digit) playTone(digit);
    const timer = setTimeout(() => scheduleAgentStep(path, index + 1), 700);
    agentTimers.push(timer);
  } else {
    say(text, { slow: true, onend: () => scheduleAgentStep(path, index + 1) });
  }
}

function playTone(key) {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const frequencies = { "1": 697, "2": 770, "3": 852, "4": 941, "5": 770 };
    oscillator.frequency.value = frequencies[key] || 800;
    gain.gain.value = callMuted ? 0 : .08;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + .12);
  } catch (_) {}
}

function startAgent(event) {
  event.preventDefault();
  const intent = $("#intent").value.trim();
  if (!intent) return;
  clearAgentTimers();
  $("#intent-form").classList.add("hidden");
  $("#agent-call").classList.remove("hidden");
  $("#agent-call").classList.add("running");
  $("#agent-call").classList.remove("complete");
  $("#restart-agent").classList.add("hidden");
  $("#agent-log").replaceChildren();
  $("#active-intent").textContent = intent;
  $("#agent-status-label").textContent = "AGENT WORKING";
  $("#agent-status").textContent = "Calling Northstar Bank";
  $("#user-card").className = "user-card waiting";
  $("#user-state").textContent = "Free to do something else";
  $("#user-detail").textContent = "We will ring you when a representative answers.";
  agentSeconds = 0;
  $("#agent-time").textContent = "00:00";
  agentClock = setInterval(() => {
    agentSeconds += 1;
    $("#agent-time").textContent = formatTime(agentSeconds);
  }, 1000);
  const timer = setTimeout(() => scheduleAgentStep(agentPaths[classifyIntent(intent)], 0), 700);
  agentTimers.push(timer);
}

function restartAgent() {
  clearAgentTimers();
  $("#agent-call").classList.add("hidden");
  $("#intent-form").classList.remove("hidden");
}

$$(".mode").forEach((button) => button.addEventListener("click", () => switchMode(button.dataset.mode)));
$("#manual-call").addEventListener("click", startManual);
$("#manual-end").addEventListener("click", endManual);
$("#skip-prompt").addEventListener("click", () => {
  stopSpeech();
  setKeys(manualStage !== "hold");
  $("#manual-state").textContent = manualStage === "hold" ? "Estimated wait: 20+ minutes" : "Waiting for your selection";
  $("#skip-prompt").classList.add("hidden");
});
$$("#keypad button").forEach((button) => button.addEventListener("click", () => pressManualKey(button.dataset.key)));
$("#intent-form").addEventListener("submit", startAgent);
$$("[data-intent]").forEach((button) => button.addEventListener("click", () => { $("#intent").value = button.dataset.intent; }));
$("#audio-toggle").addEventListener("click", () => {
  callMuted = !callMuted;
  $("#audio-toggle").textContent = callMuted ? "Listen to call" : "Mute call";
  if (callMuted) stopSpeech();
});
$("#restart-agent").addEventListener("click", restartAgent);
setKeys(false);
