/* ── JARVIS — Frontend-Logik ───────────────────────────────────────────── */
/* Hinweis: Der Wabenmuster-Hintergrund (#hexbg) wird von hexbg.js
   gezeichnet, das separat vor diesem Skript eingebunden wird. */

const SEND_RATE = 16000;
const RECV_RATE = 24000;

let ws = null;
let micActive = false;
let muted = false;
let audioCtx = null;
let playCtx = null;
let micStream = null;
let micNode = null;
let playTime = 0;

let orbState = "OFFLINE";
let speaking = false;
let pendingNewsItems = null; // Nachrichten-Orte, die erst beim Sprechbeginn zur Weltkugel werden
let pendingBrainData = null; // Gehirn-Daten, die erst beim Sprechbeginn angezeigt werden

const TAB_LABELS = {
  map: "KARTE", log: "LOG", timer: "TIMER", weather: "WETTER",
  notes: "NOTIZEN", random: "ZUFALL", calc: "RECHNER", files: "DATEIEN", web: "WEB",
  vault: "KONTEN", info: "INFO", apps: "APPS",
};

// ── Uhr ───────────────────────────────────────────────────────────────
function tickClock() {
  const d = new Date();
  document.getElementById("clock").textContent = d.toLocaleTimeString("de-DE");
  document.getElementById("date").textContent =
    d.toLocaleDateString("de-DE", { weekday: "short", day: "2-digit", month: "short", year: "numeric" });
}
setInterval(tickClock, 1000); tickClock();

// ── Gespeicherte Notizen beim Laden abrufen (bleiben über Neustarts erhalten) ──
async function loadNotesFromServer() {
  try {
    const res = await fetch("/api/notes");
    const notes = await res.json();
    if (Array.isArray(notes)) renderNotesList(notes);
  } catch (e) { /* still offline beim ersten Laden, kein Problem */ }
}
loadNotesFromServer();

// ── Broadcast-Mitteilung vom Admin ───────────────────────────────────────
async function checkBroadcast() {
  try {
    const data = await fetch("/api/broadcast").then(r => r.json());
    if (data && data.message) {
      document.getElementById("broadcast-text").textContent = data.message;
      document.getElementById("broadcast-banner").classList.add("show");
      document.getElementById("broadcast-close").onclick = async () => {
        document.getElementById("broadcast-banner").classList.remove("show");
        try {
          await fetch("/api/broadcast/seen", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: data.id }),
          });
        } catch (e) {}
      };
    }
  } catch (e) { /* kein Problem, einfach kein Banner */ }
}
checkBroadcast();

// ── Stimmauswahl ──────────────────────────────────────────────────────────
async function loadVoiceOptions() {
  try {
    const data = await fetch("/api/voice").then(r => r.json());
    const select = document.getElementById("voice-select");
    select.innerHTML = "";
    (data.options || []).forEach(v => {
      const opt = document.createElement("option");
      opt.value = v; opt.textContent = v;
      if (v === data.current) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", async () => {
      try {
        await fetch("/api/voice", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ voice: select.value }),
        });
        addLog("sys", `Stimme auf ${select.value} gestellt — wirkt ab dem nächsten Neuladen der Seite.`);
      } catch (e) {}
    });
  } catch (e) { /* Auswahl bleibt leer, kein Problem */ }
}
loadVoiceOptions();

// ── Erinnerungs-Wecker: prüft regelmäßig auf fällige Erinnerungen ────────
async function checkDueReminders() {
  try {
    const due = await fetch("/api/reminders/due").then(r => r.json());
    if (!Array.isArray(due) || !due.length) return;
    for (const r of due) {
      addLog("ai", `Erinnerung: ${r.text}`);
      if ("Notification" in window) {
        if (Notification.permission === "granted") {
          new Notification("JARVIS — Erinnerung", { body: r.text });
        } else if (Notification.permission !== "denied") {
          Notification.requestPermission();
        }
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "reminder_due", text: r.text }));
      }
      try {
        await fetch("/api/reminders/ack", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: r.id }),
        });
      } catch (e) {}
    }
  } catch (e) { /* kein Problem, nächster Versuch in Kürze */ }
}
checkDueReminders();
setInterval(checkDueReminders, 60000);

// ── Anmeldung: Benutzername anzeigen, Abmelden ──────────────────────────
async function loadUserInfo() {
  try {
    const res = await fetch("/api/auth/me");
    const data = await res.json();
    if (data.ok) {
      document.getElementById("info-username").textContent = data.username;
      document.getElementById("info-userid").textContent = data.user_id;
    }
  } catch (e) { /* egal, zeigt dann einfach "—" */ }
}
loadUserInfo();

document.getElementById("logout-btn").addEventListener("click", async () => {
  try { await fetch("/api/auth/logout", { method: "POST" }); } catch (e) {}
  window.location.href = "/";
});

// ── Log ───────────────────────────────────────────────────────────────
function addLog(tag, text) {
  const log = document.getElementById("log");
  const line = document.createElement("div");
  line.className = "line " + tag;
  const prefix = { you: "Du: ", ai: "JARVIS: ", sys: "SYS: ", err: "ERR: " }[tag] || "";
  line.textContent = prefix + text;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

// ── Drawer (ausfahrendes Panel statt fixer Sidebar) ─────────────────────
const drawer = document.getElementById("drawer");
let drawerOpen = false;

function openDrawer(tab) {
  if (tab) activateTab(tab);
  drawer.classList.add("open");
  drawerOpen = true;
  if (tab === "map") {
    initMap();
    setTimeout(() => { if (map) map.invalidateSize(); }, 350);
  }
}
function closeDrawer() {
  drawer.classList.remove("open");
  drawerOpen = false;
  document.querySelectorAll(".rail-btn").forEach(b => b.classList.remove("active"));
}
function activateTab(name) {
  document.querySelectorAll(".rail-btn").forEach(b => b.classList.toggle("active", b.dataset.tab === name));
  document.querySelectorAll(".tab-page").forEach(p => p.classList.toggle("active", p.id === "page-" + name));
  document.getElementById("drawer-title").textContent = TAB_LABELS[name] || name.toUpperCase();
}

document.querySelectorAll(".rail-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    if (justDragged) return;
    const tab = btn.dataset.tab;
    if (drawerOpen && btn.classList.contains("active")) {
      closeDrawer();
    } else {
      openDrawer(tab);
    }
  });
});
document.getElementById("drawer-close").addEventListener("click", closeDrawer);

// ── Icon-Leiste: per Gedrückt-Halten neu sortieren, Reihenfolge wird gespeichert ──
let justDragged = false;

