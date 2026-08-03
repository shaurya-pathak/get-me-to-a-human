const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

const speech = window.speechSynthesis;
let manualTimer = null;
let manualSeconds = 0;
let manualStage = "idle";
let manualDelays = [];
let manualPromptToken = 0;
let holdAudioContext = null;
let holdMusicTimer = null;
let holdNoteIndex = 0;
let currentUtterance = null;
let agentTimers = [];
let agentSeconds = 0;
let agentClock = null;
let callMuted = false;
let reservationTimers = [];
let reservationSeconds = 0;
let reservationClock = null;

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

const manualPromptLines = {
  welcome: [
    ["Thank you for calling Northstar Bank."],
    ["Your call may be monitored or recorded for quality and training purposes."],
    ["Before we begin, hear about our new Horizon Premier credit card."],
    ["Earn sixty thousand bonus points after qualifying purchases."],
    ["Visit northstar bank dot com slash horizon to learn more."],
    ["To continue in English, press one.", true],
    ["Para español, oprima el dos.", true],
  ],
  main: [
    ["Please listen carefully. Our menu options have recently changed."],
    ["For balances, recent transactions, or statements, press one.", true],
    ["For cards, including lost or stolen cards, press two.", true],
    ["For transfers, payments, or bill pay, press three.", true],
    ["For loans or mortgages, press four.", true],
    ["For all other banking needs, press five.", true],
    ["To hear these options again, press nine.", true],
  ],
  accounts: [
    ["For checking accounts, press one.", true],
    ["For savings accounts, press two.", true],
    ["For certificates of deposit, press three.", true],
    ["To return to the previous menu, press star.", true],
  ],
  checking: [
    ["For your balance, press one.", true],
    ["For recent activity, press two.", true],
    ["To order checks, press three.", true],
    ["To close an account or speak with a banker, press four.", true],
    ["To return to the previous menu, press star.", true],
  ],
  cards: [
    ["If your card was lost or stolen, press one.", true],
    ["To dispute a transaction, press two.", true],
    ["For rewards or a new application, press three.", true],
    ["For all other card questions, press four.", true],
  ],
  transfers: [
    ["For transfers between Northstar accounts, press one.", true],
    ["For external transfers, press two.", true],
    ["For bill pay, press three.", true],
    ["To speak with a banker, press zero.", true],
  ],
  loans: [
    ["For mortgage servicing, press one.", true],
    ["For home equity, press two.", true],
    ["For auto loans, press three.", true],
    ["For personal loans, press four.", true],
  ],
  other: [
    ["To change your address, press one.", true],
    ["To find a branch, press two.", true],
    ["For another request, press zero to speak with a banker.", true],
  ],
  spanish: [["Esta demostración continúa solamente en inglés."], ["Oprima uno para continuar.", true]],
  selfservice: [
    ["You can complete this request faster in the Northstar mobile app."],
    ["To receive a text message with a link, press one.", true],
    ["To speak with a banker, press zero.", true],
  ],
  hold: [
    ["Please hold while we connect you."],
    ["Your estimated wait time is greater than twenty minutes."],
  ],
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

function playDualTone(lowFrequency, highFrequency, duration = 0.16, muted = false) {
  try {
    const context = new AudioContext();
    const gain = context.createGain();
    gain.gain.setValueAtTime(muted ? 0 : 0.055, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + duration);
    for (const frequency of [lowFrequency, highFrequency]) {
      const oscillator = context.createOscillator();
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      oscillator.start();
      oscillator.stop(context.currentTime + duration);
    }
    gain.connect(context.destination);
    const closeTimer = setTimeout(() => context.close(), (duration + 0.2) * 1000);
    return closeTimer;
  } catch (_) {
    return null;
  }
}

function playRingback(onComplete, timerStore, muted = false) {
  const ring = () => playDualTone(440, 480, 1.8, muted);
  ring();
  const secondRing = setTimeout(ring, 3600);
  const answered = setTimeout(onComplete, 6100);
  timerStore.push(secondRing, answered);
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

function prepareHoldMusic() {
  try {
    if (!holdAudioContext || holdAudioContext.state === "closed") holdAudioContext = new AudioContext();
    void holdAudioContext.resume();
  } catch (_) {}
}

function playHoldNote() {
  if (!holdAudioContext || holdAudioContext.state === "closed") return;
  const melody = [523.25, 659.25, 587.33, 392, 440, 523.25, 493.88, 392];
  const frequency = melody[holdNoteIndex % melody.length];
  holdNoteIndex += 1;
  const oscillator = holdAudioContext.createOscillator();
  const filter = holdAudioContext.createBiquadFilter();
  const gain = holdAudioContext.createGain();
  oscillator.type = "square";
  oscillator.frequency.value = frequency;
  filter.type = "lowpass";
  filter.frequency.value = 1150;
  gain.gain.setValueAtTime(0.018, holdAudioContext.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, holdAudioContext.currentTime + 0.23);
  oscillator.connect(filter).connect(gain).connect(holdAudioContext.destination);
  oscillator.start();
  oscillator.stop(holdAudioContext.currentTime + 0.24);
}

function startHoldMusic() {
  if (holdMusicTimer) return;
  prepareHoldMusic();
  playHoldNote();
  holdMusicTimer = setInterval(playHoldNote, 330);
}

function stopHoldMusic() {
  clearInterval(holdMusicTimer);
  holdMusicTimer = null;
  holdNoteIndex = 0;
  if (holdAudioContext && holdAudioContext.state !== "closed") void holdAudioContext.close();
  holdAudioContext = null;
}

function showHoldCard() {
  $("#hold-card").classList.remove("hidden");
  $("#manual-experience").classList.add("holding");
  $("#manual-end").textContent = "End demo";
  startHoldMusic();
}

function renderManualLines(lines, activeIndex) {
  const transcript = $("#manual-transcript");
  transcript.replaceChildren();
  const start = Math.max(0, Math.min(activeIndex - 1, lines.length - 3));
  const end = Math.min(lines.length, start + 3);
  for (let index = start; index < end; index += 1) {
    const line = document.createElement("p");
    line.textContent = lines[index][0];
    line.className = index < activeIndex ? "past" : index === activeIndex ? "active" : "future";
    transcript.append(line);
  }
}

function setManualMessage(message) {
  const transcript = $("#manual-transcript");
  transcript.replaceChildren();
  const line = document.createElement("p");
  line.className = "active";
  line.textContent = message;
  transcript.append(line);
}

function speakManualLine(stage, lines, index, token) {
  if (token !== manualPromptToken || manualStage !== stage) return;
  if (index >= lines.length) {
    setKeys(stage !== "hold");
    $("#manual-state").textContent = stage === "hold" ? "Estimated wait: 20+ minutes" : "Waiting for your selection";
    $("#skip-prompt").classList.add("hidden");
    return;
  }
  renderManualLines(lines, index);
  if (stage === "hold" && index === 1) showHoldCard();
  if (lines[index][1] && stage !== "hold") setKeys(true);
  say(lines[index][0], {
    slow: true,
    onend: () => speakManualLine(stage, lines, index + 1, token),
  });
}

function playManualStage(stage) {
  manualPromptToken += 1;
  manualStage = stage;
  const lines = manualPromptLines[stage];
  $("#manual-state").textContent = stage === "hold" ? "Waiting for a banker" : "Automated system speaking";
  $(".phone-shell").classList.add("calling");
  $("#manual-progress").style.setProperty("--progress", stage === "hold" ? "100%" : "38%");
  setKeys(false);
  $("#skip-prompt").classList.remove("hidden");
  speakManualLine(stage, lines, 0, manualPromptToken);
}

function startManual() {
  $("#manual-call").classList.add("hidden");
  $("#manual-end").classList.remove("hidden");
  startManualClock();
  prepareHoldMusic();
  manualStage = "dialing";
  $(".phone-shell").classList.add("calling");
  $("#manual-state").textContent = "Ringing Northstar Bank";
  setManualMessage("Calling…");
  $("#manual-progress").style.setProperty("--progress", "12%");
  setKeys(false);
  playRingback(() => playManualStage("welcome"), manualDelays);
}

function endManual() {
  clearInterval(manualTimer);
  manualDelays.forEach(clearTimeout);
  manualDelays = [];
  manualPromptToken += 1;
  stopHoldMusic();
  stopSpeech();
  manualStage = "idle";
  $(".phone-shell").classList.remove("calling");
  $("#manual-call").classList.remove("hidden");
  $("#manual-end").classList.add("hidden");
  $("#manual-end").textContent = "End call";
  $("#hold-card").classList.add("hidden");
  $("#manual-experience").classList.remove("holding");
  $("#skip-prompt").classList.add("hidden");
  $("#manual-state").textContent = "Ready to call";
  setManualMessage("Press call to enter the automated phone system.");
  $("#manual-progress").style.setProperty("--progress", "0%");
  setKeys(false);
}

function pressManualKey(key) {
  if (manualStage === "idle" || manualStage === "dialing") return;
  const selectedStage = manualStage;
  const next = prompts[selectedStage]?.next[key];
  manualPromptToken += 1;
  manualStage = "transitioning";
  stopSpeech();
  setKeys(false);
  playTone(key, false);
  $("#manual-state").textContent = `Sending ${key}…`;
  if (next) {
    const acknowledged = setTimeout(() => {
      $("#manual-state").textContent = "Selection received · one moment";
    }, 480);
    const nextMenu = setTimeout(() => playManualStage(next), 1650);
    manualDelays.push(acknowledged, nextMenu);
  } else {
    const invalid = setTimeout(() => {
      manualStage = selectedStage;
      setManualMessage("That is not a valid selection. Please try again.");
      say("That is not a valid selection. Please try again.", {
        slow: true,
        onend: () => {
          renderManualLines(manualPromptLines[selectedStage], manualPromptLines[selectedStage].length - 1);
          setKeys(true);
        },
      });
    }, 1200);
    manualDelays.push(invalid);
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

function reservationDetails(request) {
  const lower = request.toLowerCase();
  const party = request.match(/(?:for|party of)\s+(\d+)/i)?.[1] || "2";
  if (/patio|outside|outdoor/.test(lower)) {
    return {
      party,
      hostOffer: "I don't have seven on the patio. I can do six thirty inside or seven thirty on the patio.",
      decision: "Seven thirty on the patio works. Please book that under Shaurya.",
      summary: `Tomorrow · 7:30 PM · Patio · Party of ${party}`,
      reason: "The agent moved the time by 30 minutes to keep the patio preference.",
      confirmation: `You're confirmed for a party of ${party} tomorrow at seven thirty on the patio.`,
    };
  }
  if (/wheelchair|accessible|accessibility/.test(lower)) {
    return {
      party,
      hostOffer: "Seven o'clock is only available at a high-top table. I have an accessible table at six thirty.",
      decision: "Please take the accessible table at six thirty under Shaurya.",
      summary: `Tomorrow · 6:30 PM · Accessible table · Party of ${party}`,
      reason: "The agent prioritized the accessibility requirement over the requested time.",
      confirmation: `You're confirmed for a party of ${party} tomorrow at six thirty at an accessible table.`,
    };
  }
  if (/anniversary|birthday|quiet|special/.test(lower)) {
    return {
      party,
      hostOffer: "I can seat you at seven, but our quiet dining room opens at seven thirty.",
      decision: "Let's do seven thirty in the quiet dining room. Please put it under Shaurya.",
      summary: `Tomorrow · 7:30 PM · Quiet dining room · Party of ${party}`,
      reason: "The agent chose the later table to preserve the special-occasion preference.",
      confirmation: `You're confirmed for a party of ${party} tomorrow at seven thirty in the quiet dining room.`,
    };
  }
  return {
    party,
    hostOffer: "Seven is full. I can do six thirty or seven thirty.",
    decision: "Seven thirty is closest. Please book that under Shaurya.",
    summary: `Tomorrow · 7:30 PM · Party of ${party}`,
    reason: "The agent selected the closest available time.",
    confirmation: `You're confirmed for a party of ${party} tomorrow at seven thirty.`,
  };
}

function addReservationLine(speaker, text) {
  const row = document.createElement("li");
  row.className = speaker === "Agent" ? "agent" : "restaurant";
  const label = document.createElement("span");
  label.textContent = speaker;
  const copy = document.createElement("p");
  copy.textContent = text;
  row.append(label, copy);
  $("#reservation-log").append(row);
}

function speakReservation(text, speaker, onend) {
  stopSpeech();
  if (!speech) {
    const timer = setTimeout(onend, Math.min(2600, 500 + text.length * 12));
    reservationTimers.push(timer);
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = speech.getVoices();
  utterance.voice = speaker === "Agent" ? voices.find((voice) => /Samantha|Ava|Serena/i.test(voice.name)) || voices[0] : voices.find((voice) => /Daniel|Alex|Tom/i.test(voice.name)) || voices[1] || voices[0];
  utterance.rate = speaker === "Agent" ? 1.05 : .94;
  utterance.pitch = speaker === "Agent" ? 1.03 : .95;
  utterance.onend = onend;
  utterance.onerror = onend;
  currentUtterance = utterance;
  speech.speak(utterance);
}

function runReservationConversation(request, details) {
  const steps = [
    ["Marlow", "Marlow restaurant, this is Nina. How can I help?"],
    ["Agent", `Hi, I'm calling for Shaurya. ${request}. What do you have available?`],
    ["Marlow", details.hostOffer],
    ["Agent", details.decision],
    ["Marlow", details.confirmation],
  ];
  const advance = (index) => {
    if (index >= steps.length) {
      $("#reservation-status").textContent = "Reservation complete";
      $("#reservation-summary").textContent = details.summary;
      $("#reservation-decision").textContent = details.reason;
      $("#reservation-result").classList.remove("hidden");
      $("#reservation-restart").classList.remove("hidden");
      $("#reservation-call").classList.remove("running");
      $("#reservation-call").classList.add("complete");
      clearInterval(reservationClock);
      return;
    }
    const [speaker, text] = steps[index];
    $("#reservation-status").textContent = speaker === "Agent" ? "Agent speaking" : "Restaurant speaking";
    addReservationLine(speaker, text);
    speakReservation(text, speaker, () => advance(index + 1));
  };
  advance(0);
}

function startReservation(event) {
  event.preventDefault();
  const request = $("#reservation-request").value.trim();
  if (!request) return;
  endManual();
  clearAgentTimers();
  reservationTimers.forEach(clearTimeout);
  reservationTimers = [];
  clearInterval(reservationClock);
  stopSpeech();
  const details = reservationDetails(request);
  $("#reservation-form").classList.add("hidden");
  $("#reservation-call").classList.remove("hidden", "complete");
  $("#reservation-call").classList.add("running");
  $("#reservation-log").replaceChildren();
  $("#reservation-result").classList.add("hidden");
  $("#reservation-restart").classList.add("hidden");
  $("#reservation-status").textContent = "Ringing Marlow";
  reservationSeconds = 0;
  $("#reservation-time").textContent = "00:00";
  reservationClock = setInterval(() => {
    reservationSeconds += 1;
    $("#reservation-time").textContent = formatTime(reservationSeconds);
  }, 1000);
  playRingback(() => runReservationConversation(request, details), reservationTimers);
}

function restartReservation() {
  reservationTimers.forEach(clearTimeout);
  reservationTimers = [];
  clearInterval(reservationClock);
  stopSpeech();
  $("#reservation-call").classList.add("hidden");
  $("#reservation-form").classList.remove("hidden");
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
    $("#agent-status").textContent = digit ? `Sending ${digit} to the phone system` : text;
    const timer = setTimeout(() => scheduleAgentStep(path, index + 1), 1500);
    agentTimers.push(timer);
  } else {
    say(text, { slow: true, onend: () => scheduleAgentStep(path, index + 1) });
  }
}

function playTone(key, muted = callMuted) {
  const tones = {
    "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
    "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
    "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
    "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
  };
  const [low, high] = tones[key] || [800, 1200];
  playDualTone(low, high, 0.18, muted);
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
  $("#agent-status").textContent = "Ringing Northstar Bank";
  $("#user-card").className = "user-card waiting";
  $("#user-state").textContent = "Free to do something else";
  $("#user-detail").textContent = "We will ring you when a representative answers.";
  agentSeconds = 0;
  $("#agent-time").textContent = "00:00";
  agentClock = setInterval(() => {
    agentSeconds += 1;
    $("#agent-time").textContent = formatTime(agentSeconds);
  }, 1000);
  addAgentLog("System", "Dialing Northstar Bank");
  playRingback(() => {
    addAgentLog("System", "Call answered by the automated system");
    scheduleAgentStep(agentPaths[classifyIntent(intent)], 0);
  }, agentTimers, callMuted);
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
  manualPromptToken += 1;
  stopSpeech();
  const lines = manualPromptLines[manualStage];
  if (lines) renderManualLines(lines, lines.length - 1);
  if (manualStage === "hold") showHoldCard();
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
$("#reservation-form").addEventListener("submit", startReservation);
$("#reservation-restart").addEventListener("click", restartReservation);
setKeys(false);
