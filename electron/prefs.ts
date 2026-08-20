import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { app } from "electron";
import { isFresh, pickBoardResume, storeBoardResume, type LocalSave, type OnlineResume } from "../shared/persist.js";

export const DEFAULT_OFFLINE_PORT = 3000;

export interface DesktopPrefs {
  remoteUrl?: string;
  /** Hosted-server admin password for auto createRoom. */
  adminPassword?: string;
  lastMode?: "offline" | "online";
  /** @deprecated keyed map in onlineResumes — kept to migrate one-board installs */
  onlineResume?: OnlineResume | null;
  onlineResumes?: Record<string, OnlineResume>;
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
  const boardId = next.boardId!;
  const resumes = { ...(next.onlineResumes ?? {}) };
  const legacy = next.onlineResume;
  if (legacy?.roomCode && legacy.roomCode !== "LOCAL") {
    const legacyId = legacy.boardId || boardId;
    if (legacyId === boardId && !resumes[boardId]) {
      resumes[boardId] = {
        serverUrl: legacy.serverUrl,
        roomCode: legacy.roomCode,
        boardId,
        savedAt: legacy.savedAt,
      };
      next = { ...next, onlineResumes: resumes, onlineResume: resumes[boardId] };
      changed = true;
    }
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

export function configuredAdminPassword(prefs = loadPrefs()): string {
  const stored = (prefs.adminPassword ?? "").trim();
  if (stored) return stored;
  const env = String(process.env.STEELDART_ADMIN_PASSWORD ?? "")
    .replace(/^\uFEFF/, "")
    .trim();
  if (env.length >= 2) {
    const quote = env[0];
    if ((quote === '"' || quote === "'") && env[env.length - 1] === quote) {
      return env.slice(1, -1).trim();
    }
  }
  return env;
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

export function rememberOnlineRoom(serverUrl: string, roomCode: string, boardId?: string): void {
  const prefs = loadPrefs();
  const id = (boardId || prefs.boardId || "").trim();
  if (!id || !roomCode || roomCode === "LOCAL") return;
  if (!serverUrl.trim()) return;
  const onlineResumes = storeBoardResume(prefs.onlineResumes, serverUrl, roomCode, id);
  savePrefs({
    remoteUrl: serverUrl,
    lastMode: "online",
    onlineResumes,
    onlineResume: onlineResumes[id] ?? null,
  });
}

export function clearOnlineResume(boardId?: string): void {
  const cur = loadPrefs();
  const id = (boardId || cur.boardId || "").trim();
  const onlineResumes = { ...(cur.onlineResumes ?? {}) };
  if (id) delete onlineResumes[id];
  const clearLegacy = !cur.onlineResume?.boardId || cur.onlineResume.boardId === id;
  savePrefs({
    onlineResumes,
    onlineResume: clearLegacy ? null : cur.onlineResume,
  });
}

export function freshOnlineResume(serverUrl: string, boardId?: string): OnlineResume | null {
  const prefs = loadPrefs();
  const id = (boardId || prefs.boardId || "").trim();
  if (!id) return null;
  return pickBoardResume(prefs.onlineResumes, prefs.onlineResume ?? null, serverUrl, id);
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