function attachRailDrag(btn) {
  let holdTimer = null;
  let dragging = false;
  let startY = 0;

  btn.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    startY = e.clientY;
    holdTimer = setTimeout(() => {
      dragging = true;
      btn.classList.add("dragging");
      try { btn.setPointerCapture(e.pointerId); } catch (_) {}
    }, 380);
  });

  btn.addEventListener("pointermove", (e) => {
    if (!dragging) {
      if (holdTimer && Math.abs(e.clientY - startY) > 8) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
      return;
    }
    e.preventDefault();
    const rail = document.getElementById("rail");
    const siblings = [...rail.querySelectorAll(".rail-btn")].filter(b => b !== btn);
    const y = e.clientY;
    for (const sib of siblings) {
      const rect = sib.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      if (y < mid && sib.previousElementSibling !== btn) {
        rail.insertBefore(btn, sib);
        break;
      } else if (y > mid && sib.nextElementSibling !== btn) {
        rail.insertBefore(btn, sib.nextSibling);
        break;
      }
    }
  });

  function endDrag(e) {
    if (holdTimer) { clearTimeout(holdTimer); holdTimer = null; }
    if (dragging) {
      dragging = false;
      btn.classList.remove("dragging");
      try { btn.releasePointerCapture(e.pointerId); } catch (_) {}
      justDragged = true;
      setTimeout(() => { justDragged = false; }, 250);
      saveRailOrder();
    }
  }
  btn.addEventListener("pointerup", endDrag);
  btn.addEventListener("pointercancel", endDrag);
}
document.querySelectorAll(".rail-btn").forEach(attachRailDrag);

async function saveRailOrder() {
  const order = [...document.querySelectorAll("#rail .rail-btn")].map(b => b.dataset.tab);
  try {
    await fetch("/api/rail-order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order }),
    });
  } catch (e) { /* nicht schlimm, klappt beim nächsten Versuch wieder */ }
}

async function loadRailOrder() {
  try {
    const res = await fetch("/api/rail-order");
    const data = await res.json();
    if (!data.order || !data.order.length) return;
    const rail = document.getElementById("rail");
    const byTab = {};
    rail.querySelectorAll(".rail-btn").forEach(b => { byTab[b.dataset.tab] = b; });
    data.order.forEach(tab => { if (byTab[tab]) rail.appendChild(byTab[tab]); });
  } catch (e) { /* erster Start, noch keine gespeicherte Reihenfolge — kein Problem */ }
}
loadRailOrder();

// ── WebSocket ─────────────────────────────────────────────────────────
// ── Standort für automatische Begrüßung (Wetter/News/Börse beim Start) ──
function sendLocationForBriefing() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "location", lat: pos.coords.latitude, lon: pos.coords.longitude,
        }));
      }
    },
    () => { /* Berechtigung verweigert o.ä. — Briefing läuft dann einfach ohne Wetter */ },
    { timeout: 3000, maximumAge: 600000 }
  );
}

function hideBootScreen() {
  const el = document.getElementById("boot-screen");
  if (el) el.classList.add("hidden");
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.binaryType = "arraybuffer";

  ws.onopen = () => {
    document.getElementById("conn-dot").classList.add("live");
    sendLocationForBriefing();
    const statusEl = document.getElementById("boot-status");
    if (statusEl) statusEl.textContent = "Verbinde mit Gemini…";
  };

  ws.onclose = () => {
    document.getElementById("conn-dot").classList.remove("live");
    orbState = "OFFLINE";
    const statusEl = document.getElementById("boot-status");
    if (statusEl) statusEl.textContent = "Verbindung getrennt — versuche erneut…";
    setTimeout(connect, 2000);
  };

  ws.onmessage = (ev) => {
    if (ev.data instanceof ArrayBuffer) {
      playPCM(ev.data);
    } else {
      const msg = JSON.parse(ev.data);
      if (msg.type === "log") {
        addLog(msg.tag, msg.text);
        if (msg.text === "JARVIS online.") hideBootScreen();
      } else if (msg.type === "state") {
        orbState = msg.value;
        const wasSpeaking = speaking;
        speaking = (msg.value === "SPEAKING");
        document.getElementById("info-status").textContent = msg.value;
        if (speaking && !wasSpeaking && pendingNewsItems) {
          if (window.JarvisGlobe) window.JarvisGlobe.show(pendingNewsItems);
          pendingNewsItems = null;
        }
        if (speaking && !wasSpeaking && pendingBrainData) {
          if (window.JarvisBrain) window.JarvisBrain.show(pendingBrainData.skills, pendingBrainData.knowledge);
          pendingBrainData = null;
        }
      } else if (msg.type === "turn_end") {
        speaking = false;
        pendingNewsItems = null; // falls nie konsumiert (z.B. JARVIS hat doch nichts dazu gesagt)
        pendingBrainData = null;
        if (wakeActive) setWakeActive(true); // Gesprächsfenster verlängern, kein erneutes "Jarvis" nötig
        if (window.JarvisGlobe) window.JarvisGlobe.hide();
        if (window.JarvisBrain) window.JarvisBrain.hide();
        hideFilePreviewSoon();
      } else if (msg.type === "route") {
        openDrawer("map"); renderRoute(msg.data);
      } else if (msg.type === "timer") {
        renderTimer(msg.data); openDrawer("timer");
      } else if (msg.type === "weather") {
        renderWeather(msg.data); openDrawer("weather");
      } else if (msg.type === "note") {
        renderNote(msg.data); openDrawer("notes");
      } else if (msg.type === "notes_list") {
        renderNotesList(msg.data); openDrawer("notes");
      } else if (msg.type === "random") {
        renderRandom(msg.data); openDrawer("random");
      } else if (msg.type === "calc") {
        renderCalc(msg.data); openDrawer("calc");
      } else if (msg.type === "file") {
        renderFile(msg.data); openDrawer("files");
      } else if (msg.type === "webpage") {
        renderWebpage(msg.data); openDrawer("web");
      } else if (msg.type === "search") {
        renderSearch(msg.data); openDrawer("web");
      } else if (msg.type === "account_saved") {
        renderAccountSaved(msg.data); openDrawer("vault");
      } else if (msg.type === "account") {
        renderAccount(msg.data); openDrawer("vault");
      } else if (msg.type === "account_deleted") {
        renderAccountDeleted(msg.data); openDrawer("vault");
      } else if (msg.type === "navigate") {
        triggerNavigate(msg.data);
      } else if (msg.type === "spotify") {
        renderSpotify(msg.data); openDrawer("apps");
      } else if (msg.type === "news") {
        if (speaking && window.JarvisGlobe) { window.JarvisGlobe.show(msg.data.items); pendingNewsItems = null; }
        else pendingNewsItems = msg.data.items;
      } else if (msg.type === "open_globe") {
        openGestureGlobe();
      } else if (msg.type === "close_globe") {
        closeGestureGlobe();
      } else if (msg.type === "location_info") {
        renderLocationInfo(msg.data);
      } else if (msg.type === "brain") {
        if (speaking && window.JarvisBrain) { window.JarvisBrain.show(msg.data.skills, msg.data.knowledge); pendingBrainData = null; }
        else pendingBrainData = msg.data;
      } else if (msg.type === "file_preview") {
        showFilePreview(msg.data);
      }
    }
  };
}
connect();

