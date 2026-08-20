# Steeldart Dart-Counter

Zähler für Steeldart-Spiele. Die **Spielregeln liegen immer auf dem Server**. Die Desktop-App und der Browser sind Clients.

## Desktop-App (Windows und Raspberry Pi)

Eigenes Fenster (Electron), kein Browser mit Adressleiste. Dieselbe Codebasis. **Chromium ist nicht nötig** — die portable App *ist* die Desktop-Anwendung.

Beim Start wählst du den Modus:

| Desktop-Modus | Was passiert |
| --- | --- |
| **Offline** | Die App startet einen lokalen Server. Handys öffnen die LAN-IP oder scannen den **QR-Code**. Alle landen im **einen** lokalen Spiel, ohne Raum-ID. Schließen speichert den Stand 2 Stunden; LAN-Beitritt geht nur bei laufender App. |
| **Online** | Kein lokaler Spielserver. Verbindung zum Node-Webserver. **Jede Anlage bekommt einen eigenen Raum.** Raum bleibt 2h nach letzter Aktion (auch ohne Desktop). Dieselbe Anlage innerhalb von 2 Stunden: gleicher Raum; sonst neuer Code. Die Website `/` tritt nicht von allein bei. |

Unter Windows: maximiertes App-Fenster, F11 Vollbild, Escape beendet Vollbild. Auf dem Pi (Linux): Kiosk/Vollbild.

Entwicklung aus dem Quellcode:

```bash
npm install
npm run desktop
```

`npm run pi` ist dasselbe. Ohne erneutes Bauen: `npm run electron`.

## Portable Apps (Windows und Raspberry Pi)

