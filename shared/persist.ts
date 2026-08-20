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
  savedAt: number;
}

export function isFresh(savedAt: number, now = Date.now(), ttlMs = ROOM_IDLE_MS): boolean {
  return savedAt > 0 && now - savedAt <= ttlMs;
}