// ── Audio-Wiedergabe ────────────────────────────────────────────────────
let activeAudioSources = [];
let interrupted = false;

function ensurePlayCtx() {
  if (!playCtx) {
    playCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: RECV_RATE });
    playTime = playCtx.currentTime;
  }
  if (playCtx.state === "suspended") playCtx.resume();
}

function playPCM(arrayBuffer) {
  if (interrupted) return; // gerade unterbrochen — nachkommende Audio-Reste der alten Antwort ignorieren
  ensurePlayCtx();
  const int16 = new Int16Array(arrayBuffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768;

  const buf = playCtx.createBuffer(1, float32.length, RECV_RATE);
  buf.copyToChannel(float32, 0);
  const src = playCtx.createBufferSource();
  src.buffer = buf;
  src.connect(playCtx.destination);

  const now = playCtx.currentTime;
  if (playTime < now) playTime = now;
  src.start(playTime);
  playTime += buf.duration;
  activeAudioSources.push(src);
  src.onended = () => {
    activeAudioSources = activeAudioSources.filter(s => s !== src);
  };
}

// ── Unterbrechen: stoppt JARVIS sofort mitten im Sprechen ──────────────────
function stopSpeaking(reason) {
  activeAudioSources.forEach(s => { try { s.stop(); } catch (_) {} });
  activeAudioSources = [];
  if (playCtx) playTime = playCtx.currentTime;
  speaking = false;
  interrupted = true;
  setTimeout(() => { interrupted = false; }, 400); // kurze Sperre gegen nachkommende Audio-Reste
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "abort" }));
  }
  if (reason) addLog("sys", reason);
}

function playChime() {
  ensurePlayCtx();
  const ctx = playCtx;
  [880, 1320].forEach((freq, i) => {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    osc.type = "sine";
    const start = ctx.currentTime + i * 0.18;
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(0.22, start + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.5);
    osc.connect(gain).connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.55);
  });
}

function playTimerAlarm() {
  ensurePlayCtx();
  const ctx = playCtx;
  // Drei kurze, dringlichere Doppel-Beeps (Dreieckswelle statt Sinus)
  for (let burst = 0; burst < 3; burst++) {
    [660, 990].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      osc.type = "triangle";
      const start = ctx.currentTime + burst * 0.42 + i * 0.11;
      gain.gain.setValueAtTime(0, start);
      gain.gain.linearRampToValueAtTime(0.28, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.22);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.25);
    });
  }
}

// ── Mikrofon ───────────────────────────────────────────────────────────
async function startMic() {
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }
    });
  } catch (e) {
    addLog("err", "Mikrofon-Zugriff verweigert.");
    return;
  }

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  ensurePlayCtx();
  const source = audioCtx.createMediaStreamSource(micStream);
  const inRate = audioCtx.sampleRate;

  micNode = audioCtx.createScriptProcessor(4096, 1, 1);
  micNode.onaudioprocess = (e) => {
    if (!ws || ws.readyState !== WebSocket.OPEN || muted || speaking || !wakeActive) return;
    const input = e.inputBuffer.getChannelData(0);
    const down = downsample(input, inRate, SEND_RATE);
    const pcm = floatToInt16(down);
    ws.send(pcm.buffer);
  };
  source.connect(micNode);
  micNode.connect(audioCtx.destination);

  micActive = true;
  document.getElementById("mic-btn").classList.add("active");
  addLog("sys", "Mikrofon aktiv.");
  startWakeWordListener();
}

function stopMic() {
  if (micNode) { micNode.disconnect(); micNode = null; }
  if (micStream) { micStream.getTracks().forEach(t => t.stop()); micStream = null; }
  if (audioCtx) { audioCtx.close(); audioCtx = null; }
  micActive = false;
  document.getElementById("mic-btn").classList.remove("active", "muted");
  stopWakeWordListener();
  setWakeActive(false);
}

// ── Weckwort "Jarvis": JARVIS reagiert nur, wenn der Name fällt ────────────
let wakeActive = false;
let wakeRecognition = null;
let wakeWindowTimer = null;
const WAKE_WORDS = ["jarvis"];
// Browser-Spracherkennung verhört sich bei "Jarvis" gelegentlich phonetisch ähnlich —
// diese Varianten zählen ebenfalls als Weckwort, damit man nicht mehrfach rufen muss.
const WAKE_WORD_VARIANTS = [
  "jarvis", "dscharwis", "dscharvis", "charwis", "charvis", "yarvis",
  "jahwis", "jarvus", "harvis", "sharvis",
];
const WAKE_WINDOW_MS = 14000; // so lange bleibt sie nach dem Weckwort/einer Antwort "wach"

function setWakeActive(on) {
  const wasOff = !wakeActive;
  wakeActive = on;
  document.getElementById("mic-btn").classList.toggle("listening", on);
  if (on) {
    if (wasOff) addLog("sys", "„Jarvis“ gehört — ich höre zu.");
    clearTimeout(wakeWindowTimer);
    wakeWindowTimer = setTimeout(() => setWakeActive(false), WAKE_WINDOW_MS);
  } else {
    clearTimeout(wakeWindowTimer);
  }
}

function startWakeWordListener() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) {
    addLog("sys", "Weckwort-Erkennung wird von diesem Browser nicht unterstützt (am besten Chrome/Edge nutzen) — Mikrofon reagiert vorübergehend auf alles.");
    setWakeActive(true);
    wakeWindowTimer = null; // dauerhaft offen, da keine Erkennung möglich ist
    return;
  }
  wakeRecognition = new SR();
  wakeRecognition.lang = "de-DE";
  wakeRecognition.continuous = true;
  wakeRecognition.interimResults = true;

  // In Chrome/Edge unterstützte Grammatik-Gewichtung: erhöht die Trefferchance
  // fürs Weckwort, ohne die restliche Spracherkennung einzuschränken.
  const SGL = window.SpeechGrammarList || window.webkitSpeechGrammarList;
  if (SGL) {
    try {
      const grammar = "#JSGF V1.0; grammar wake; public <wake> = jarvis;";
      const list = new SGL();
      list.addFromString(grammar, 1);
      wakeRecognition.grammars = list;
    } catch (_) { /* nicht unterstützt — einfach ohne Gewichtung weiterlaufen */ }
  }

  wakeRecognition.onresult = (e) => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const text = e.results[i][0].transcript.toLowerCase();

      const isStopCommand = /\b(hör auf|hoer auf|stopp|stop)\b/.test(text);
      if (isStopCommand) {
        stopSpeaking("Abgebrochen.");
        continue;
      }

      if (WAKE_WORD_VARIANTS.some(w => text.includes(w))) {
        if (speaking) {
          stopSpeaking(); // erneutes "Jarvis" während sie redet: sofort unterbrechen und zuhören
        }
        setWakeActive(true);
      }
    }
  };
  wakeRecognition.onerror = () => { /* z.B. "no-speech", einfach weiter/neu starten */ };
  wakeRecognition.onend = () => {
    if (micActive) {
      try { wakeRecognition.start(); } catch (_) {}
    }
  };
  try { wakeRecognition.start(); } catch (_) {}
}

