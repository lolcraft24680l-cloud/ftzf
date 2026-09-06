/* schluessel.js — fragt einmalig nach dem Gemini-Schlüssel.
   Ersetzt die alte Login-Seite: es gibt kein Konto und kein Passwort mehr,
   nur diesen einen Schlüssel, und der bleibt auf dem Gerät.            */

(() => {
  "use strict";

  function vorhanden() { return !!localStorage.getItem("aura.key"); }

  function zeigen(grund = "") {
    if (document.getElementById("aura-key-overlay")) return;

    const blende = document.createElement("div");
    blende.id = "aura-key-overlay";
    blende.innerHTML = `
      <div class="aura-key-box">
        <h2>AURA</h2>
        <p>${grund || "Füge deinen Gemini API-Schlüssel ein. Er bleibt auf diesem iPhone und geht nur an Google."}</p>
        <input id="aura-key-input" type="text" placeholder="Schlüssel einfügen"
               autocomplete="off" autocorrect="off" autocapitalize="none" spellcheck="false">
        <button id="aura-key-save">Verbinden</button>
        <div id="aura-key-note"></div>
      </div>`;

    const stil = document.createElement("style");
    stil.textContent = `
      #aura-key-overlay{position:fixed;inset:0;z-index:99999;display:flex;
        align-items:center;justify-content:center;background:rgba(3,7,12,.94);
        backdrop-filter:blur(14px);font-family:system-ui,-apple-system,sans-serif}
      .aura-key-box{width:min(420px,86vw);padding:30px;border-radius:20px;
        background:rgba(12,22,32,.9);border:1px solid rgba(80,200,255,.28);
        box-shadow:0 0 60px rgba(0,180,255,.18);color:#cfe9f7}
      .aura-key-box h2{margin:0 0 10px;font-size:26px;letter-spacing:.18em;
        color:#7fe3ff;font-weight:600}
      .aura-key-box p{margin:0 0 18px;font-size:14px;line-height:1.5;opacity:.7}
      #aura-key-input{width:100%;padding:14px;border-radius:12px;font-size:15px;
        font-family:ui-monospace,Menlo,monospace;color:#eaf6ff;
        background:rgba(255,255,255,.05);border:1px solid rgba(120,210,255,.25);
        outline:none;box-sizing:border-box}
      #aura-key-save{width:100%;margin-top:12px;padding:14px;border:0;border-radius:12px;
        font-size:16px;font-weight:600;color:#04222b;background:#5ce8ff;cursor:pointer}
      #aura-key-note{margin-top:12px;font-size:13px;min-height:18px;color:#ff8f8f}`;

    document.head.appendChild(stil);
    document.body.appendChild(blende);

    const feld = document.getElementById("aura-key-input");
    const notiz = document.getElementById("aura-key-note");
    setTimeout(() => feld.focus(), 250);

    async function speichern() {
      // Beim Einfuegen vom iPhone haengen oft Anfuehrungszeichen oder
      // ein Zeilenumbruch mit dran — die wirft Google sonst zurueck.
      const k = feld.value.replace(/[\s"'`]/g, "");
      if (!k) { notiz.textContent = "Da steht noch nichts."; return; }
      notiz.style.color = "#7fe3ff";
      notiz.textContent = "Prüfe…";

      try {
        const r = await (window.AuraFetch || fetch)(
          "https://generativelanguage.googleapis.com/v1beta/models",
          { headers: { "x-goog-api-key": k } });

        if (!r.ok) {
          let grund = "";
          try {
            const d = await r.json();
            grund = (d.error && (d.error.status
              ? d.error.status + ": " + d.error.message
              : d.error.message)) || "";
          } catch {}

          notiz.style.color = "#ff8f8f";
          if (/API_KEY_INVALID|not valid|API key/i.test(grund) ||
              r.status === 400 || r.status === 401 || r.status === 403) {
            notiz.textContent = "Google lehnt den Schlüssel ab. " +
              (grund ? grund.slice(0, 180) : "Prüf, ob es wirklich ein Gemini-Schlüssel ist.");
          } else {
            notiz.textContent = "Fehler " + r.status + (grund ? " — " + grund.slice(0, 160) : "");
          }
          console.warn("[AURA] Schlüsselprüfung:", r.status, grund);
          return;
        }

        // Es muss auch ein Live-Modell dabei sein, sonst laeuft die Sprache nicht.
        const d = await r.json().catch(() => ({}));
        const namen = (d.models || []).map(m => m.name || "");
        if (!namen.length) {
          notiz.style.color = "#ff8f8f";
          notiz.textContent = "Der Schlüssel gibt keine Modelle frei.";
          return;
        }

        window.AuraSchlüsselSetzen(k);
        blende.remove();
        location.reload();
      } catch (e) {
        notiz.style.color = "#ff8f8f";
        notiz.textContent = "Keine Verbindung: " + (e && e.message || e);
      }
    }

    document.getElementById("aura-key-save").onclick = speichern;
    feld.addEventListener("keydown", e => { if (e.key === "Enter") speichern(); });
  }

  window.AuraSchlüsselFragen = () => zeigen();

  document.addEventListener("DOMContentLoaded", () => {
    if (!vorhanden()) zeigen();
  });
})();
