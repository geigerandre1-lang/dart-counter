# Steeldart Dart-Counter

Zähler für Steeldart-Spiele. Die **Spielregeln liegen immer auf dem Server**. Die Desktop-App und der Browser sind Clients.

## Desktop-App (Windows und Raspberry Pi)

Eigenes Fenster (Electron), kein Browser mit Adressleiste. Dieselbe Codebasis. **Chromium ist nicht nötig** — die portable App *ist* die Desktop-Anwendung.

Beim Start wählst du den Modus:

| Desktop-Modus | Was passiert |
| --- | --- |
| **Offline** | Die App startet einen lokalen Server. Handys öffnen die LAN-IP oder scannen den **QR-Code**. Alle landen im **einen** lokalen Spiel, ohne Raum-ID. Schließen speichert den Stand 2 Stunden; LAN-Beitritt geht nur bei laufender App. |
| **Online** | Kein lokaler Spielserver. Verbindung zum Node-Webserver. Raum bleibt 2h nach letzter Aktion (auch ohne Desktop). Beim erneuten Start innerhalb von 2 Stunden: gleicher Raum. |

Unter Windows: maximiertes App-Fenster, F11 Vollbild, Escape beendet Vollbild. Auf dem Pi (Linux): Kiosk/Vollbild.

Entwicklung aus dem Quellcode:

```bash
npm install
npm run desktop
```

`npm run pi` ist dasselbe. Ohne erneutes Bauen: `npm run electron`.

## Portable Windows-App (ohne Installer)

Auf einem Windows-PC mit Node.js 18+:

```powershell
npm install
npm run dist:win
```

Ergebnis unter `release/`: eine portable `.exe` (x64), z. B. `steeldart-counter-1.0.0-win-x64.exe`. Die Datei irgendwohin kopieren und doppelklicken — **kein Setup, keine Installation**.

Binaries gehören **nicht** ins Git (`release/` und `dist/` stehen in `.gitignore`). Fertige Dateien kommen in GitHub Releases, sofern sie nicht zu groß sind; sonst lokal mit `npm run dist:win` bauen.

## Raspberry Pi OS (64-Bit, Pi 4/5)

Die Linux-ARM-Builds sind Ordner bzw. `.tar.gz` — kein Installer. **Pi 4/5 mit 64-Bit-OS (`arm64`) ist das Ziel.** Pi 3 (`armv7l`) wird mitgebaut, wenn der Rechner das hergibt.

### Auf dem Pi selbst bauen (empfohlen)

Cross-Compile von Windows nach ARM ist oft unzuverlässig (native Module). Am Pi:

```bash
sudo apt update
sudo apt install -y git nodejs npm
git clone https://github.com/geigerandre1-lang/dart-counter.git dart-counter
cd dart-counter
npm install
npm run dist:pi:native
```

`dist:pi` macht dasselbe, überspringt aber das Neuübersetzen nativer Module (Fallback `sql.js` reicht). `dist:pi:native` baut `better-sqlite3` gegen Electron — besser, wenn Compiler-Tools auf dem Pi vorhanden sind.

Ergebnis:

- `release/linux-arm64-unpacked/` — Ordner zum Kopieren
- `release/steeldart-counter-*-linux-arm64.tar.gz` — Archiv zum Verteilen
- analog `linux-armv7l` für 32-Bit (Pi 3)

### Ordner kopieren und starten

1. `linux-arm64-unpacked` (oder das `.tar.gz`) auf den Pi kopieren, z. B. nach `~/steeldart-counter`.
2. Ausführbar machen und starten:

```bash
cd ~/steeldart-counter
chmod +x steeldart-counter start.sh
./start.sh
# oder:
./steeldart-counter
```

Kein Chromium, kein `apt install chromium`. Die Datei `steeldart-counter` *ist* die App.

Von Windows aus (nur Konfiguration testen, oft ohne lauffähige ARM-Binary):

```powershell
npm run dist:pi
```

Wenn electron-builder ARM von Windows nicht packen kann: Quellcode auf den Pi legen und dort `npm run dist:pi` bzw. `dist:pi:native` ausführen.

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

`PORT` nicht von Hand setzen. Optional: `STEELDART_SQLJS=1` (sql.js erzwingen, Native-SQLite gar nicht laden), `STEELDART_DB=/pfad/zur/datei.sqlite`.

Kein `--omit=dev` beim Install: der Build braucht Vite und esbuild (`devDependencies`). Volles `npm install` ist korrekt.

Standardbesucher sehen nur **Raum-ID eingeben** (kein Passwort). Optional: QR-Link `https://<server>/?raum=CODE` tritt automatisch bei.

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

Maximal **4 Räume gleichzeitig**; der 5. Versuch wird auf Deutsch abgelehnt. Beitreten per ID zählt nicht als Admin und braucht kein Passwort.

Leere Online-Räume bleiben **2 Stunden nach der letzten Aktion** bestehen (auch ohne Desktop-Client). Jede Aktion eines Web-Clients setzt den Timer zurück. Danach räumt der Server den Raum auf. Die 4-Räume-Grenze zählt diese gepufferten Räume mit.

**Desktop Online:** Beim erneuten Start innerhalb von 2 Stunden verbindet die App denselben Webserver und dieselbe Raum-ID (lokal gespeichert). Web-Clients können in der Zwischenzeit weiterzählen.

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