function stopWakeWordListener() {
  if (wakeRecognition) {
    wakeRecognition.onend = null;
    try { wakeRecognition.stop(); } catch (_) {}
    wakeRecognition = null;
  }
}

function downsample(buffer, inRate, outRate) {
  if (outRate >= inRate) return buffer;
  const ratio = inRate / outRate;
  const newLen = Math.round(buffer.length / ratio);
  const result = new Float32Array(newLen);
  let pos = 0, idx = 0;
  while (idx < newLen) {
    const next = Math.round((idx + 1) * ratio);
    let sum = 0, count = 0;
    for (let i = pos; i < next && i < buffer.length; i++) { sum += buffer[i]; count++; }
    result[idx] = count ? sum / count : 0;
    pos = next; idx++;
  }
  return result;
}

function floatToInt16(float32) {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    let s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return int16;
}

// ── Buttons ─────────────────────────────────────────────────────────────
async function openGestureGlobe() {
  const btn = document.getElementById("gesture-btn");
  if (window.JarvisGestures.isActive()) return;
  btn.classList.add("active");
  const ok = await window.JarvisGestures.start();
  if (ok) {
    document.getElementById("gesture-hint").classList.add("visible");
  } else {
    btn.classList.remove("active");
    addLog("err", "Gesten-Steuerung: Webcam-Zugriff nicht möglich (Berechtigung verweigert oder nicht unterstützt).");
  }
}

function closeGestureGlobe() {
  const btn = document.getElementById("gesture-btn");
  if (!window.JarvisGestures.isActive()) return;
  window.JarvisGestures.stop();
  btn.classList.remove("active");
  document.getElementById("gesture-hint").classList.remove("visible");
  hideLocationInfo();
}

document.getElementById("gesture-btn").addEventListener("click", () => {
  if (window.JarvisGestures.isActive()) {
    closeGestureGlobe();
  } else {
    openGestureGlobe();
  }
});

// ── "Zeigen"-Geste: fragt Infos + Bild zum aktuell anvisierten Ort ab ──
window.JarvisGestures.setPointCallback(() => {
  if (!window.JarvisGlobe || !ws || ws.readyState !== WebSocket.OPEN) return;
  const view = window.JarvisGlobe.getCurrentViewLatLon();
  if (!view) return;
  showLocationLoading();
  ws.send(JSON.stringify({ type: "point_location", lat: view.lat, lon: view.lon }));
});

function showLocationLoading() {
  const panel = document.getElementById("location-info");
  if (!panel) return;
  panel.innerHTML = '<div class="location-loading">Suche Informationen…</div>';
  panel.classList.add("visible");
}

function renderLocationInfo(data) {
  const panel = document.getElementById("location-info");
  if (!panel) return;
  if (!data || !data.ort) {
    panel.innerHTML = '<div class="location-loading">Nichts Bekanntes an dieser Stelle gefunden.</div>';
    setTimeout(hideLocationInfo, 2500);
    return;
  }
  panel.innerHTML = `
    ${data.bild_url ? `<img src="${data.bild_url}" alt="${escapeHtml(data.ort)}">` : ""}
    <div class="location-info-title">${escapeHtml(data.ort)}</div>
    <div class="location-info-text">${escapeHtml(data.text || "")}</div>
  `;
  panel.classList.add("visible");
}

function hideLocationInfo() {
  const panel = document.getElementById("location-info");
  if (panel) panel.classList.remove("visible");
}

document.getElementById("mic-btn").addEventListener("click", () => {
  if (!micActive) {
    startMic();
  } else {
    muted = !muted;
    const btn = document.getElementById("mic-btn");
    btn.classList.toggle("muted", muted);
    btn.classList.toggle("active", !muted);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "mute", value: muted }));
    }
  }
});

function sendText() {
  const input = document.getElementById("input");
  const txt = input.value.trim();
  if (!txt) return;
  input.value = "";
  ensurePlayCtx();
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "text", content: txt }));
  }
}
document.getElementById("send-btn").addEventListener("click", sendText);
document.getElementById("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendText();
});

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ── Routen-Anzeige (rendert ins KARTE-Panel) ──────────────────────────────
let lastRoutes = [];

function renderRoute(data) {
  const panel = document.getElementById("map-result");
  panel.innerHTML = "";
  lastRoutes = [];

  if (!data || !data.options || !data.options.length) {
    panel.innerHTML = '<div class="empty-hint">Keine Verbindung gefunden.</div>';
    return;
  }

  const header = document.createElement("div");
  header.className = "panel-header";
  header.textContent = data.von + "  →  " + data.nach;
  panel.appendChild(header);

  data.options.forEach((opt, i) => {
    const card = document.createElement("div");
    card.className = "card" + (i === 0 ? " best" : "");

    const top = document.createElement("div");
    top.className = "route-top";
    top.innerHTML =
      `<div class="route-times">${opt.abfahrt}<span class="sep">→</span>${opt.ankunft}</div>` +
      `<div class="route-meta">${opt.dauer_min} Min · ${opt.umstiege} Umstieg${opt.umstiege === 1 ? "" : "e"}</div>`;
    card.appendChild(top);

    const leave = document.createElement("div");
    leave.className = "route-leave";
    card.appendChild(leave);

    const line = document.createElement("div");
    line.className = "route-line";
    opt.legs.forEach((leg, li) => {
      const startStop = document.createElement("div");
      startStop.className = "route-stop" + (li === 0 ? " first" : "");
      startStop.innerHTML =
        `<span class="stop-time">${leg.ab}</span><span class="stop-name">${leg.von}</span>` +
        `<span class="route-leg-line">${leg.linie}</span>`;
      line.appendChild(startStop);

      if (li === opt.legs.length - 1) {
        const endStop = document.createElement("div");
        endStop.className = "route-stop last";
        endStop.innerHTML = `<span class="stop-time">${leg.an}</span><span class="stop-name">${leg.nach}</span>`;
        line.appendChild(endStop);
      }
    });
    card.appendChild(line);
    panel.appendChild(card);

    const depDate = new Date();
    depDate.setMinutes(depDate.getMinutes() + opt.abfahrt_in_min, 0, 0);
    lastRoutes.push({ depDate, el: leave });
  });

  updateRouteCountdowns();
}

