import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, Menu, ipcMain, screen } from "electron";
import { adminTokenValid, getAdminPassword, issueAdminToken, passwordsMatch } from "../server/admin.js";
import { findPublicDir, startServer, STEELDART_APP, type StartedServer } from "../server/app.js";
import { openStatsStore, type StatsStore } from "../server/store.js";
import {
  clearOfflineSave,
  clearOnlineResume,
  configuredRemoteUrl,
  freshOfflineSave,
  freshOnlineResume,
  isOnlineConfigured,
  loadPrefs,
  offlinePort,
  offlineSavePath,
  rememberOnlineRoom,
  resetBoardIdentity,
  savePrefs,
  statsDbPath,
  configuredAdminPassword,
} from "./prefs.js";

export interface DesktopSession {
  mode: "offline" | "online";
  origin: string;
  lanUrls: string[];
  resumeCode?: string;
  adminPassword?: string;
}

let owned: StartedServer | null = null;
let session: DesktopSession | null = null;
let mainWindow: BrowserWindow | null = null;
let quitting = false;
let localStore: StatsStore | null = null;
let issuedAdminToken: string | null = null;

function isKioskPreferred(): boolean {
  if (process.env.STEELDART_KIOSK === "0") return false;
  if (process.env.STEELDART_KIOSK === "1") return true;
  return process.platform === "linux";
}

function clientIndex(): string {
  const candidates = [
    path.join(app.getAppPath(), "dist", "client", "index.html"),
    path.join(process.cwd(), "dist", "client", "index.html"),
  ];
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  throw new Error("UI-Build fehlt (dist/client/index.html). Bitte npm run build ausführen.");
}

function publicDir(): string | null {
  return (
    findPublicDir(path.join(app.getAppPath(), "dist", "client")) ??
    findPublicDir(path.join(process.cwd(), "dist", "client"))
  );
}

function currentPort(): number {
  return offlinePort();
}

function desktopState() {
  const prefs = loadPrefs();
  const listenPort =
    owned?.port ??
    (session?.mode === "offline" && session.origin
      ? Number(new URL(session.origin).port) || null
      : null);
  return {
    session,
    savedRemoteUrl: configuredRemoteUrl(prefs),
    offlinePort: offlinePort(prefs),
    listenPort,
    lastMode: prefs.lastMode ?? "offline",
    onlineConfigured: isOnlineConfigured(prefs),
    boardId: prefs.boardId ?? "",
    boardName: prefs.boardName ?? "Scheibe 1",
    adminPasswordSet: Boolean(configuredAdminPassword(prefs)),
    adminToken: issuedAdminToken && adminTokenValid(issuedAdminToken) ? issuedAdminToken : null,
  };
}

function normalizeServerUrl(input: string): string {
  let raw = input.trim();
  if (!raw) throw new Error("Bitte die Webserver-URL eingeben.");
  if (!/^https?:\/\//i.test(raw)) raw = `http://${raw}`;
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Nur http:// oder https:// sind erlaubt.");
  }
  return url.origin;
}

async function fetchInfo(origin: string): Promise<{ mode?: string; lanUrls?: string[]; app?: string } | null> {
  try {
    const res = await fetch(`${origin}/api/info`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) return null;
    const data = (await res.json()) as { mode?: string; lanUrls?: string[]; app?: string };
    if (data.app !== STEELDART_APP) return null;
    return data;
  } catch {
    return null;
  }
}

async function closeLocalStore(): Promise<void> {
  if (!localStore) return;
  const closing = localStore;
  localStore = null;
  try {
    closing.close();
  } catch {
    /* ignore */
  }
}

async function getStore(): Promise<StatsStore> {
  if (owned) return owned.store;
  process.env.STEELDART_DB = statsDbPath();
  if (!localStore) localStore = await openStatsStore(statsDbPath());
  return localStore;
}

async function loadClient(win: BrowserWindow): Promise<void> {
  if (session?.mode === "offline" && session.origin) {
    try {
      await win.loadURL(session.origin);
      return;
    } catch (err) {
      console.error("UI vom lokalen Server konnte nicht geladen werden:", err);
    }
  }
  await win.loadFile(clientIndex());
}

async function shutdownOwnedServer(): Promise<void> {
  if (!owned) return;
  const closing = owned;
  owned = null;
  try {
    await closing.close();
  } catch (err) {
    console.error("Server ließ sich nicht sauber beenden:", err);
  }
}

