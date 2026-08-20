/// <reference types="vite/client" />

interface DesktopSession {
  mode: "offline" | "online";
  origin: string;
  lanUrls: string[];
  resumeCode?: string;
}

type DesktopResult =
  | { ok: true; session: DesktopSession }
  | { ok: false; error: string };

interface DesktopSettingsResult {
  ok: true;
  state: {
    session: DesktopSession | null;
    savedRemoteUrl: string;
    offlinePort: number;
    listenPort?: number | null;
    lastMode?: "offline" | "online";
    onlineConfigured: boolean;
    boardId?: string;
    boardName?: string;
  };
}

interface SteeldartDesktop {
  kiosk: boolean;
  getState?: () => Promise<{
    session: DesktopSession | null;
    savedRemoteUrl: string;
    offlinePort?: number;
    listenPort?: number | null;
    lastMode?: "offline" | "online";
    onlineConfigured?: boolean;
    boardId?: string;
    boardName?: string;
    adminToken?: string | null;
  }>;
  offlineStatus?: () => Promise<{ resume: boolean; savedAt: number | null }>;
  startOffline?: (opts?: { resume?: boolean }) => Promise<DesktopResult>;
  connectOnline?: (url?: string) => Promise<DesktopResult>;
  rememberOnline?: (origin: string, code: string) => Promise<unknown>;
  clearOnlineResume?: () => Promise<unknown>;
  disconnect?: () => Promise<unknown>;
  adminLogin?: (password: string) => Promise<{ ok: true; token: string } | { ok: false; error: string }>;
  saveSettings?: (patch: {
    remoteUrl?: string;
    offlinePort?: number;
    boardName?: string;
    resetBoard?: boolean;
  }) => Promise<DesktopSettingsResult | { ok: false; error: string }>;
  listPlayers?: () => Promise<{ players: { id: string; name: string; createdAt: number }[] }>;
  createPlayer?: (
    name: string,
    passNr?: string | null,
  ) => Promise<{ ok: true; player: { id: string; name: string } } | { ok: false; error: string }>;
  listTeams?: () => Promise<{ teams: import("./lib/statsApi").TeamTree[] }>;
  mutateTeam?: (
    action: "create" | "rename" | "delete",
    payload: { id?: string; name?: string },
  ) => Promise<{ ok: boolean; error?: string }>;
  setPlayerTeam?: (playerId: string, teamId: string | null) => Promise<{ ok: boolean }>;
  createTeamPlayer?: (
    teamId: string,
    name: string,
    passNr?: string | null,
  ) => Promise<{ ok: true; player: { id: string; name: string } } | { ok: false; error: string }>;
  removePlayerFromTeam?: (
    playerId: string,
    teamId: string,
    keepRecord?: boolean,
  ) => Promise<{ ok: boolean; deleted?: boolean; warning?: string; error?: string }>;
  importRoster?: (csv: string) => Promise<import("./lib/statsApi").RosterImportResult>;
  listSpieltage?: () => Promise<{ spieltage: import("./lib/statsApi").SpieltagListItem[] }>;
  getSpieltag?: (id: string) => Promise<import("./lib/statsApi").SpieltagDetail | null>;
  rebuildTodaySpieltag?: () => Promise<import("./lib/statsApi").SpieltagDetail | null>;
  startNewSpieltag?: () => Promise<import("./lib/statsApi").SpieltagDetail | null>;
  headToHead?: () => Promise<{ rows: import("./lib/statsApi").HeadToHeadRow[] }>;
  listStats?: () => Promise<{
    players: unknown[];
    rule?: string;
    spieltage?: import("./lib/statsApi").SpieltagListItem[];
    headToHead?: import("./lib/statsApi").HeadToHeadRow[];
  }>;
  playerStats?: (playerId: string) => Promise<unknown>;
  deletePlayer?: (playerId: string) => Promise<{ ok: boolean }>;
  resetStats?: (playerId?: string) => Promise<{ ok: boolean }>;
  exportStats?: (format?: string) => Promise<
    { format: "csv"; csv: string } | { format: "json"; data: unknown }
  >;
}

interface Window {
  steeldartDesktop?: SteeldartDesktop;
}