function updateRouteCountdowns() {
  const now = new Date();
  lastRoutes.forEach(({ depDate, el }) => {
    const diffMin = Math.round((depDate - now) / 60000);
    el.classList.toggle("soon", diffMin <= 10);
    if (diffMin < 0) el.textContent = "Bereits abgefahren";
    else if (diffMin === 0) el.textContent = "Jetzt losgehen!";
    else el.textContent = "Losgehen in " + diffMin + " Min";
  });
}
setInterval(updateRouteCountdowns, 15000);

// ── Timer-Anzeige (Animation unverändert) ─────────────────────────────────
let timerInterval = null;

function renderTimer(data) {
  if (timerInterval) clearInterval(timerInterval);

  const panel = document.getElementById("timer-panel");
  const total = data.sekunden;
  let remaining = total;
  const R = 86;
  const circumference = 2 * Math.PI * R;

  panel.innerHTML = `
    <div class="timer-ring-wrap" id="timer-ring">
      <svg viewBox="0 0 200 200">
        <circle class="timer-ring-bg" cx="100" cy="100" r="${R}"></circle>
        <circle class="timer-ring-fg" id="timer-fg" cx="100" cy="100" r="${R}"
          stroke-dasharray="${circumference}" stroke-dashoffset="0"></circle>
      </svg>
      <div class="timer-center">
        <div class="timer-time" id="timer-time">--:--</div>
        <div class="timer-label">${escapeHtml(data.label)}</div>
      </div>
    </div>
    <button class="timer-cancel" id="timer-cancel">Abbrechen</button>
  `;

  const ring = document.getElementById("timer-ring");
  const fg = document.getElementById("timer-fg");
  const timeEl = document.getElementById("timer-time");

  function paint() {
    const mm = Math.floor(Math.max(remaining, 0) / 60);
    const ss = Math.max(remaining, 0) % 60;
    timeEl.textContent = String(mm).padStart(2, "0") + ":" + String(ss).padStart(2, "0");
    const frac = Math.max(remaining, 0) / total;
    fg.setAttribute("stroke-dashoffset", String(circumference * (1 - frac)));
  }
  paint();

  timerInterval = setInterval(() => {
    remaining--;
    if (remaining <= 0) {
      remaining = 0;
      paint();
      clearInterval(timerInterval);
      timerInterval = null;
      ring.classList.add("done");
      timeEl.textContent = "FERTIG";
      playTimerAlarm();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "timer_done", label: data.label }));
      }
      if ("Notification" in window) {
        if (Notification.permission === "granted") {
          new Notification("JARVIS Timer", { body: data.label + " ist abgelaufen." });
        } else if (Notification.permission !== "denied") {
          Notification.requestPermission();
        }
      }
      return;
    }
    paint();
  }, 1000);

  document.getElementById("timer-cancel").addEventListener("click", () => {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    panel.innerHTML = '<div class="empty-hint">Sag z.B. "Stell einen Timer auf 5 Minuten"</div>';
  });
}

// ── Wetter-Anzeige ───────────────────────────────────────────────────────
function weatherIconSvg(code) {
  if (code === 0 || code === 1) return sunIcon();
  if (code === 2 || code === 3) return cloudIcon();
  if ([45, 48].includes(code)) return fogIcon();
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return rainIcon();
  if ([71, 73, 75].includes(code)) return snowIcon();
  if ([95, 96, 99].includes(code)) return stormIcon();
  return cloudIcon();
}
function sunIcon() {
  return `<svg class="weather-icon" viewBox="0 0 100 100" fill="none" stroke="url(#goldGrad)" stroke-width="3.5" stroke-linecap="round">
    <circle cx="50" cy="50" r="20"/>
    <g>${[0,45,90,135,180,225,270,315].map(a=>`<line x1="50" y1="14" x2="50" y2="4" transform="rotate(${a} 50 50)"/>`).join("")}</g>
  </svg>`;
}
function cloudIcon() {
  return `<svg class="weather-icon" viewBox="0 0 100 100" fill="none" stroke="url(#goldGrad)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M30 65a16 16 0 1 1 3-31 20 20 0 0 1 38 9 14 14 0 0 1-3 22H30z"/>
  </svg>`;
}
function fogIcon() {
  return `<svg class="weather-icon" viewBox="0 0 100 100" fill="none" stroke="url(#goldGrad)" stroke-width="3.5" stroke-linecap="round">
    <line x1="20" y1="40" x2="80" y2="40"/><line x1="20" y1="55" x2="80" y2="55"/><line x1="20" y1="70" x2="80" y2="70"/>
  </svg>`;
}
function rainIcon() {
  return `<svg class="weather-icon" viewBox="0 0 100 100" fill="none" stroke="url(#goldGrad)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M30 55a16 16 0 1 1 3-31 20 20 0 0 1 38 9 14 14 0 0 1-3 22H30z"/>
    <line x1="38" y1="68" x2="34" y2="80"/><line x1="52" y1="68" x2="48" y2="82"/><line x1="66" y1="68" x2="62" y2="80"/>
  </svg>`;
}
function snowIcon() {
  return `<svg class="weather-icon" viewBox="0 0 100 100" fill="none" stroke="url(#goldGrad)" stroke-width="3.5" stroke-linecap="round">
    <path d="M30 55a16 16 0 1 1 3-31 20 20 0 0 1 38 9 14 14 0 0 1-3 22H30z"/>
    <circle cx="38" cy="78" r="1.8" fill="url(#goldGrad)" stroke="none"/>
    <circle cx="52" cy="82" r="1.8" fill="url(#goldGrad)" stroke="none"/>
    <circle cx="66" cy="78" r="1.8" fill="url(#goldGrad)" stroke="none"/>
  </svg>`;
}
function stormIcon() {
  return `<svg class="weather-icon" viewBox="0 0 100 100" fill="none" stroke="url(#goldGrad)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M30 50a16 16 0 1 1 3-31 20 20 0 0 1 38 9 14 14 0 0 1-3 22H30z"/>
    <polyline points="52,62 44,78 54,78 46,90"/>
  </svg>`;
}

function renderWeather(data) {
  const panel = document.getElementById("weather-panel");
  panel.innerHTML = `
    <div class="weather-card">
      ${weatherIconSvg(data.code)}
      <div class="weather-temp">${data.temperatur}°</div>
      <div class="weather-place">${escapeHtml(data.ort)}</div>
      <div class="weather-state">${escapeHtml(data.zustand)}</div>
      <div class="weather-meta">
        <div><b>${data.wind} km/h</b>Wind</div>
        <div><b>${data.feuchte}%</b>Feuchte</div>
      </div>
    </div>
  `;
}