**Download:** [GitHub Releases](https://github.com/geigerandre1-lang/dart-counter/releases) — Release **Portable Builds (aktuell)** (Tag `latest`). Jeder Push auf `master` ersetzt die Dateien dort.

Auf der Release-Seite liegen **zwei** Assets:

| Plattform | Datei | Start |
| --- | --- | --- |
| **Windows** (x64) | `steeldart-counter-*-win-x64.exe` | Doppelklick — **kein Setup, keine Installation** |
| **Raspberry Pi 4/5** (64-Bit, linux-arm64) | `steeldart-counter-*-linux-arm64.zip` (alternativ `.tar.gz`) | Entpacken, `chmod +x`, `./start.sh` oder `./steeldart-counter` |

Zusätzlich als Actions-Artifacts (Repo → **Actions** → **Portable Builds**).

Binaries gehören **nicht** ins Git (`release/` und `dist/` stehen in `.gitignore`).

### Windows portable lokal bauen

Node 18+:

```powershell
npm install
npm run dist:win
```

Ergebnis unter `release/`: z. B. `steeldart-counter-1.0.0-win-x64.exe`. Die Datei irgendwohin kopieren und doppelklicken.

### Raspberry Pi (linux-arm64) — fertiges Paket starten

**Pi 4/5 mit 64-Bit-OS (`arm64`) ist das Ziel.** Kein Chromium, kein `apt install chromium`.

```bash
unzip steeldart-counter-*-linux-arm64.zip -d ~/steeldart-counter
cd ~/steeldart-counter
# Falls die Dateien in einem Unterordner liegen (linux-arm64-unpacked o. ä.), dort hinein:
# cd linux-arm64-unpacked
chmod +x steeldart-counter start.sh
./start.sh
# oder:
./steeldart-counter
```

`.tar.gz` analog: `tar -xzf steeldart-counter-*-linux-arm64.tar.gz`.

Die Datei `steeldart-counter` *ist* die App.

### Auf dem Pi selbst bauen

CI baut linux-arm64 per Cross-Compile auf `ubuntu-latest` (private GitHub-Free-Konten haben keinen ARM-Runner). Lokal am Pi (nativ, empfohlen):

```bash
sudo apt update
sudo apt install -y git nodejs npm
git clone https://github.com/geigerandre1-lang/dart-counter.git dart-counter
cd dart-counter
npm install
npm run dist:pi:native
# nur 64-Bit: npm run dist:pi:arm64
```

`dist:pi` macht dasselbe, überspringt aber das Neuübersetzen nativer Module (Fallback `sql.js` reicht). `dist:pi:native` / `dist:pi:arm64` bauen `better-sqlite3` gegen Electron — besser, wenn Compiler-Tools vorhanden sind.

Ergebnis:

- `release/linux-arm64-unpacked/` — Ordner zum Kopieren
- `release/steeldart-counter-*-linux-arm64.zip` / `.tar.gz` — Archive zum Verteilen
- analog `linux-armv7l` für 32-Bit (Pi 3), wenn `dist:pi` / `dist:pi:native` beide Architekturen bauen

Von Windows aus (nur Konfiguration testen, oft ohne lauffähige ARM-Binary):

```powershell
npm run dist:pi
```

Wenn electron-builder ARM von Windows nicht packen kann: Quellcode auf den Pi legen und dort `npm run dist:pi:arm64` bzw. `dist:pi:native` ausführen.

Display drehen (Beispiel):

```bash
xrandr --output HDMI-1 --rotate left
```

Autostart: Electron, **nicht** Chromium. Siehe `packaging/steeldart-counter.desktop` und `packaging/steeldart-counter.service`. Helfer: `packaging/start-desktop.sh`.

Handy im selben WLAN: `http://<ip>:3000` oder QR-Code in Setup/Match (**Mit Handy beitreten**).

Beide Plattformen auf einmal (Windows portable + Pi-Artefakte, soweit der Host das kann):

```bash
npm run dist
```

## Web-App auf dem öffentlichen Node-Server

Online-Modus (Räume, Monitor, Admin). **Kein Python, kein node-gyp.** `better-sqlite3` und Electron sind optional; fehlt das Native-Addon, nutzt der Server **sql.js** (reines JavaScript).

```bash
STEELDART_MODE=online npm run build
STEELDART_MODE=online npm start
```

PowerShell:

```powershell
$env:STEELDART_MODE="online"
npm run build
npm start
```

`npm start` startet **sofort** `server.cjs` → `dist/server.cjs` (kein Vite zur Laufzeit, wenn `dist/client` schon da ist). Fehlt das Client-Build, baut der Start **einmal** mit Vite. Der Server-Bundle wird beim Start mit esbuild erzeugt/aktualisiert; `sql-wasm.wasm` wird kopiert.

### Hostinger (Node.js, Express-Preset)

**Eingabedatei / Startdatei: `app.js` lassen.** `app.js` ist CommonJS (Kopie von `server.cjs`): `node app.js` und `require("./app.js")` funktionieren. `package.json` hat kein `"type": "module"` mehr — sonst stirbt das Express-Preset mit `ERR_REQUIRE_ESM` und **leeren Runtime-Logs** (503). Procfile: `web: node server.cjs`.

| Panel-Feld | Wert |
| --- | --- |
| Node.js-Version | **18** (oder höher) |
| **Anwendungsroot** | Ordner des Git-Repos (nicht `public_html`) |
| **Eingabedatei / Startdatei der Anwendung** | **`app.js`** (nicht `dist/electron.cjs`) |
| **Build-Befehl** | leer lassen, oder optional `npm run build:web` |
| **Start-Befehl** | nur falls extra nötig: `npm start` |
| **STEELDART_MODE** | `online` (auch `ONLINE` / `Online` — Vergleich ist case-insensitive) |
| **PORT** | **nicht setzen** — das Panel injiziert den Port |

Die Domain `dart-counter.turniertool.eu` muss **dieser Node-App** zugeordnet sein. `package.json` `"main"` ist `server.cjs`. Nach Git-Pull **Redeploy** und Status **Running**.

Der Server bindet `process.env.PORT` (sonst `APP_PORT`, sonst 3000) auf `0.0.0.0`. Kein Port-Hopping wenn `PORT` gesetzt ist. `better-sqlite3` darf fehlen — Fallback ist sql.js (`dist/sql-wasm.wasm` oder `node_modules/sql.js`).

**Umgebung:**

```bash
STEELDART_MODE=online
STEELDART_ADMIN_PASSWORD=dein-geheimes-passwort
```

`PORT` nicht von Hand setzen. Optional: `STEELDART_SQLJS=1` (sql.js erzwingen, Native-SQLite gar nicht laden).

**SQLite-Datei (Hostinger):** Jedes Redeploy löscht `hbuilds/versions/<uuid>/nodejs/`. Die App legt die Datenbank deshalb **nicht** dort ab. Wenn `cwd` `hbuilds` enthält, wird automatisch

`…/domains/dart-counter.turniertool.eu/data/steeldart.sqlite`

genutzt (vom cwd nach oben bis zum Ordner `hbuilds`, dann dessen Parent + `data/`). Alternativ **`STEELDART_DB` auf einen absoluten Pfad außerhalb von `versions/` setzen** (empfohlen, dann gilt nur dieser Wert). Der Start loggt den verwendeten Pfad einmal (`sqlite file: …`). sql.js schreibt bei jeder Änderung in diese Datei.

```bash
STEELDART_DB=/home/…/domains/dart-counter.turniertool.eu/data/steeldart.sqlite
```

Kein `--omit=dev` beim Install: der Build braucht Vite und esbuild (`devDependencies`). Volles `npm install` ist korrekt.

Die öffentliche Website `/` bleibt auf **Raum-ID eingeben**, bis jemand eine ID eintippt oder Admin einen Raum eröffnet. Browser **treten nicht automatisch** dem letzten/aktuellen Spiel bei (kein LOCAL, kein „letzter Raum“). Snapshots gehen nur an Sockets nach `joinRoom` / `createRoom`. Optional: QR-Link `https://<server>/?raum=CODE` tritt gezielt diesem Raum bei. `/api/info` liefert im Online-Modus keine LAN-URLs mit internem Port — die Website bleibt same-origin (kein `:3000`).

### Live-Monitor `/monitor`

Unter `https://<server>/monitor` läuft die **Zuschauer-Ansicht** (laufende Spiele, Anlagen-Name — keine Raum-IDs). Nur im Online-Modus. API: `GET /api/monitor`.

### Admin-Passwort

**Raum eröffnen (Semi-Offline)** erscheint erst nach **Admin-Login** (dezenter Link unten rechts). Das Passwort kommt aus der Umgebung:

```bash
export STEELDART_ADMIN_PASSWORD='dein-geheimes-passwort'
STEELDART_MODE=online npm start
```

PowerShell:

```powershell
$env:STEELDART_ADMIN_PASSWORD="dein-geheimes-passwort"
$env:STEELDART_MODE="online"
npm start
```

Ohne gesetzte Variable nutzt der Server den im Code hinterlegten Fallback — **in Produktion immer `STEELDART_ADMIN_PASSWORD` setzen**. Das UI-Login reicht nicht: `createRoom` prüft Passwort oder Admin-Token erneut.

**Desktop:** Unter Admin bzw. auf dem Startbildschirm **Webserver-URL** und **Online-Passwort** (dasselbe wie `STEELDART_ADMIN_PASSWORD`) speichern. Online starten schickt dieses Passwort an `createRoom` — kein zweites Login mit dem lokalen Fallback (`Admin17`) nötig. Dasselbe Online-Passwort kann auch den Desktop-Admin (Teams, Statistik) entsperren.

Maximal **4 Räume gleichzeitig**; der 5. Versuch wird auf Deutsch abgelehnt. Beitreten per ID zählt nicht als Admin und braucht kein Passwort.

Leere Online-Räume bleiben **2 Stunden nach der letzten Aktion** bestehen (auch ohne Desktop-Client). Jede Aktion eines Web-Clients setzt den Timer zurück. Danach räumt der Server den Raum auf. Die 4-Räume-Grenze zählt diese gepufferten Räume mit.

**Desktop Online:** Jede Anlage (eindeutige Board-ID + Name) eröffnet einen **eigenen Raum**. Gespeichert wird `{ serverUrl, roomCode, boardId }` pro Board, nicht global. Beim erneuten Start derselben Anlage innerhalb von 2 Stunden (gleicher Server): dieser Raum. Sonst immer `createRoom` mit neuem Code — nie der Raum einer anderen Anlage. Zwei Desktops → zwei Raum-IDs; Web-Spieler wählen die ID, `/monitor` zeigt beide Scheiben.

**Desktop Offline:** Beim Beenden wird der Spielstand auf die Platte geschrieben. LAN-Beitritt geht nur, solange die App läuft. Beim nächsten Offline-Start innerhalb von 2 Stunden erscheint *„Laufendes Spiel fortsetzen?“* oder *„Neuen Raum erstellen“*.

## Web ohne Desktop (Entwicklung)

```bash
npm run dev
```

Browser: `http://localhost:5173`

## Tests

```bash
npm test
```

## Spiele

- **x01** — 301/501/701/901; Straight/Double In; Straight/Double/Master Out
- **Cricket** — 15–20 + Bull, eigene oder zufällige Zahlen
- **Elimination** — Leben; Score halten oder übertreffen
- **Around the Clock** — 1→20→Bull
- **Shanghai** — Runden 1–N; Shanghai kann sofort gewinnen

Eingabe: **Einzeleingabe** oder **Gesamteingabe** (0–180).
