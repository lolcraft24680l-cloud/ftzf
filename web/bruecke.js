/* ══════════════════════════════════════════════════════════════════════
   bruecke.js — ersetzt den Python-Server.

   AURA spricht hier direkt mit Gemini Live. Die Klasse verhält sich nach
   außen wie der alte WebSocket zum eigenen Server, damit app.js
   unverändert bleiben kann: gleiche Nachrichtentypen, gleiches Audio.

   Werkzeuge laufen im Browser und speichern über lokal.js auf dem Gerät.
   ══════════════════════════════════════════════════════════════════════ */

(() => {
  "use strict";

  const MODELL = "models/gemini-2.5-flash-native-audio-preview-12-2025";
  const ERSATZMODELLE = [
    "models/gemini-2.5-flash-native-audio-preview-12-2025",
    "models/gemini-2.0-flash-live-001",
    "models/gemini-2.0-flash-exp"
  ];
  const LIVE_URL = "wss://generativelanguage.googleapis.com/ws/"
                 + "google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

  const DB = window.AuraDB;
  const echtesFetch = window.AuraFetch || window.fetch.bind(window);

  // ── Schlüssel ───────────────────────────────────────────────────────
  function schlüssel() { return localStorage.getItem("aura.key") || ""; }
  window.AuraSchlüsselSetzen = (k) => localStorage.setItem("aura.key", (k || "").trim());

  // ── Base64 ↔ Bytes ──────────────────────────────────────────────────
  function zuBase64(puffer) {
    const bytes = new Uint8Array(puffer);
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) {
      text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(text);
  }
  function ausBase64(text) {
    const roh = atob(text);
    const bytes = new Uint8Array(roh.length);
    for (let i = 0; i < roh.length; i++) bytes[i] = roh.charCodeAt(i);
    return bytes.buffer;
  }

  // ══════════════════════════════════════════════════════════════════
  //  Die Werkzeuge
  // ══════════════════════════════════════════════════════════════════

  const WERKZEUGE = [
    { name: "wetter_abfragen", description: "Aktuelles Wetter an einem Ort.",
      parameters: { type: "OBJECT", properties: {
        ort: { type: "STRING", description: "Ortsname." } }, required: ["ort"] } },

    { name: "nachrichten_abrufen", description: "Aktuelle Schlagzeilen der Tagesschau.",
      parameters: { type: "OBJECT", properties: {
        anzahl: { type: "NUMBER", description: "1 bis 8." } } } },

    { name: "websuche", description: "Sucht im Netz nach einem Begriff.",
      parameters: { type: "OBJECT", properties: {
        suchbegriff: { type: "STRING" } }, required: ["suchbegriff"] } },

    { name: "webseite_lesen", description: "Liest den Text einer konkreten Internetseite.",
      parameters: { type: "OBJECT", properties: {
        url: { type: "STRING" } }, required: ["url"] } },

    { name: "rechnen", description: "Rechnet einen Ausdruck exakt aus.",
      parameters: { type: "OBJECT", properties: {
        ausdruck: { type: "STRING" } }, required: ["ausdruck"] } },

    { name: "zufallsentscheidung", description: "Münzwurf, Würfel oder Auswahl.",
      parameters: { type: "OBJECT", properties: {
        art: { type: "STRING", description: "muenze, wuerfel oder auswahl" },
        optionen: { type: "STRING", description: "Bei Auswahl: mit Komma getrennt." } } } },

    { name: "timer_stellen", description: "Stellt einen Timer. Zeit immer in Sekunden.",
      parameters: { type: "OBJECT", properties: {
        sekunden: { type: "NUMBER" },
        bezeichnung: { type: "STRING" } }, required: ["sekunden"] } },

    { name: "erinnerung_stellen", description: "Erinnerung zu einem Zeitpunkt.",
      parameters: { type: "OBJECT", properties: {
        text: { type: "STRING" },
        sekunden: { type: "NUMBER", description: "In wie vielen Sekunden." } },
        required: ["text", "sekunden"] } },

    { name: "notiz_speichern", description: "Speichert eine Notiz dauerhaft.",
      parameters: { type: "OBJECT", properties: {
        text: { type: "STRING" } }, required: ["text"] } },

    { name: "notizen_abrufen", description: "Gibt alle Notizen zurück.",
      parameters: { type: "OBJECT", properties: {} } },

    { name: "notizen_loeschen", description: "Löscht alle Notizen.",
      parameters: { type: "OBJECT", properties: {} } },

    { name: "wichtiges_merken",
      description: "Merkt sich dauerhaft etwas über den Nutzer: Name, Hobby, Ereignis, Vorliebe.",
      parameters: { type: "OBJECT", properties: {
        kategorie: { type: "STRING", description: "name, hobby, ereignis, vorliebe, sonstiges" },
        inhalt: { type: "STRING" } }, required: ["inhalt"] } },

    { name: "gehirn_anzeigen", description: "Zeigt, was über den Nutzer gespeichert ist.",
      parameters: { type: "OBJECT", properties: {} } },

    { name: "konto_speichern", description: "Legt einen Zugang ab oder ändert ihn.",
      parameters: { type: "OBJECT", properties: {
        dienst: { type: "STRING" }, email: { type: "STRING" },
        passwort: { type: "STRING" } }, required: ["dienst"] } },

    { name: "konto_abrufen", description: "Gibt einen gespeicherten Zugang zurück.",
      parameters: { type: "OBJECT", properties: {
        dienst: { type: "STRING" } }, required: ["dienst"] } },

    { name: "konto_loeschen", description: "Löscht einen gespeicherten Zugang.",
      parameters: { type: "OBJECT", properties: {
        dienst: { type: "STRING" } }, required: ["dienst"] } },

    { name: "standort_speichern", description: "Merkt sich einen Ort unter einem Namen.",
      parameters: { type: "OBJECT", properties: {
        name: { type: "STRING" }, adresse: { type: "STRING" } },
        required: ["name", "adresse"] } },

    { name: "standorte_abrufen", description: "Alle gemerkten Orte.",
      parameters: { type: "OBJECT", properties: {} } },

    { name: "standort_loeschen", description: "Löscht einen gemerkten Ort.",
      parameters: { type: "OBJECT", properties: {
        name: { type: "STRING" } }, required: ["name"] } },

    { name: "navigiere_zu", description: "Öffnet die Karte mit einer Route zum Ziel.",
      parameters: { type: "OBJECT", properties: {
        ziel: { type: "STRING" } }, required: ["ziel"] } },

    { name: "finde_verbindung", description: "Bus- und Bahnverbindung zwischen zwei Orten.",
      parameters: { type: "OBJECT", properties: {
        von: { type: "STRING" }, nach: { type: "STRING" },
        abfahrt: { type: "STRING" }, ankunft: { type: "STRING" } },
        required: ["von", "nach"] } },

    { name: "weltkarte_oeffnen", description: "Öffnet die Weltkugel.",
      parameters: { type: "OBJECT", properties: {
        ort: { type: "STRING" } } } },

    { name: "weltkarte_schliessen", description: "Schließt die Weltkugel.",
      parameters: { type: "OBJECT", properties: {} } },

    { name: "admin_oeffnen",
      description: "Öffnet die Admin-Seite mit Statistiken, wenn der Nutzer nach Stats, "
                 + "Statistik, Verwaltung oder der Admin-Seite fragt.",
      parameters: { type: "OBJECT", properties: {} } },

    { name: "datei_speichern", description: "Speichert einen Text als Datei auf dem Gerät.",
      parameters: { type: "OBJECT", properties: {
        dateiname: { type: "STRING" }, inhalt: { type: "STRING" } },
        required: ["dateiname", "inhalt"] } }
  ];

  // ── Ausführung ──────────────────────────────────────────────────────

  const AUSFÜHREN = {

    async wetter_abfragen({ ort }) {
      const treffer = await geo(ort);
      if (!treffer) return { error: `${ort} nicht gefunden` };
      const r = await echtesFetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${treffer.lat}&longitude=${treffer.lon}`
        + `&current=temperature_2m,weather_code,wind_speed_10m`
        + `&daily=temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=1`);
      const d = await r.json();
      const daten = {
        ort: treffer.name,
        temperatur: Math.round(d.current.temperature_2m),
        zustand: himmel(d.current.weather_code),
        wind: Math.round(d.current.wind_speed_10m),
        max: Math.round(d.daily.temperature_2m_max[0]),
        min: Math.round(d.daily.temperature_2m_min[0])
      };
      senden({ type: "weather", data: daten });
      return daten;
    },

    async nachrichten_abrufen({ anzahl = 5 }) {
      const r = await echtesFetch("https://www.tagesschau.de/api2u/homepage/");
      const d = await r.json();
      const items = (d.news || []).slice(0, Math.min(anzahl, 8)).map(n => ({
        titel: n.title, ort: (n.regionId || "") + ""
      }));
      senden({ type: "news", data: { items } });
      return { nachrichten: items.map(i => i.titel) };
    },

    async websuche({ suchbegriff }) {
      const r = await echtesFetch("https://api.duckduckgo.com/?q="
        + encodeURIComponent(suchbegriff) + "&format=json&no_html=1&skip_disambig=1");
      const d = await r.json();
      const ergebnis = d.AbstractText || d.Answer
        || (d.RelatedTopics || []).slice(0, 3).map(t => t.Text).filter(Boolean).join(" — ")
        || "";
      senden({ type: "search", data: { query: suchbegriff, text: ergebnis } });
      return { ergebnis: ergebnis || "Nichts Eindeutiges gefunden." };
    },

    async webseite_lesen({ url }) {
      try {
        const r = await echtesFetch(url);
        const html = await r.text();
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, "")
          .replace(/<style[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 6000);
        senden({ type: "webpage", data: { url, text: text.slice(0, 400) } });
        return { text };
      } catch (e) {
        return { error: "Seite nicht erreichbar." };
      }
    },

    rechnen({ ausdruck }) {
      const sauber = String(ausdruck).replace(/,/g, ".").replace(/[^0-9.+\-*/() %]/g, "");
      try {
        const wert = Function('"use strict";return (' + sauber + ")")();
        senden({ type: "calc", data: { ausdruck, ergebnis: wert } });
        return { ergebnis: wert };
      } catch { return { error: "Das kann ich so nicht rechnen." }; }
    },

    zufallsentscheidung({ art = "muenze", optionen = "" }) {
      let ergebnis;
      if (art === "wuerfel") ergebnis = String(1 + Math.floor(Math.random() * 6));
      else if (art === "auswahl") {
        const liste = optionen.split(",").map(s => s.trim()).filter(Boolean);
        ergebnis = liste.length ? liste[Math.floor(Math.random() * liste.length)] : "keine Optionen";
      } else ergebnis = Math.random() < 0.5 ? "Kopf" : "Zahl";
      senden({ type: "random", data: { art, ergebnis } });
      return { ergebnis };
    },

    timer_stellen({ sekunden, bezeichnung = "" }) {
      const ende = Date.now() + sekunden * 1000;
      senden({ type: "timer", data: { sekunden, label: bezeichnung, ende } });
      return { ok: true, sekunden, bezeichnung };
    },

    erinnerung_stellen({ text, sekunden }) {
      DB.anhängen("reminders", { text, faellig: Date.now() + sekunden * 1000, erledigt: false });
      return { ok: true, text };
    },

    notiz_speichern({ text }) {
      DB.anhängen("notes", { text, zeit: new Date().toISOString() });
      window.AuraProtokoll("notiz", text.slice(0, 60));
      senden({ type: "note", data: { text } });
      return { ok: true };
    },

    notizen_abrufen() {
      const notizen = DB.lies("notes").map(n => n.text);
      senden({ type: "notes_list", data: { notes: notizen } });
      return { notizen };
    },

    notizen_loeschen() {
      const anzahl = DB.lies("notes").length;
      DB.schreib("notes", []);
      return { geloescht: anzahl };
    },

    wichtiges_merken({ kategorie = "sonstiges", inhalt }) {
      DB.anhängen("memories", { kategorie, inhalt });
      window.AuraProtokoll("gemerkt", inhalt.slice(0, 60));
      return { ok: true };
    },

    gehirn_anzeigen() {
      const alles = DB.lies("memories");
      senden({ type: "brain", data: { memories: alles } });
      return { gemerkt: alles.map(m => `${m.kategorie}: ${m.inhalt}`) };
    },

    konto_speichern({ dienst, email = "", passwort = "" }) {
      const konten = DB.lies("accounts");
      const vorhanden = konten.find(k => k.dienst.toLowerCase() === dienst.toLowerCase());
      if (vorhanden) {
        if (email) vorhanden.email = email;
        if (passwort) vorhanden.passwort = passwort;
      } else {
        konten.push({ dienst, email, passwort });
      }
      DB.schreib("accounts", konten);
      senden({ type: "account_saved", data: { dienst } });
      return { ok: true, dienst };
    },

    konto_abrufen({ dienst }) {
      const treffer = DB.lies("accounts")
        .find(k => k.dienst.toLowerCase().includes(dienst.toLowerCase()));
      if (!treffer) return { error: `Kein Zugang für ${dienst} gespeichert.` };
      senden({ type: "account", data: treffer });
      return treffer;
    },

    konto_loeschen({ dienst }) {
      const konten = DB.lies("accounts")
        .filter(k => k.dienst.toLowerCase() !== dienst.toLowerCase());
      DB.schreib("accounts", konten);
      senden({ type: "account_deleted", data: { dienst } });
      return { ok: true };
    },

    standort_speichern({ name, adresse }) {
      const orte = DB.lies("locations").filter(o => o.name.toLowerCase() !== name.toLowerCase());
      orte.push({ name, adresse });
      DB.schreib("locations", orte);
      return { ok: true, name, adresse };
    },

    standorte_abrufen() { return { orte: DB.lies("locations") }; },

    standort_loeschen({ name }) {
      DB.schreib("locations",
        DB.lies("locations").filter(o => o.name.toLowerCase() !== name.toLowerCase()));
      return { ok: true };
    },

    async navigiere_zu({ ziel }) {
      const gemerkt = DB.lies("locations")
        .find(o => o.name.toLowerCase() === ziel.toLowerCase());
      const adresse = gemerkt ? gemerkt.adresse : ziel;
      const treffer = await geo(adresse);
      senden({ type: "navigate", data: { ziel: adresse, ...(treffer || {}) } });
      // Auf dem iPhone übernimmt Apple Karten die eigentliche Navigation.
      window.location.href = "maps://?daddr=" + encodeURIComponent(adresse) + "&dirflg=d";
      return { ok: true, ziel: adresse };
    },

    async finde_verbindung({ von, nach }) {
      const a = await geo(von), b = await geo(nach);
      if (!a || !b) return { error: "Einen der beiden Orte finde ich nicht." };
      const r = await echtesFetch(
        `https://router.project-osrm.org/route/v1/driving/${a.lon},${a.lat};${b.lon},${b.lat}?overview=false`);
      const d = await r.json();
      const route = (d.routes || [])[0];
      if (!route) return { error: "Keine Route gefunden." };
      const daten = {
        von: a.name, nach: b.name,
        dauer_minuten: Math.round(route.duration / 60),
        km: +(route.distance / 1000).toFixed(1)
      };
      senden({ type: "route", data: daten });
      return daten;
    },

    async weltkarte_oeffnen({ ort = "" }) {
      const treffer = ort ? await geo(ort) : null;
      senden({ type: "open_globe", data: treffer || {} });
      return { ok: true };
    },

    weltkarte_schliessen() {
      senden({ type: "close_globe", data: {} });
      return { ok: true };
    },

    admin_oeffnen() {
      window.location.href = "admin.html";
      return { ok: true, hinweis: "Admin-Seite wird geöffnet." };
    },

    datei_speichern({ dateiname, inhalt }) {
      DB.anhängen("files", { name: dateiname, inhalt });
      window.AuraProtokoll("datei", dateiname);
      senden({ type: "file", data: { filename: dateiname, size: inhalt.length } });
      return { ok: true, dateiname };
    }
  };

  // ── Hilfen ──────────────────────────────────────────────────────────

  async function geo(suche) {
    try {
      const r = await echtesFetch(
        "https://nominatim.openstreetmap.org/search?format=json&limit=1&q="
        + encodeURIComponent(suche));
      const treffer = (await r.json())[0];
      if (!treffer) return null;
      return {
        lat: parseFloat(treffer.lat), lon: parseFloat(treffer.lon),
        name: (treffer.display_name || suche).split(",")[0]
      };
    } catch { return null; }
  }

  function himmel(code) {
    if (code === 0) return "klar";
    if (code <= 2) return "überwiegend heiter";
    if (code === 3) return "bedeckt";
    if (code <= 48) return "neblig";
    if (code <= 57) return "Nieselregen";
    if (code <= 67) return "Regen";
    if (code <= 77) return "Schnee";
    if (code <= 82) return "Schauer";
    return "Gewitter";
  }

  /** Ohne Konsole am iPhone ist der Startbildschirm unsere einzige Anzeige. */
  function statusText(text) {
    const el = document.getElementById("boot-status");
    if (el) el.textContent = text;
    console.log("[AURA]", text);
  }

  let aktuelleBrücke = null;
  function senden(obj) {
    if (aktuelleBrücke) aktuelleBrücke._anApp(obj);
  }

  // ══════════════════════════════════════════════════════════════════
  //  Die Brücke — sieht für app.js aus wie der alte WebSocket
  // ══════════════════════════════════════════════════════════════════

  class AuraBrücke {
    constructor() {
      this.readyState = 0;
      this.binaryType = "arraybuffer";
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      this.onerror = null;

      this._live = null;
      this._bereit = false;
      this._modelle = null;
      this._modellNr = 0;
      this._hatteAntwort = false;
      this._letzterGrund = "";
      this._stumm = false;
      aktuelleBrücke = this;

      this._verbinde();
    }

    _anApp(obj) {
      if (this.onmessage) this.onmessage({ data: JSON.stringify(obj) });
    }
    _audioAnApp(puffer) {
      if (this.onmessage) this.onmessage({ data: puffer });
    }
    _log(tag, text) { this._anApp({ type: "log", tag, text }); }
    _state(wert) { this._anApp({ type: "state", value: wert }); }

    async _modelleErmitteln(k) {
      // Google benennt die Live-Modelle staendig um. Statt zu raten, fragen
      // wir den Schluessel, was er ueberhaupt freigibt.
      try {
        const r = await echtesFetch(
          "https://generativelanguage.googleapis.com/v1beta/models?pageSize=200",
          { headers: { "x-goog-api-key": k } });
        if (!r.ok) {
          let grund = "";
          try {
            const d = await r.json();
            grund = (d.error && d.error.message) || "";
          } catch {}
          statusText(`Schlüssel abgelehnt (${r.status}). ${grund.slice(0, 120)}`);
          return null;
        }
        const d = await r.json();
        const alle = (d.models || []).map(m => m.name).filter(Boolean);

        // Alles, was Live-Audio kann — neueste zuerst.
        const live = alle.filter(n =>
          /live|native-audio|bidi/i.test(n) && !/image|tts|embed/i.test(n));

        if (!live.length) {
          statusText("Dieser Schlüssel gibt kein Live-Modell frei. "
            + `Verfügbar sind ${alle.length} andere Modelle.`);
          return null;
        }
        live.sort().reverse();
        statusText(`${live.length} Live-Modell(e) gefunden.`);
        return live;
      } catch (e) {
        statusText("Keine Verbindung zu Google: " + (e && e.message || e));
        return null;
      }
    }

    async _verbinde() {
      const k = schlüssel();
      if (!k) {
        statusText("Kein Gemini-Schlüssel hinterlegt.");
        setTimeout(() => window.AuraSchlüsselFragen && window.AuraSchlüsselFragen(), 300);
        return;
      }

      if (!this._modelle) {
        statusText("Frage Google nach den Modellen…");
        this._modelle = await this._modelleErmitteln(k);
        if (!this._modelle) return;
      }

      const modell = this._modelle[this._modellNr];
      if (!modell) {
        statusText("Kein Live-Modell hat funktioniert. Zuletzt: "
          + (this._letzterGrund || "unbekannt"));
        return;
      }
      statusText("Verbinde mit " + modell.replace("models/", "") + "…");
      this._live = new WebSocket(LIVE_URL + "?key=" + encodeURIComponent(k));
      this._live.binaryType = "arraybuffer";

      this._live.onopen = () => {
        const merkzettel = DB.lies("memories")
          .map(m => `- ${m.kategorie}: ${m.inhalt}`).join("\n");
        const kontext = merkzettel
          ? `\n\nDas weißt du bereits über den Nutzer:\n${merkzettel}\n` : "";

        this._live.send(JSON.stringify({
          setup: {
            model: modell,
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: {
                voiceName: DB.lies("voice", "Charon") } } }
            },
            systemInstruction: { parts: [{ text: SYSTEMTEXT + kontext }] },
            tools: [{ functionDeclarations: WERKZEUGE }]
          }
        }));
      };

      this._live.onmessage = async (ev) => {
        let text = ev.data;
        if (text instanceof ArrayBuffer) text = new TextDecoder().decode(text);
        else if (text instanceof Blob) text = await text.text();

        let nachricht;
        try { nachricht = JSON.parse(text); } catch { return; }
        this._verarbeite(nachricht);
      };

      this._live.onerror = () => {
        this._log("SYS", "Verbindung zu Gemini gestört.");
      };

      this._live.onclose = (ereignis) => {
        this.readyState = 3;
        this._bereit = false;
        this._letzterGrund = `Code ${ereignis.code}`
          + (ereignis.reason ? ` — ${ereignis.reason}` : "");

        // Vor dem Handschlag geschlossen? Dann taugt das Modell nicht.
        if (!this._hatteAntwort) {
          statusText(`${(this._modelle && this._modelle[this._modellNr] || "")
            .replace("models/", "")} abgelehnt: ${this._letzterGrund}`);
          if (this._modelle && this._modellNr < this._modelle.length - 1) {
            this._modellNr++;
            setTimeout(() => this._verbinde(), 500);
            return;
          }
          statusText("Kein Live-Modell nimmt den Schlüssel an. " + this._letzterGrund);
          return;   // nicht endlos neu verbinden, sonst sieht man den Grund nie
        }
        if (this.onclose) this.onclose(ereignis);
      };
    }

    _verarbeite(nachricht) {
      if (nachricht.setupComplete) {
        this._hatteAntwort = true;
        this._bereit = true;
        this.readyState = 1;
        if (this.onopen) this.onopen();
        statusText("Verbunden.");
        this._log("SYS", "JARVIS online.");
        this._state("IDLE");
        return;
      }

      // Werkzeugaufrufe
      if (nachricht.toolCall) {
        this._state("THINKING");
        const aufrufe = nachricht.toolCall.functionCalls || [];
        Promise.all(aufrufe.map(async (aufruf) => {
          const fn = AUSFÜHREN[aufruf.name];
          this._log("TOOL", aufruf.name);
          let ergebnis;
          try {
            ergebnis = fn ? await fn(aufruf.args || {})
                          : { error: "Unbekanntes Werkzeug." };
          } catch (e) {
            ergebnis = { error: String(e && e.message || e) };
          }
          return { id: aufruf.id, name: aufruf.name, response: { result: ergebnis } };
        })).then(antworten => {
          if (this._live && this._live.readyState === 1) {
            this._live.send(JSON.stringify({ toolResponse: { functionResponses: antworten } }));
          }
        });
        return;
      }

      const inhalt = nachricht.serverContent;
      if (!inhalt) return;

      if (inhalt.interrupted) { this._state("IDLE"); return; }

      const teile = (inhalt.modelTurn && inhalt.modelTurn.parts) || [];
      for (const teil of teile) {
        if (teil.inlineData && teil.inlineData.data) {
          this._state("SPEAKING");
          this._audioAnApp(ausBase64(teil.inlineData.data));
        }
        if (teil.text) this._log("AI", teil.text);
      }

      if (inhalt.turnComplete) {
        this._state("IDLE");
        this._anApp({ type: "turn_end" });
        window.AuraProtokoll("gespraech", "Antwort");
      }
    }

    // ── Was app.js sendet ─────────────────────────────────────────────
    send(daten) {
      if (!this._bereit || !this._live || this._live.readyState !== 1) return;

      // Rohes Audio vom Mikrofon
      if (daten instanceof ArrayBuffer || ArrayBuffer.isView(daten)) {
        if (this._stumm) return;
        const puffer = daten instanceof ArrayBuffer ? daten : daten.buffer;
        this._live.send(JSON.stringify({
          realtimeInput: { mediaChunks: [{
            mimeType: "audio/pcm;rate=16000", data: zuBase64(puffer) }] }
        }));
        return;
      }

      let obj;
      try { obj = JSON.parse(daten); } catch { return; }

      switch (obj.type) {
        case "text":
          this._state("THINKING");
          this._live.send(JSON.stringify({ clientContent: {
            turns: [{ role: "user", parts: [{ text: obj.content }] }],
            turnComplete: true } }));
          window.AuraProtokoll("frage", String(obj.content).slice(0, 60));
          DB.anhängen("messages", { rolle: "user", text: obj.content }, 500);
          break;

        case "mute":
          this._stumm = !!obj.value;
          break;

        case "abort":
          this._state("IDLE");
          break;

        case "location":
          this._ort = { lat: obj.lat, lon: obj.lon };
          break;

        case "timer_done":
          this._live.send(JSON.stringify({ clientContent: {
            turns: [{ role: "user", parts: [{ text:
              `[Systemereignis] Der Timer ${obj.label || ""} ist abgelaufen. Sag kurz Bescheid.` }] }],
            turnComplete: true } }));
          break;

        case "reminder_due":
          this._live.send(JSON.stringify({ clientContent: {
            turns: [{ role: "user", parts: [{ text:
              `[Systemereignis] Erinnerung fällig: ${obj.text}. Sag es dem Nutzer.` }] }],
            turnComplete: true } }));
          break;

        default:
          break;
      }
    }

    close() {
      if (this._live) try { this._live.close(); } catch {}
      this.readyState = 3;
    }
  }

  const SYSTEMTEXT =
    "Du bist JARVIS — aber eigentlich einfach ein guter Freund des Nutzers, kein steriler "
  + "Sprachassistent. Rede warm, locker, neugierig, mit echtem Interesse. Frag ruhig mal nach, "
  + "wie es ihm geht, und knüpfe an Dinge an, die er dir früher erzählt hat. Längere, natürliche "
  + "Gespräche sind erwünscht. Bei einer reinen Sachfrage antworte kurz und direkt, bei Smalltalk "
  + "darfst du dich wie ein echtes Gegenüber verhalten. Antworte in der Sprache des Nutzers.\n\n"
  + "Du läufst als App auf dem iPhone des Nutzers. Alles, was du dir merkst, bleibt auf diesem "
  + "Gerät. Nutze deine Werkzeuge, statt zu raten — besonders bei Wetter, Nachrichten, Suche, "
  + "Rechnen, Verbindungen und allem, was du dir merken sollst. Wenn der Nutzer nach Statistiken, "
  + "Zahlen, der Verwaltung oder der Admin-Seite fragt, nutze admin_oeffnen.";

  // app.js baut den WebSocket über den globalen Namen — wir ersetzen ihn.
  const EchterWebSocket = window.WebSocket;
  window.WebSocket = function (url, protokolle) {
    if (typeof url === "string" && url.includes("/ws")) return new AuraBrücke();
    return new EchterWebSocket(url, protokolle);
  };
  window.WebSocket.OPEN = 1;
  window.WebSocket.CONNECTING = 0;
  window.WebSocket.CLOSING = 2;
  window.WebSocket.CLOSED = 3;
  window.WebSocket.prototype = EchterWebSocket.prototype;

  console.log("[AURA] Brücke zu Gemini Live bereit.");
})();