// ── Notizen-Anzeige (DB-gestützt, bleibt über Neustarts erhalten) ────────
function renderNote(data) {
  const panel = document.getElementById("notes-panel");
  if (panel.querySelector(".empty-hint")) panel.innerHTML = "";
  const card = document.createElement("div");
  card.className = "note-card";
  card.innerHTML = `<div class="note-text">${escapeHtml(data.text)}</div><div class="note-time">${data.zeit} Uhr</div>`;
  panel.prepend(card);
}

function renderNotesList(notes) {
  const panel = document.getElementById("notes-panel");
  if (!notes || !notes.length) {
    panel.innerHTML = '<div class="empty-hint">Sag "Notier dir: ..." und JARVIS merkt es sich hier dauerhaft.</div>';
    return;
  }
  panel.innerHTML = "";
  notes.forEach(n => {
    const card = document.createElement("div");
    card.className = "note-card";
    card.innerHTML = `<div class="note-text">${escapeHtml(n.text)}</div><div class="note-time">${n.zeit} Uhr</div>`;
    panel.appendChild(card);
  });
}

// ── Zufalls-Anzeige ──────────────────────────────────────────────────────
function renderRandom(data) {
  const panel = document.getElementById("random-panel");
  let visual = "";
  if (data.modus === "wuerfel") {
    visual = `<div class="random-die">${data.ergebnis}</div>`;
  } else if (data.modus === "auswahl") {
    visual = `<div class="random-coin">${escapeHtml(data.ergebnis).slice(0, 3).toUpperCase()}</div>`;
  } else {
    visual = `<div class="random-coin">${data.ergebnis === "Kopf" ? "K" : "Z"}</div>`;
  }
  panel.innerHTML = `
    <div class="random-result">
      ${visual}
      <div class="random-label">${escapeHtml(data.ergebnis)}</div>
      ${data.optionen && data.optionen.length ? `<div class="random-sub">aus: ${data.optionen.map(escapeHtml).join(", ")}</div>` : ""}
    </div>
  `;
}

// ── Rechner-Anzeige ──────────────────────────────────────────────────────
function renderCalc(data) {
  const panel = document.getElementById("calc-panel");
  panel.innerHTML = `
    <div class="calc-expr">${escapeHtml(data.ausdruck)}</div>
    <div class="calc-result">= ${escapeHtml(data.ergebnis)}</div>
  `;
}

// ── Dateien-Anzeige ──────────────────────────────────────────────────────
function renderFile(data) {
  const panel = document.getElementById("files-panel");
  if (panel.querySelector(".empty-hint")) panel.innerHTML = "";
  const card = document.createElement("a");
  card.className = "note-card file-card";
  card.href = data.url;
  card.target = "_blank";
  card.download = data.dateiname;
  const kb = (data.groesse / 1024).toFixed(1);
  if (data.ist_bild) {
    card.innerHTML = `
      <img src="${data.url}" alt="${escapeHtml(data.beschreibung || data.dateiname)}" class="file-thumb">
      <div class="note-text">${escapeHtml(data.beschreibung || data.dateiname)}</div>
      <div class="note-time">${kb} KB · Herunterladen ↓</div>
    `;
  } else {
    card.innerHTML = `<div class="note-text">${escapeHtml(data.dateiname)}</div><div class="note-time">${kb} KB · Herunterladen ↓</div>`;
  }
  panel.prepend(card);
}

// ── Web-Anzeige (Seiteninhalt & Suchergebnisse) ───────────────────────────
function renderWebpage(data) {
  const panel = document.getElementById("web-panel");
  panel.innerHTML = `
    <div class="panel-header">${escapeHtml(data.url)}</div>
    <div class="card">
      <div class="web-title">${escapeHtml(data.titel)}</div>
      <div class="web-meta">${data.laenge.toLocaleString("de-DE")} Zeichen gelesen</div>
      <div class="web-text">${escapeHtml(data.text.slice(0, 1200))}${data.text.length > 1200 ? "…" : ""}</div>
    </div>
  `;
}

function renderSearch(data) {
  const panel = document.getElementById("web-panel");
  panel.innerHTML = `<div class="panel-header">Suche: ${escapeHtml(data.anfrage)}</div>`;
  data.ergebnisse.forEach((r, i) => {
    const card = document.createElement("a");
    card.className = "card search-result";
    card.style.animationDelay = (i * 0.07) + "s";
    card.href = r.url; card.target = "_blank"; card.rel = "noopener";
    card.innerHTML = `<div class="web-title">${escapeHtml(r.titel)}</div><div class="web-meta">${escapeHtml(r.url)}</div>`;
    panel.appendChild(card);
  });
}

// ── Konten-Tresor-Anzeige ────────────────────────────────────────────────
function renderAccountSaved(data) {
  const panel = document.getElementById("vault-panel");
  if (panel.querySelector(".empty-hint")) panel.innerHTML = "";
  const card = document.createElement("div");
  card.className = "card vault-card";
  card.innerHTML = `<div class="web-title">${escapeHtml(data.dienst)}</div><div class="web-meta">Gespeichert/aktualisiert · verschlüsselt</div>`;
  panel.prepend(card);
}

function renderAccount(data) {
  const panel = document.getElementById("vault-panel");
  if (panel.querySelector(".empty-hint")) panel.innerHTML = "";
  const card = document.createElement("div");
  card.className = "card vault-card";
  if (data.nicht_gefunden) {
    card.innerHTML = `<div class="web-title">${escapeHtml(data.dienst)}</div><div class="web-meta">Kein Konto gefunden</div>`;
  } else {
    let inner = `<div class="web-title">${escapeHtml(data.dienst)}</div>`;
    if (data.email) inner += `<div class="vault-email">${escapeHtml(data.email)}</div>`;
    if (data.passwort) {
      inner += `<div class="vault-secret" data-pw="${escapeHtml(data.passwort)}">•••••••••••</div>
                 <div class="web-meta vault-hint">Antippen zum Anzeigen</div>`;
    }
    card.innerHTML = inner;
    const secret = card.querySelector(".vault-secret");
    if (secret) {
      secret.addEventListener("click", () => {
        const revealed = secret.textContent !== secret.dataset.pw;
        secret.textContent = revealed ? secret.dataset.pw : "•••••••••••";
      });
    }
  }
  panel.prepend(card);
}

function renderAccountDeleted(data) {
  const panel = document.getElementById("vault-panel");
  if (panel.querySelector(".empty-hint")) panel.innerHTML = "";
  const card = document.createElement("div");
  card.className = "card vault-card deleted";
  card.innerHTML = `<div class="web-title">${escapeHtml(data.dienst)}</div><div class="web-meta">${data.count ? "Gelöscht" : "Nicht gefunden"}</div>`;
  panel.prepend(card);
}

