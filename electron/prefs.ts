import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { isFresh, type LocalSave, type OnlineResume } from "../shared/persist.js";

export const DEFAULT_OFFLINE_PORT = 3000;

export interface DesktopPrefs {
  remoteUrl?: string;
  lastMode?: "offline" | "online";
  onlineResume?: OnlineResume | null;
  offlinePort?: number;
  boardId?: string;
  boardName?: string;
}

function prefsPath(): string {
  return path.join(app.getPath("userData"), "desktop-prefs.json");
}

export function offlineSavePath(): string {
  return path.join(app.getPath("userData"), "offline-save.json");
}

export function statsDbPath(): string {
  return path.join(app.getPath("userData"), "steeldart.sqlite");
}

export function loadPrefs(): DesktopPrefs {
  try {
    const parsed = JSON.parse(fs.readFileSync(prefsPath(), "utf8")) as DesktopPrefs;
    return ensureBoardIdentity(parsed);
  } catch {
    return ensureBoardIdentity({});
  }
}

export function ensureBoardIdentity(prefs: DesktopPrefs): DesktopPrefs {
  let next = prefs;
  let changed = false;
  if (!next.boardId) {
    next = { ...next, boardId: randomUUID() };
    changed = true;
  }
  if (!next.boardName || !next.boardName.trim()) {
    next = { ...next, boardName: "Scheibe 1" };
    changed = true;
  }
  if (changed) {
    fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
    fs.writeFileSync(prefsPath(), `${JSON.stringify(next, null, 2)}\n`);
  }
  return next;
}

export function resetBoardIdentity(): DesktopPrefs {
  return savePrefs({ boardId: randomUUID() });
}

export function savePrefs(patch: DesktopPrefs): DesktopPrefs {
  const next = { ...loadPrefs(), ...patch };
  fs.mkdirSync(path.dirname(prefsPath()), { recursive: true });
  fs.writeFileSync(prefsPath(), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function configuredRemoteUrl(prefs = loadPrefs()): string {
  return (prefs.remoteUrl ?? "").trim();
}

export function isOnlineConfigured(prefs = loadPrefs()): boolean {
  return configuredRemoteUrl(prefs).length > 0;
}

export function offlinePort(prefs = loadPrefs()): number {
  const saved = prefs.offlinePort;
  if (typeof saved === "number" && Number.isInteger(saved) && saved >= 1 && saved <= 65535) {
    return saved;
  }
  const env = Number(process.env.PORT ?? DEFAULT_OFFLINE_PORT);
  if (Number.isInteger(env) && env >= 1 && env <= 65535) return env;
  return DEFAULT_OFFLINE_PORT;
}

export function rememberOnlineRoom(serverUrl: string, roomCode: string): void {
  if (!roomCode || roomCode === "LOCAL") return;
  if (!serverUrl.trim()) return;
  savePrefs({
    remoteUrl: serverUrl,
    lastMode: "online",
    onlineResume: { serverUrl, roomCode, savedAt: Date.now() },
  });
}

export function clearOnlineResume(): void {
  const cur = loadPrefs();
  if (!cur.onlineResume) return;
  savePrefs({ ...cur, onlineResume: null });
}

export function freshOnlineResume(serverUrl: string): OnlineResume | null {
  const resume = loadPrefs().onlineResume;
  if (!resume) return null;
  if (resume.serverUrl.replace(/\/+$/, "") !== serverUrl.replace(/\/+$/, "")) return null;
  if (!isFresh(resume.savedAt)) return null;
  return resume;
}

export function loadOfflineSave(): LocalSave | null {
  try {
    const data = JSON.parse(fs.readFileSync(offlineSavePath(), "utf8")) as LocalSave;
    if (!data?.savedAt || !data.config) return null;
    return data;
  } catch {
    return null;
  }
}

export function freshOfflineSave(): LocalSave | null {
  const save = loadOfflineSave();
  if (!save || !isFresh(save.savedAt)) return null;
  return save;
}

export function clearOfflineSave(): void {
  try {
    fs.unlinkSync(offlineSavePath());
  } catch {
    /* missing is fine */
  }
}