async function startOffline(opts: { resume?: boolean } = {}): Promise<DesktopSession> {
  if (session?.mode === "offline" && owned) return session;

  await closeLocalStore();
  await shutdownOwnedServer();
  process.env.STEELDART_MODE = "offline";
  process.env.STEELDART_DB = statsDbPath();

  const port = currentPort();
  const restore = opts.resume ? freshOfflineSave() : null;
  if (!opts.resume) clearOfflineSave();

  try {
    owned = await startServer({
      port,
      publicDir: publicDir(),
      mode: "offline",
      persistPath: offlineSavePath(),
      restore,
      dbPath: statsDbPath(),
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EADDRINUSE") {
      throw new Error(
        `Ports ${port}–${port + 10} sind belegt. Andere App beenden oder den Offline-Port im Admin-Menü ändern.`,
      );
    }
    throw err;
  }
  session = {
    mode: "offline",
    origin: `http://127.0.0.1:${owned.port}`,
    lanUrls: owned.lanUrls,
  };
  savePrefs({ lastMode: "offline" });
  return session;
}

async function connectOnline(rawUrl?: string): Promise<DesktopSession> {
  const configured = (rawUrl ?? configuredRemoteUrl()).trim();
  if (!configured) {
    throw new Error("Keine Webserver-URL konfiguriert. Bitte im Admin-Menü die Online-Server-URL setzen.");
  }
  const origin = normalizeServerUrl(configured);
  const info = await fetchInfo(origin);
  if (!info) {
    throw new Error(`Server unter ${origin} nicht erreichbar.`);
  }
  if (info.mode !== "online") {
    throw new Error(
      "Dieser Server läuft nicht im Online-Modus. Auf dem Webserver: STEELDART_MODE=online npm start",
    );
  }

  try {
    const store = await getStore();
    const pending = store.listUnsyncedReports();
    if (pending.length) {
      const prefs = loadPrefs();
      await fetch(`${origin}/api/reports/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reports: pending,
          boardId: prefs.boardId,
          boardName: prefs.boardName,
        }),
        signal: AbortSignal.timeout(8000),
      });
      store.markReportsSynced(pending.map((r) => r.id));
    }
  } catch (err) {
    console.warn("Tagesberichte konnten nicht synchronisiert werden:", err);
  }

  await closeLocalStore();
  await shutdownOwnedServer();
  const resume = freshOnlineResume(origin);
  session = {
    mode: "online",
    origin,
    lanUrls: [],
    resumeCode: resume?.roomCode,
    adminPassword: configuredAdminPassword() || undefined,
  };
  savePrefs({ lastMode: "online", remoteUrl: origin });
  return session;
}

async function disconnectSession(): Promise<void> {
  session = null;
  await shutdownOwnedServer();
}

function createWindow(): BrowserWindow {
  const display = screen.getPrimaryDisplay();
  const { width, height } = display.workAreaSize;
  const kiosk = isKioskPreferred();

  const win = new BrowserWindow({
    width: Math.max(1100, Math.min(width, 1400)),
    height: Math.max(700, Math.min(height, 900)),
    fullscreen: kiosk,
    kiosk,
    frame: !kiosk,
    autoHideMenuBar: true,
    backgroundColor: "#05070d",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setMenuBarVisibility(false);
  void loadClient(win);

  win.once("ready-to-show", () => {
    win.show();
    if (kiosk) win.setFullScreen(true);
    else win.maximize();
  });

  win.webContents.on("before-input-event", (event, input) => {
    if (input.type !== "keyDown") return;
    if (input.key === "F11") {
      event.preventDefault();
      win.setKiosk(false);
      win.setFullScreen(!win.isFullScreen());
    }
    if (input.key === "Escape" && !kiosk && win.isFullScreen()) {
      event.preventDefault();
      win.setFullScreen(false);
    }
  });

  win.webContents.on("render-process-gone", (_evt, details) => {
    console.error("Renderer beendet:", details.reason, details.exitCode);
    if (quitting) return;
    if (details.reason === "crashed" || details.reason === "oom" || details.reason === "killed") {
      win.reload();
    }
  });

  win.on("closed", () => {
    if (mainWindow === win) mainWindow = null;
  });

  return win;
}

function registerIpc(): void {
  ipcMain.handle("desktop:getState", () => desktopState());

  ipcMain.handle("desktop:offlineStatus", () => {
    const save = freshOfflineSave();
    return { resume: Boolean(save), savedAt: save?.savedAt ?? null };
  });

  ipcMain.handle("desktop:startOffline", async (_evt, opts?: { resume?: boolean }) => {
    try {
      const next = await startOffline({ resume: Boolean(opts?.resume) });
      const win = mainWindow;
      if (win && !win.isDestroyed()) {
        setImmediate(() => {
          void loadClient(win);
        });
      }
      return { ok: true as const, session: next };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("desktop:connectOnline", async (_evt, url?: string) => {
    try {
      if (!isOnlineConfigured() && !String(url ?? "").trim()) {
        return { ok: false as const, error: "Online ist nicht konfiguriert." };
      }
      const next = await connectOnline(String(url ?? configuredRemoteUrl()));
      return { ok: true as const, session: next };
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle("desktop:rememberOnline", (_evt, payload: { origin?: string; code?: string }) => {
    const origin = String(payload?.origin ?? "");
    const code = String(payload?.code ?? "");
    if (origin && code) rememberOnlineRoom(origin, code);
  });

  ipcMain.handle("desktop:clearOnlineResume", () => {
    clearOnlineResume();
  });

  ipcMain.handle("desktop:disconnect", async () => {
    await disconnectSession();
    const win = mainWindow;
    if (win && !win.isDestroyed()) {
      setImmediate(() => {
        void loadClient(win);
      });
    }
    return { ok: true as const };
  });

  ipcMain.handle("desktop:adminLogin", (_evt, password: string) => {
    if (!passwordsMatch(String(password ?? ""), getAdminPassword())) {
      return { ok: false as const, error: "Falsches Passwort." };
    }
    const token = issueAdminToken();
    issuedAdminToken = token;
    return { ok: true as const, token };
  });

  ipcMain.handle(
    "desktop:saveSettings",
    async (
      _evt,
      patch: {
        remoteUrl?: string;
        offlinePort?: number;
        boardName?: string;
        resetBoard?: boolean;
        adminPassword?: string;
      },
    ) => {
    const remoteUrl = typeof patch?.remoteUrl === "string" ? patch.remoteUrl.trim() : configuredRemoteUrl();
    let port = offlinePort();
    if (typeof patch?.offlinePort === "number") {
      if (!Number.isInteger(patch.offlinePort) || patch.offlinePort < 1 || patch.offlinePort > 65535) {
        return { ok: false as const, error: "Port muss zwischen 1 und 65535 liegen." };
      }
      port = patch.offlinePort;
    }
    if (patch?.resetBoard) resetBoardIdentity();
    const prev = loadPrefs();
    const next = savePrefs({
      remoteUrl,
      offlinePort: port,
      lastMode: remoteUrl ? prev.lastMode : "offline",
      onlineResume: remoteUrl ? prev.onlineResume : null,
      boardName: typeof patch?.boardName === "string" && patch.boardName.trim() ? patch.boardName.trim() : prev.boardName,
      adminPassword:
        typeof patch?.adminPassword === "string"
          ? patch.adminPassword.trim() || prev.adminPassword
          : prev.adminPassword,
    });
    if (!remoteUrl && session?.mode === "online") {
      await disconnectSession();
    }
    return { ok: true as const, state: desktopState(), prefs: next };
  });

  ipcMain.handle("desktop:listTeams", async () => {
    const store = await getStore();
    return { teams: store.listTeamTree() };
  });

  ipcMain.handle(
    "desktop:mutateTeam",
    async (_evt, action: "create" | "rename" | "delete", payload: { id?: string; name?: string }) => {
      const store = await getStore();
      if (action === "create") return store.createTeam(String(payload?.name ?? ""));
      if (action === "rename" && payload?.id) return store.renameTeam(payload.id, String(payload.name ?? ""));
      if (action === "delete" && payload?.id) return store.deleteTeam(payload.id);
      return { ok: false };
    },
  );

  ipcMain.handle("desktop:setPlayerTeam", async (_evt, playerId: string, teamId: string | null) => {
    const store = await getStore();
    return store.setPlayerTeam(String(playerId ?? ""), teamId == null || teamId === "" ? null : String(teamId));
  });

  ipcMain.handle(
    "desktop:createTeamPlayer",
    async (_evt, teamId: string, name: string, passNr?: string | null) => {
      const store = await getStore();
      return store.createTeamPlayer(String(teamId ?? ""), String(name ?? ""), passNr ?? null);
    },
  );

  ipcMain.handle(
    "desktop:removePlayerFromTeam",
    async (_evt, playerId: string, teamId: string, keepRecord?: boolean) => {
      const store = await getStore();
      return store.removePlayerFromTeam(String(playerId ?? ""), String(teamId ?? ""), {
        keepRecord: Boolean(keepRecord),
      });
    },
  );

  ipcMain.handle("desktop:importRoster", async (_evt, csv: string) => {
    const store = await getStore();
    return store.importRoster(String(csv ?? ""));
  });

  ipcMain.handle("desktop:listSpieltage", async () => {
    const store = await getStore();
    return { spieltage: store.listSpieltage() };
  });

  ipcMain.handle("desktop:getSpieltag", async (_evt, id: string) => {
    const store = await getStore();
    return store.getSpieltag(String(id ?? "")) ?? null;
  });

  ipcMain.handle("desktop:rebuildTodaySpieltag", async () => {
    const store = await getStore();
    return store.rebuildTodaySpieltag(session?.mode === "online" ? "online" : "offline");
  });

  ipcMain.handle("desktop:startNewSpieltag", async () => {
    const store = await getStore();
    return store.startNewSpieltag(session?.mode === "online" ? "online" : "offline");
  });

  ipcMain.handle("desktop:headToHead", async () => {
    const store = await getStore();
    return { rows: store.headToHead() };
  });

  ipcMain.handle("desktop:listStats", async () => {
    const store = await getStore();
    return {
      players: store.listPlayerStats(),
      rule: "3-Dart-Average: 3 × Punkte / geworfene Darts. Busts geben 0 Punkte, die Darts zählen mit. First-3 = erste Aufnahme je Leg, First-9 = erste drei Aufnahmen je Leg.",
      spieltage: store.listSpieltage(),
      headToHead: store.headToHead(),
    };
  });

  ipcMain.handle("desktop:listPlayers", async () => {
    const store = await getStore();
    return { players: store.listPlayers() };
  });

  ipcMain.handle("desktop:createPlayer", async (_evt, name: string, passNr?: string | null) => {
    try {
      const store = await getStore();
      return store.createPlayer(String(name ?? ""), { passNr: passNr ?? null });
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : "Spieler konnte nicht angelegt werden.",
      };
    }
  });

  ipcMain.handle("desktop:playerStats", async (_evt, playerId: string) => {
    const store = await getStore();
    return store.playerStats(String(playerId ?? "")) ?? null;
  });

  ipcMain.handle("desktop:deletePlayer", async (_evt, playerId: string) => {
    const store = await getStore();
    return { ok: store.deletePlayer(String(playerId ?? "")) };
  });

  ipcMain.handle("desktop:resetStats", async (_evt, playerId?: string) => {
    const store = await getStore();
    if (playerId) return { ok: store.resetPlayerStats(String(playerId)) };
    store.resetAllStats();
    return { ok: true };
  });

  ipcMain.handle("desktop:exportStats", async (_evt, format?: string) => {
    const store = await getStore();
    if (String(format ?? "json").toLowerCase() === "csv") {
      return { format: "csv" as const, csv: store.exportCsv() };
    }
    return { format: "json" as const, data: store.exportData() };
  });
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  console.error("Steeldart Dart-Counter läuft bereits. Das bestehende Fenster wird in den Vordergrund geholt.");
  app.quit();
} else {
  if (process.platform === "win32") {
    app.disableHardwareAcceleration();
  }

  app.on("second-instance", () => {
    if (!mainWindow) {
      mainWindow = createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  app.on("before-quit", (event) => {
    if ((!owned && !localStore) || quitting) return;
    event.preventDefault();
    quitting = true;
    const force = setTimeout(() => app.exit(0), 4000);
    void Promise.all([shutdownOwnedServer(), closeLocalStore()]).finally(() => {
      clearTimeout(force);
      app.exit(0);
    });
  });

  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(null);
    process.env.STEELDART_DB = statsDbPath();
    registerIpc();
    try {
      if (isKioskPreferred()) {
        await startOffline({ resume: Boolean(freshOfflineSave()) });
      }
      mainWindow = createWindow();
    } catch (err) {
      console.error(err);
      app.exit(1);
    }
  });
}