// ── Orb-Animation (Cyan-HUD-Sphäre) ──────────────────────────
const canvas = document.getElementById("orb");
const ctx = canvas.getContext("2d");
let tick = 0, scan = 0, halo = 55, scale = 1, tgtScale = 1, tgtHalo = 55, lastT = 0, blink = true, blinkTick = 0;

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  const r = canvas.parentElement.getBoundingClientRect();
  canvas.width = r.width * dpr;
  canvas.height = r.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
window.addEventListener("resize", resizeCanvas);
setTimeout(resizeCanvas, 50);

function drawOrb() {
  tick++;
  const now = performance.now();
  if (now - lastT > (speaking ? 120 : 500)) {
    if (speaking) { tgtScale = 1.06 + Math.random() * 0.08; tgtHalo = 150 + Math.random() * 50; }
    else if (muted) { tgtScale = 1.0; tgtHalo = 16 + Math.random() * 8; }
    else { tgtScale = 1.0 + Math.random() * 0.01; tgtHalo = 50 + Math.random() * 22; }
    lastT = now;
  }
  const sp = speaking ? 0.38 : 0.15;
  scale += (tgtScale - scale) * sp;
  halo += (tgtHalo - halo) * sp;
  scan = (scan + (speaking ? 2.6 : 1.0)) % 360;
  blinkTick++; if (blinkTick >= 40) { blink = !blink; blinkTick = 0; }

  const r = canvas.getBoundingClientRect();
  const W = r.width, H = r.height;
  const cx = W / 2, cy = H / 2;
  const fw = Math.min(W, H) * 0.75;

  ctx.clearRect(0, 0, W, H);

  const ringR = fw * 0.40;
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(70,225,255,0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, ringR * 0.86, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(70,225,255,0.07)";
  ctx.stroke();

  const arcAlpha = Math.max(0, Math.min(0.85, halo / 255 * 1.7));
  const grad1 = ctx.createLinearGradient(cx - ringR, cy, cx + ringR, cy);
  grad1.addColorStop(0, `rgba(143,239,255,${arcAlpha})`);
  grad1.addColorStop(1, `rgba(70,225,255,${arcAlpha})`);
  ctx.beginPath();
  ctx.arc(cx, cy, ringR, (scan * Math.PI / 180), (scan + 70) * Math.PI / 180);
  ctx.strokeStyle = muted ? `rgba(122,118,110,${arcAlpha})` : grad1;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(cx, cy, ringR * 0.86, (-scan * 1.4 * Math.PI / 180), (-scan * 1.4 + 40) * Math.PI / 180);
  ctx.strokeStyle = `rgba(232,178,76,${arcAlpha * 0.5})`;
  ctx.lineWidth = 1.4;
  ctx.stroke();

  const orbR = fw * 0.25 * scale;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, orbR);
  if (muted) {
    grad.addColorStop(0, "rgba(122,118,110,0.45)");
    grad.addColorStop(0.6, "rgba(122,118,110,0.14)");
    grad.addColorStop(1, "rgba(122,118,110,0)");
  } else {
    grad.addColorStop(0, "rgba(143,239,255,0.55)");
    grad.addColorStop(0.55, "rgba(70,225,255,0.22)");
    grad.addColorStop(1, "rgba(70,225,255,0)");
  }
  ctx.beginPath();
  ctx.arc(cx, cy, orbR, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.fillStyle = muted ? "rgba(228,247,251,0.55)" : "rgba(4,10,14,0.92)";
  ctx.font = "300 " + Math.round(fw * 0.05) + "px 'Helvetica Neue', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.save();
  ctx.letterSpacing = Math.round(fw * 0.012) + "px";
  ctx.fillText("JARVIS", cx, cy);
  ctx.restore();

  let txt = muted ? "STUMM" : (speaking ? "SPRICHT" : orbState);
  const dot = (blink || speaking) ? "●" : "○";
  ctx.fillStyle = "rgba(70,225,255,0.9)";
  ctx.font = "600 " + Math.round(fw * 0.024) + "px 'Helvetica Neue', sans-serif";
  ctx.fillText(dot + "  " + txt, cx, cy + fw * 0.36);

  requestAnimationFrame(drawOrb);
}
requestAnimationFrame(drawOrb);

// ── Karte: GPS, Zielsuche, Verkehrsmittel, Routing (kein API-Key) ─────────
let map = null, userMarker = null, routeLayer = null, userPos = null;
let activeMode = "bus";

function initMap() {
  if (map || typeof L === "undefined") return;
  map = L.map("map", { zoomControl: false }).setView([51.5136, 7.4653], 13);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: "© OpenStreetMap"
  }).addTo(map);
  locateUser();
}

function locateUser() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userPos = { lat: pos.coords.latitude, lon: pos.coords.longitude };
      if (!map) return;
      if (userMarker) map.removeLayer(userMarker);
      userMarker = L.circleMarker([userPos.lat, userPos.lon], {
        radius: 8, color: "#46e1ff", fillColor: "#8fefff", fillOpacity: 0.9, weight: 2,
      }).addTo(map);
      map.setView([userPos.lat, userPos.lon], 14);
    },
    () => addLog("err", "Standort-Zugriff verweigert — bitte im Browser erlauben."),
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    activeMode = btn.dataset.mode;
  });
});

document.getElementById("map-go").addEventListener("click", findMapRoute);
document.getElementById("map-dest").addEventListener("keydown", (e) => {
  if (e.key === "Enter") findMapRoute();
});

