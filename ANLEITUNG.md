# AURA fuer iPhone — 1.0

Kein Server, keine Datenbank, kein Login. Alles laeuft auf dem Geraet.

## Was sich geaendert hat

Die Oberflaeche ist unveraendert: index.html, app.js, style.css, globe.js,
brain.js, gestures.js, hexbg.js und admin.html sind dieselben Dateien wie
vorher. Weggefallen ist nur server.py.

An seine Stelle treten drei neue Dateien:

- lokal.js      ersetzt Datenbank und REST-Schnittstelle. Jeder Aufruf, der
                frueher an den Python-Server ging, wird abgefangen und aus dem
                Speicher des iPhones beantwortet. Notizen, Merkzettel, Konten,
                Orte, Erinnerungen, Dateien, Verlauf und die Zahlen fuer die
                Admin-Seite liegen dort.
- bruecke.js    ersetzt den WebSocket zum Server. AURA spricht jetzt direkt
                mit Gemini Live: Audio hin, Audio zurueck, Werkzeugaufrufe
                laufen im Geraet. Nach aussen verhaelt sich die Bruecke wie
                der alte Server, deshalb musste app.js nicht angefasst werden.
- schluessel.js ersetzt login.html. Beim ersten Start wird einmal nach dem
                Gemini-Schluessel gefragt, danach nie wieder.

login.html und reset_password.py sind ersatzlos entfallen. Es gibt genau ein
Konto, ohne Passwort, ohne Sitzung.

## Admin-Seite

Bleibt vollstaendig erhalten und ist immer offen — es gibt keine Rechte mehr,
die man pruefen muesste. Sag "zeig mir die Stats", "oeffne die Admin-Seite"
oder "wie sind die Zahlen", dann ruft AURA das Werkzeug admin_oeffnen auf.

Die Zahlen kommen jetzt aus dem lokalen Speicher: Anzahl Nachrichten, Notizen,
Merkzettel, Dateien, offene Erinnerungen, belegter Speicher, Verlauf der
letzten sieben Tage und das Aktivitaetsprotokoll.

## Bauen

Wie gehabt: alles in ein GitHub-Repo, build.yml unter .github/workflows/,
Actions laeuft, Artefakt heisst AURA-ipa. Wichtig: der Ordner **Web** muss
mit hochgeladen werden, samt allen Dateien darin.

Am iPhone geht das Hochladen eines ganzen Ordners nicht direkt — leg im Repo
ueber "Create new file" den Pfad Web/index.html an, dann existiert der Ordner
und du kannst die restlichen Dateien per Upload hineinlegen.

## Erster Start

AURA fragt nach dem Gemini-Schluessel und prueft ihn sofort. Danach
Mikrofon erlauben, fertig.

## Was noch fehlt

- Spotify: die Anmeldung braucht eine Rueckleitung ueber einen Server.
  Abgeschaltet, das Werkzeug antwortet freundlich.
- Word-, PowerPoint- und Bilderzeugung: liefen ueber Python-Bibliotheken
  auf dem Server. Kommen als naechstes ueber JavaScript-Ersatz.
- Wagenreihung und VRR-Fahrplan: aktuell ueber OSRM als Fahrzeit-Schaetzung,
  noch nicht als echte Bahnverbindung.
