/* ══════════════════════════════════════════════════════════════════════
   lokal.js — ersetzt Server und Datenbank.

   Alles, was AURA früher per fetch() beim Python-Server geholt hat,
   wird hier abgefangen und aus dem Speicher des iPhones beantwortet.
   Es gibt genau ein Konto, keinen Login, keine Sitzungen.
   Die Admin-Seite bleibt und rechnet ihre Zahlen aus den lokalen Daten.
   ══════════════════════════════════════════════════════════════════════ */

(() => {
  "use strict";

  const SCHLÜSSEL = "aura.";

  // ── Speicher ────────────────────────────────────────────────────────
  const DB = {
    lies(tabelle, standard = []) {
      try {
        const roh = localStorage.getItem(SCHLÜSSEL + tabelle);
        return roh ? JSON.parse(roh) : standard;
      } catch { return standard; }
    },
    schreib(tabelle, wert) {
      try {
        localStorage.setItem(SCHLÜSSEL + tabelle, JSON.stringify(wert));
        return true;
      } catch (e) {
        console.warn("[AURA] Speicher voll?", e);
        return false;
      }
    },
    anhängen(tabelle, eintrag, grenze = 0) {
      const liste = DB.lies(tabelle);
      liste.push({ id: Date.now() + Math.random(), ts: Date.now(), ...eintrag });
      if (grenze && liste.length > grenze) liste.splice(0, liste.length - grenze);
      DB.schreib(tabelle, liste);
      return liste[liste.length - 1];
    },
    größeMB() {
      let bytes = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(SCHLÜSSEL)) bytes += (localStorage.getItem(k) || "").length * 2;
      }
      return +(bytes / 1048576).toFixed(2);
    }
  };
  window.AuraDB = DB;

  // ── Das eine Konto ──────────────────────────────────────────────────
  const ICH = {
    id: 1,
    username: DB.lies("name", "Julian"),
    is_admin: true,          // damit die Admin-Seite offen ist
    created_at: (() => {
      let d = localStorage.getItem(SCHLÜSSEL + "seit");
      if (!d) { d = new Date().toISOString(); localStorage.setItem(SCHLÜSSEL + "seit", d); }
      return d;
    })()
  };
  window.AuraIch = ICH;

  // ── Kleine Helfer ───────────────────────────────────────────────────
  const jetzt = () => new Date().toISOString();
  const antwort = (obj, status = 200) =>
    new Response(JSON.stringify(obj), {
      status,
      headers: { "Content-Type": "application/json" }
    });

  function tagesSchlüssel(datum = new Date()) {
    return datum.toISOString().slice(0, 10);
  }

  /** Zählt eine Aktivität mit — davon lebt die Admin-Seite. */
  function protokoll(art, text) {
    DB.anhängen("activity", { art, text, zeit: jetzt() }, 200);
    const zähler = DB.lies("zaehler", {});
    const tag = tagesSchlüssel();
    zähler[tag] = (zähler[tag] || 0) + 1;
    DB.schreib("zaehler", zähler);
  }
  window.AuraProtokoll = protokoll;

  // ── Die Routen ──────────────────────────────────────────────────────
  const routen = {

    // Konto — es gibt nur eines, also immer angemeldet
    "GET /api/auth/me": () => antwort({
      username: ICH.username, is_admin: ICH.is_admin, id: ICH.id
    }),
    "POST /api/auth/logout": () => antwort({ ok: true }),
    "POST /api/auth/login": () => antwort({ ok: true, username: ICH.username }),
    "POST /api/auth/register": () => antwort({ ok: true, username: ICH.username }),

    // Notizen
    "GET /api/notes": () => antwort(
      DB.lies("notes").map(n => ({ id: n.id, text: n.text, created_at: n.zeit }))
    ),

    // Erinnerungen
    "GET /api/reminders/due": () => {
      const nun = Date.now();
      const fällig = DB.lies("reminders").filter(r => !r.erledigt && r.faellig <= nun);
      return antwort(fällig.map(r => ({ id: r.id, text: r.text })));
    },
    "POST /api/reminders/ack": async (req) => {
      const körper = await leseKörper(req);
      const liste = DB.lies("reminders");
      const treffer = liste.find(r => String(r.id) === String(körper.id));
      if (treffer) treffer.erledigt = true;
      DB.schreib("reminders", liste);
      return antwort({ ok: true });
    },

    // Stimme
    "GET /api/voice": () => antwort({ voice: DB.lies("voice", "Aoede") }),
    "POST /api/voice": async (req) => {
      const körper = await leseKörper(req);
      if (körper.voice) DB.schreib("voice", körper.voice);
      return antwort({ ok: true, voice: DB.lies("voice", "Aoede") });
    },

    // Bahn-Reihenfolge (Wagenreihung)
    "GET /api/rail-order": () => antwort(DB.lies("rail", null) || {}),
    "POST /api/rail-order": async (req) => {
      DB.schreib("rail", await leseKörper(req));
      return antwort({ ok: true });
    },

    // Rundnachricht — ohne mehrere Nutzer bedeutungslos, bleibt aber ruhig
    "GET /api/broadcast": () => antwort({}),
    "POST /api/broadcast/seen": () => antwort({ ok: true }),
    "POST /api/admin/broadcast": () => antwort({ ok: true }),

    "GET /api/system-status": () => antwort({
      maintenance: false, ok: true, mode: "lokal"
    }),

    // ── Admin ────────────────────────────────────────────────────────
    "GET /api/admin/stats": () => {
      const nachrichten = DB.lies("messages");
      const zähler = DB.lies("zaehler", {});
      const heute = zähler[tagesSchlüssel()] || 0;
      return antwort({
        users: 1,
        active_sessions: 1,
        messages: nachrichten.length,
        messages_today: heute,
        files: DB.lies("files").length,
        notes: DB.lies("notes").length,
        memories: DB.lies("memories").length,
        reminders: DB.lies("reminders").filter(r => !r.erledigt).length,
        db_size_mb: DB.größeMB(),
        uptime: laufzeitText(),
        mode: "Lokal auf dem Gerät"
      });
    },

    "GET /api/admin/users": () => antwort([{
      username: ICH.username,
      is_admin: true,
      created_at: ICH.created_at,
      messages: DB.lies("messages").length,
      files: DB.lies("files").length,
      size_mb: DB.größeMB(),
      last_seen: jetzt()
    }]),

    "GET /api/admin/activity": () => antwort(
      DB.lies("activity").slice(-25).reverse().map(a => ({
        username: ICH.username, action: a.art, detail: a.text, created_at: a.zeit
      }))
    ),

    "GET /api/admin/chart": () => {
      const zähler = DB.lies("zaehler", {});
      const punkte = [];
      for (let i = 6; i >= 0; i--) {
        const d = new Date(Date.now() - i * 86400000);
        const tag = tagesSchlüssel(d);
        punkte.push({ day: tag, count: zähler[tag] || 0 });
      }
      return antwort(punkte);
    },

    "GET /api/admin/changelog": () => antwort([
      { version: "iOS 1.0", text: "Läuft komplett auf dem iPhone. Kein Server, keine Datenbank, kein Login." }
    ]),

    // Konto löschen heißt hier: alles Lokale wegwerfen
    "POST /api/admin/delete-user": () => {
      ["notes", "memories", "reminders", "files", "messages",
       "activity", "zaehler", "accounts", "locations"].forEach(t =>
        localStorage.removeItem(SCHLÜSSEL + t));
      return antwort({ ok: true, message: "Alle lokalen Daten gelöscht." });
    },
    "POST /api/admin/reset-password": () =>
      antwort({ ok: false, message: "Es gibt kein Passwort mehr — nur dieses Gerät." }),
    "POST /api/admin/maintenance": () => antwort({ ok: true }),
    "POST /api/admin/login-message": () => antwort({ ok: true }),

    // Spotify braucht einen Server für die Anmeldung — hier abgeschaltet
    "GET /api/spotify/status": () => antwort({ linked: false, available: false }),
    "POST /api/spotify/unlink": () => antwort({ ok: true })
  };

  function laufzeitText() {
    const tage = Math.floor((Date.now() - new Date(ICH.created_at)) / 86400000);
    return tage === 0 ? "seit heute" : `seit ${tage} Tagen`;
  }

  async function leseKörper(req) {
    try { return await req.json(); } catch { return {}; }
  }

  // ── Geokodierung und Routen gehen weiter ins Netz, nur direkt ───────
  async function geokodieren(suche) {
    const u = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q="
            + encodeURIComponent(suche);
    const r = await fetch(u, { headers: { "Accept": "application/json" } });
    const treffer = (await r.json())[0];
    if (!treffer) return antwort({ error: "nicht gefunden" }, 404);
    return antwort({
      lat: parseFloat(treffer.lat),
      lon: parseFloat(treffer.lon),
      name: treffer.display_name || suche
    });
  }

  // ── fetch abfangen ──────────────────────────────────────────────────
  const echtesFetch = window.fetch.bind(window);
  window.AuraFetch = echtesFetch;   // für alles, was wirklich raus soll

  window.fetch = async function (eingabe, optionen = {}) {
    const url = typeof eingabe === "string" ? eingabe : (eingabe && eingabe.url) || "";
    const methode = (optionen.method || (eingabe && eingabe.method) || "GET").toUpperCase();

    // Nur eigene Pfade abfangen, alles andere normal ins Netz
    if (!url.startsWith("/api/") && !url.includes("/api/")) {
      return echtesFetch(eingabe, optionen);
    }

    const pfad = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];

    if (pfad === "/api/geocode") {
      const suche = new URL(url, "http://x").searchParams.get("q") || "";
      return geokodieren(suche);
    }

    const behandler = routen[`${methode} ${pfad}`];
    if (behandler) {
      const anfrage = { json: async () => {
        try { return JSON.parse(optionen.body || "{}"); } catch { return {}; }
      }};
      try { return await behandler(anfrage); }
      catch (e) {
        console.warn("[AURA] lokal:", pfad, e);
        return antwort({ error: String(e) }, 500);
      }
    }

    console.warn("[AURA] unbekannter Pfad, lokal ignoriert:", methode, pfad);
    return antwort({}, 404);
  };

  console.log("[AURA] Lokaler Speicher aktiv — kein Server, kein Login.");
})();