async function findMapRoute() {
  const von = document.getElementById("map-von").value.trim();
  const dest = document.getElementById("map-dest").value.trim();
  const resultEl = document.getElementById("map-result");
  if (!dest) return;

  resultEl.innerHTML = '<div class="empty-hint">Suche Route…</div>';

  // Startpunkt bestimmen: explizites "Von"-Feld hat Vorrang vor GPS
  let fromCoords = null;
  if (von) {
    const geoFrom = await fetch(`/api/geocode?q=${encodeURIComponent(von)}`).then(r => r.json()).catch(() => null);
    if (!geoFrom || geoFrom.error) {
      resultEl.innerHTML = `<div class="empty-hint">${escapeHtml((geoFrom && geoFrom.error) || "Startort nicht gefunden.")}</div>`;
      return;
    }
    fromCoords = { lat: geoFrom.lat, lon: geoFrom.lon };
  } else {
    if (!userPos) {
      resultEl.innerHTML = '<div class="empty-hint">Warte auf Standort… bitte GPS-Zugriff erlauben (am PC ungenau, dann lieber "Von" eintragen) und nochmal versuchen.</div>';
      locateUser();
      return;
    }
    fromCoords = userPos;
  }

  if (activeMode === "bus") {
    try {
      const url = von
        ? `/api/transit_text?von=${encodeURIComponent(von)}&nach=${encodeURIComponent(dest)}`
        : `/api/transit?from_lat=${fromCoords.lat}&from_lon=${fromCoords.lon}&nach=${encodeURIComponent(dest)}`;
      const data = await fetch(url).then(r => r.json());
      if (data.error || !data.options || !data.options.length) {
        resultEl.innerHTML = `<div class="empty-hint">${escapeHtml(data.error || "Keine Verbindung gefunden.")}</div>`;
        return;
      }
      renderRoute(data);
    } catch (e) {
      resultEl.innerHTML = '<div class="empty-hint">Verbindungssuche gerade nicht erreichbar.</div>';
    }
    return;
  }

  try {
    const geo = await fetch(`/api/geocode?q=${encodeURIComponent(dest)}`).then(r => r.json());
    if (geo.error) {
      resultEl.innerHTML = `<div class="empty-hint">${escapeHtml(geo.error)}</div>`;
      return;
    }
    const route = await fetch(
      `/api/route?from_lat=${fromCoords.lat}&from_lon=${fromCoords.lon}&to_lat=${geo.lat}&to_lon=${geo.lon}&mode=${activeMode}`
    ).then(r => r.json());
    if (route.error) {
      resultEl.innerHTML = `<div class="empty-hint">${escapeHtml(route.error)}</div>`;
      return;
    }

    if (routeLayer) map.removeLayer(routeLayer);
    const latlngs = route.geometry.map(([lon, lat]) => [lat, lon]);
    routeLayer = L.polyline(latlngs, { color: "#46e1ff", weight: 5, opacity: 0.9 }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [24, 24] });
    L.circleMarker([geo.lat, geo.lon], { radius: 7, color: "#8fefff", fillColor: "#8fefff", fillOpacity: 0.95 }).addTo(map);

    const arriveAt = new Date(Date.now() + route.dauer_min * 60000);
    const arriveStr = arriveAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    resultEl.innerHTML = `
      <div class="map-eta">
        <div><b>${route.dauer_min} min</b><span>Dauer</span></div>
        <div><b>${route.distanz_km} km</b><span>Distanz</span></div>
        <div><b>${arriveStr}</b><span>Ankunft ca.</span></div>
      </div>
    `;
  } catch (e) {
    resultEl.innerHTML = '<div class="empty-hint">Routendienst gerade nicht erreichbar.</div>';
  }
}

// ── Sprachgesteuerte Navigation (z.B. "bring mich nach Hause") ──────────
function triggerNavigate(data) {
  openDrawer("map");
  document.getElementById("map-von").value = ""; // eigener Standort per GPS
  document.getElementById("map-dest").value = data.adresse || "";

  const modus = data.modus || "auto";
  document.querySelectorAll(".mode-btn").forEach(b => {
    const isMatch = b.dataset.mode === modus;
    b.classList.toggle("active", isMatch);
    if (isMatch) activeMode = modus;
  });

  findMapRoute();
}

// ── Apps-Tab: Spotify-Player ─────────────────────────────────────────────
function renderSpotify(data) {
  const holder = document.getElementById("spotify-player-holder");
  if (!holder) return;
  holder.innerHTML = `
    <iframe src="${data.embed_url}" width="100%" height="152" style="border-radius:14px;"
      frameborder="0" allowfullscreen allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>
    <div class="spotify-track-label">${escapeHtml(data.name)} — ${escapeHtml(data.artist)}</div>
  `;
}

const spotifySearchForm = document.getElementById("spotify-search-form");
if (spotifySearchForm) {
  spotifySearchForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("spotify-search-input");
    const query = input.value.trim();
    if (!query || !ws || ws.readyState !== WebSocket.OPEN) return;
    // Läuft über denselben Kanal wie Text-Chat, mit Weckwort, damit Gemini
    // das Werkzeug musik_abspielen zuverlässig aufruft.
    ws.send(JSON.stringify({ type: "text", content: `Jarvis, spiel ${query}` }));
    input.value = "";
  });
}

// ── Spotify: eigenes Konto verknüpfen/lösen ──────────────────────────────
async function refreshSpotifyLinkStatus() {
  const statusEl = document.getElementById("spotify-link-status");
  const linkBtn = document.getElementById("spotify-link-btn");
  const unlinkBtn = document.getElementById("spotify-unlink-btn");
  if (!statusEl) return;
  try {
    const res = await fetch("/api/spotify/status");
    const data = await res.json();
    if (data.linked) {
      statusEl.textContent = data.spotify_user ? `✅ Verknüpft als ${data.spotify_user}` : "✅ Verknüpft";
      statusEl.classList.add("connected");
      linkBtn.style.display = "none";
      unlinkBtn.style.display = "block";
    } else {
      statusEl.textContent = "Nicht verknüpft (nur Vorschau verfügbar)";
      statusEl.classList.remove("connected");
      linkBtn.style.display = "block";
      unlinkBtn.style.display = "none";
    }
  } catch (e) {
    statusEl.textContent = "Status unbekannt";
  }
}

const spotifyUnlinkBtn = document.getElementById("spotify-unlink-btn");
if (spotifyUnlinkBtn) {
  spotifyUnlinkBtn.addEventListener("click", async () => {
    await fetch("/api/spotify/unlink", { method: "POST" });
    refreshSpotifyLinkStatus();
  });
}

refreshSpotifyLinkStatus();
// Nach Rückkehr vom Spotify-Login (URL-Parameter ?spotify=ok/error) Status sofort aktualisieren
if (location.search.includes("spotify=")) {
  refreshSpotifyLinkStatus();
  window.history.replaceState({}, "", location.pathname);
}

// ── Holografische Datei-Vorschau beim Speichern von TXT-Dateien ─────────
let filePreviewHideTimer = null;

function showFilePreview(data) {
  const panel = document.getElementById("file-preview");
  if (!panel) return;
  if (filePreviewHideTimer) { clearTimeout(filePreviewHideTimer); filePreviewHideTimer = null; }
  document.getElementById("file-preview-title").textContent = data.dateiname || "DATEI";
  document.getElementById("file-preview-body").textContent = data.inhalt || "";
  document.getElementById("file-preview-footer").textContent = "GESPEICHERT ✓ — DATEIEN-TAB";
  panel.classList.add("visible");
}

function hideFilePreviewSoon() {
  const panel = document.getElementById("file-preview");
  if (!panel || !panel.classList.contains("visible")) return;
  // kurz stehen lassen, damit man nach dem Sprechen noch einen Moment draufschauen kann
  filePreviewHideTimer = setTimeout(() => panel.classList.remove("visible"), 3000);
}
