import type { ClientAction, MatchConfig, MatchState, MatchStatus } from "./types.js";

export type RoomPhase = "setup" | "match";
export type DeployMode = "offline" | "online";

export const STEELDART_APP = "steeldart-counter";

export interface ServerInfo {
  app?: string;
  mode: DeployMode;
  port: number;
  lanUrls: string[];
  roomCount?: number;
  maxRooms?: number;
}

export interface RoomSnapshot {
  code: string;
  mode: "local" | "online";
  phase: RoomPhase;
  config: MatchConfig;
  match: MatchState | null;
  lanUrls: string[];
  clientId: string;
  /** True for the room creator / reconnecting host. Spectators are display-only for ausbullen. */
  isHost?: boolean;
  error?: string;
}

export type WsClientMessage =
  | {
      type: "createRoom";
      mode: "local" | "online";
      config?: MatchConfig;
      password?: string;
      adminToken?: string;
      boardId?: string;
      boardName?: string;
    }
  | { type: "joinRoom"; code: string }
  | { type: "leaveRoom" }
  | { type: "updateConfig"; config: MatchConfig }
  | { type: "startMatch"; boardId?: string; boardName?: string }
  | { type: "toSetup" }
  | { type: "action"; action: ClientAction };

export type WsServerMessage =
  | { type: "snapshot"; snapshot: RoomSnapshot }
  | { type: "error"; message: string };

/** In-progress match on the hosted TV wall — not setup, not finished, not idle. */
export const LIVE_MONITOR_STATUSES: readonly MatchStatus[] = ["playing", "legOver", "setOver", "bullUp"];

export function isLiveMonitorMatch(match: MatchState | null | undefined): boolean {
  if (!match) return false;
  return (LIVE_MONITOR_STATUSES as readonly string[]).includes(match.status);
}

/** Anlagen-Name for the monitor. Never a room/join code. */
export function monitorBoardLabel(boardName?: string | null): string {
  const name = boardName?.trim();
  return name || "Scheibe";
}

/** Compact live-match payload. Room codes are omitted on purpose. */
export interface MonitorGameSnapshot {
  boardName: string | null;
  occupancy: number;
  match: MatchState;
}

export interface MonitorPayload {
  games: MonitorGameSnapshot[];
}
