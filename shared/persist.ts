import type { MatchConfig, MatchState } from "./types.js";

export const ROOM_IDLE_MS = 1000 * 60 * 60 * 2;

export interface LocalSave {
  savedAt: number;
  config: MatchConfig;
  match: MatchState | null;
}

export interface OnlineResume {
  serverUrl: string;
  roomCode: string;
  boardId: string;
  savedAt: number;
}

export function isFresh(savedAt: number, now = Date.now(), ttlMs = ROOM_IDLE_MS): boolean {
  return savedAt > 0 && now - savedAt <= ttlMs;
}

export function normalizeServerUrlKey(serverUrl: string): string {
  return serverUrl.trim().replace(/\/+$/, "");
}

/** Resume only this board's room on this server, and only within the 2h window. */
export function resumeMatchesBoard(
  resume: OnlineResume | null | undefined,
  serverUrl: string,
  boardId: string,
  now = Date.now(),
): resume is OnlineResume {
  if (!resume || !boardId || !resume.boardId || resume.boardId !== boardId) return false;
  if (!resume.roomCode || resume.roomCode === "LOCAL") return false;
  if (normalizeServerUrlKey(resume.serverUrl) !== normalizeServerUrlKey(serverUrl)) return false;
  return isFresh(resume.savedAt, now);
}

export function pickBoardResume(
  resumes: Record<string, OnlineResume> | undefined,
  legacy: OnlineResume | null | undefined,
  serverUrl: string,
  boardId: string,
  now = Date.now(),
): OnlineResume | null {
  const fromMap = resumes?.[boardId];
  if (resumeMatchesBoard(fromMap, serverUrl, boardId, now)) return fromMap;
  if (resumeMatchesBoard(legacy, serverUrl, boardId, now)) return legacy;
  return null;
}

export function storeBoardResume(
  resumes: Record<string, OnlineResume> | undefined,
  serverUrl: string,
  roomCode: string,
  boardId: string,
  now = Date.now(),
): Record<string, OnlineResume> {
  const next = { ...(resumes ?? {}) };
  if (!boardId || !roomCode || roomCode === "LOCAL" || !serverUrl.trim()) return next;
  next[boardId] = {
    serverUrl: normalizeServerUrlKey(serverUrl),
    roomCode,
    boardId,
    savedAt: now,
  };
  return next;
}
