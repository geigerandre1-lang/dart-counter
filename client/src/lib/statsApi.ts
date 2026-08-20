import type { GameType, Player, PlayerVisitStats, ServerInfo } from "@shared/index";
import { apiOriginFromPage, formatPlayerPassLabel, STEELDART_APP } from "@shared/index";
import { loadAdminToken } from "./adminSession";

export interface RegisteredPlayer extends Player {
  createdAt: number;
}

export interface LifetimeRow extends PlayerVisitStats {
  playerId: string;
  matches: number;
}

export interface StoredMatchAnalysis {
  id: string;
  matchId: string;
  playedAt: number;
  mode: "offline" | "online";
  gameType: GameType;
  opponents: Player[];
  playerStats: Record<string, PlayerVisitStats>;
}

export interface PlayerStatsView {
  player: RegisteredPlayer;
  lifetime: LifetimeRow;
  analyses: StoredMatchAnalysis[];
}

export interface TeamTree {
  id: string;
  name: string;
  createdAt: number;
  players: RegisteredPlayer[];
  builtIn?: boolean;
}

export interface RosterImportResult {
  ok: boolean;
  imported: number;
  updated: number;
  createdTeams: string[];
  errors: string[];
  summary: string;
}

export interface SpieltagListItem {
  id: string;
  dateKey: string;
  startedAt: number;
  updatedAt: number;
  mode: string;
  matchCount: number;
  roomCount: number;
  summary: string;
}

export interface SpieltagDetail extends SpieltagListItem {
  rooms: string[];
  boards: { id: string; name: string; lastSeen: number; matches: number }[];
  reports: Array<{
    id: string;
    playedAt: number;
    boardName: string | null;
    summary: string;
    payload: {
      players: Player[];
      scoreline: string;
      endstand?: string;
      matchNumber?: number;
      headline?: string;
      dartsThrown: number;
      roundCount: number;
      checkout: number | null;
      winnerName: string;
      legs?: Array<{
        legNumber: number;
        winnerId?: string;
        winnerName: string;
        starterId?: string;
        starterName: string;
        setNumber?: number;
        opponentRemainingLabel: string;
        winnerDarts: number;
        playerDarts: Record<string, number>;
        checkout: number | null;
        winnerAverage: number;
      }>;
    };
  }>;
  html: string;
}

export interface HeadToHeadRow {
  winnerId: string;
  winnerName: string;
  loserId: string;
  loserName: string;
  wins: number;
}

export interface RoomInfo {
  code: string;
  phase: string;
  occupancy: number;
  status?: string | null;
}

export function apiUrl(base: string, path: string): string {
  if (!base) return path;
  return `${base.replace(/\/+$/, "")}${path}`;
}

function isHttpOrigin(origin: string | null | undefined): boolean {
  return Boolean(origin && /^https?:\/\//i.test(origin));
}

function headers(token = loadAdminToken()): HeadersInit {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/** IPC only when there is no HTTP API origin — otherwise one SQLite via the server. */
export function useDesktopStore(desktop: SteeldartDesktop | undefined, origin: string | null): boolean {
  return Boolean(desktop?.createPlayer) && !isHttpOrigin(origin);
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error("Server nicht erreichbar. Läuft der Desktop/Offline-Server?");
  }
  if (!res.ok) {
    throw new Error(`API-Fehler (${res.status}).`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    throw new Error("Ungültige Antwort vom Server.");
  }
}

export async function fetchServerInfo(apiBase = ""): Promise<ServerInfo> {
  const info = await fetchJson<ServerInfo>(apiUrl(apiBase, "/api/info"));
  if (info.app && info.app !== STEELDART_APP) {
    throw new Error("Das ist kein Steeldart-Server.");
  }
  return info;
}

export async function discoverServerInfo(
  page: Pick<Location, "protocol" | "hostname" | "port" | "origin"> = window.location,
): Promise<{ info: ServerInfo; origin: string }> {
  const tryBase = async (base: string) => {
    const info = await fetchServerInfo(base);
    const origin = apiOriginFromPage(page, info.port) || base;
    return { info, origin };
  };
  try {
    return await tryBase("");
  } catch {
    /* probe ports when the page host is not the API (Vite 5173, wrong proxy) */
  }
  if (page.protocol === "file:") {
    throw new Error("Lokaler Server nicht erreichbar.");
  }
  const preferred = page.port ? Number(page.port) : 3000;
  const ports = [preferred, ...Array.from({ length: 11 }, (_, i) => 3000 + i)].filter(
    (port, index, all) => Number.isInteger(port) && port > 0 && all.indexOf(port) === index,
  );
  for (const port of ports) {
    try {
      return await tryBase(`${page.protocol}//${page.hostname}:${port}`);
    } catch {
      continue;
    }
  }
  throw new Error("Server nicht erreichbar. Läuft der Desktop/Offline-Server?");
}

async function parsePlayerResult(
  res: Response,
): Promise<{ ok: true; player: RegisteredPlayer } | { ok: false; error: string }> {
  try {
    const data = (await res.json()) as { ok?: boolean; player?: RegisteredPlayer; error?: string };
    if (data?.ok && data.player) return { ok: true, player: data.player };
    if (res.status === 401) return { ok: false, error: data?.error || "Nicht angemeldet. Bitte erneut im Admin anmelden." };
    return { ok: false, error: data?.error || "Spieler konnte nicht angelegt werden." };
  } catch {
    return { ok: false, error: "Spieler konnte nicht angelegt werden." };
  }
}

export async function fetchPlayers(
  apiBase: string,
  desktop?: SteeldartDesktop,
  origin?: string | null,
): Promise<RegisteredPlayer[]> {
  if (useDesktopStore(desktop, origin ?? (apiBase || null))) {
    const data = await desktop!.listPlayers!();
    return data.players as RegisteredPlayer[];
  }
  const data = await fetchJson<{ players?: RegisteredPlayer[] }>(apiUrl(apiBase, "/api/players"));
  if (!Array.isArray(data.players)) {
    throw new Error("Spieler konnten nicht geladen werden.");
  }
  return data.players;
}

export async function createPlayer(
  name: string,
  apiBase: string,
  desktop?: SteeldartDesktop,
  origin?: string | null,
  passNr?: string | null,
): Promise<{ ok: true; player: RegisteredPlayer } | { ok: false; error: string }> {
  try {
    if (useDesktopStore(desktop, origin ?? (apiBase || null))) {
      const result = await desktop!.createPlayer!(name, passNr);
      if (result && typeof result === "object" && "ok" in result) {
        return result as { ok: true; player: RegisteredPlayer } | { ok: false; error: string };
      }
      return { ok: false, error: "Spieler konnte nicht angelegt werden." };
    }
    const res = await fetch(apiUrl(apiBase, "/api/players"), {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name, passNr: passNr || null }),
    });
    return parsePlayerResult(res);
  } catch {
    return { ok: false, error: "Spieler konnte nicht angelegt werden. Ist der Server erreichbar?" };
  }
}

export async function fetchStats(
  apiBase: string,
  desktop?: SteeldartDesktop,
  origin?: string | null,
): Promise<{ players: PlayerStatsView[]; rule?: string; spieltage?: SpieltagListItem[]; headToHead?: HeadToHeadRow[] }> {
  if (useDesktopStore(desktop, origin ?? (apiBase || null))) {
    return desktop!.listStats!() as Promise<{
      players: PlayerStatsView[];
      rule?: string;
      spieltage?: SpieltagListItem[];
      headToHead?: HeadToHeadRow[];
    }>;
  }
  const data = await fetchJson<{
    players?: PlayerStatsView[];
    rule?: string;
    spieltage?: SpieltagListItem[];
    headToHead?: HeadToHeadRow[];
  }>(apiUrl(apiBase, "/api/stats"));
  if (!Array.isArray(data.players)) {
    throw new Error("Statistiken konnten nicht geladen werden.");
  }
  return {
    players: data.players,
    rule: data.rule,
    spieltage: data.spieltage,
    headToHead: data.headToHead,
  };
}

export async function deletePlayerApi(
  playerId: string,
  apiBase: string,
  token: string | null,
  desktop?: SteeldartDesktop,
  origin?: string | null,
): Promise<boolean> {
  if (useDesktopStore(desktop, origin ?? (apiBase || null))) {
    const result = await desktop!.deletePlayer!(playerId);
    return Boolean(result.ok);
  }
  const res = await fetch(apiUrl(apiBase, `/api/admin/players/${encodeURIComponent(playerId)}`), {
    method: "DELETE",
    headers: headers(token),
  });
  return res.ok;
}

export async function resetStatsApi(
  playerId: string | undefined,
  apiBase: string,
  token: string | null,
  desktop?: SteeldartDesktop,
  origin?: string | null,
): Promise<boolean> {
  if (useDesktopStore(desktop, origin ?? (apiBase || null))) {
    const result = await desktop!.resetStats!(playerId);
    return Boolean(result.ok);
  }
  const res = await fetch(apiUrl(apiBase, "/api/admin/stats/reset"), {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ token, playerId }),
  });
  return res.ok;
}

export async function exportStatsApi(
  format: "json" | "csv",
  apiBase: string,
  token: string | null,
  desktop?: SteeldartDesktop,
  origin?: string | null,
): Promise<{ format: "csv"; csv: string } | { format: "json"; data: unknown }> {
  if (useDesktopStore(desktop, origin ?? (apiBase || null))) {
    return desktop!.exportStats!(format);
  }
  const res = await fetch(apiUrl(apiBase, `/api/admin/export?format=${format}`), { headers: headers(token) });
  if (format === "csv") {
    return { format: "csv", csv: await res.text() };
  }
  return { format: "json", data: await res.json() };
}

export async function fetchRooms(apiBase: string, token: string | null): Promise<RoomInfo[]> {
  const res = await fetch(apiUrl(apiBase, "/api/admin/rooms"), { headers: headers(token) });
  if (!res.ok) return [];
  const data = (await res.json()) as { rooms?: RoomInfo[] };
  return data.rooms ?? [];
}

export async function deleteRoomApi(code: string, apiBase: string, token: string | null): Promise<boolean> {
  const res = await fetch(apiUrl(apiBase, `/api/admin/rooms/${encodeURIComponent(code)}`), {
    method: "DELETE",
    headers: headers(token),
  });
  return res.ok;
}

export function downloadText(filename: string, text: string, mime: string): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export async function fetchTeams(
  apiBase: string,
  desktop?: SteeldartDesktop,
  origin?: string | null,
): Promise<TeamTree[]> {
  if (useDesktopStore(desktop, origin ?? (apiBase || null)) && desktop?.listTeams) {
    const data = await desktop.listTeams();
    return data.teams;
  }
  const data = await fetchJson<{ teams?: TeamTree[] }>(apiUrl(apiBase, "/api/teams"));
  if (!Array.isArray(data.teams)) {
    throw new Error("Teams konnten nicht geladen werden.");
  }
  return data.teams;
}

export async function mutateTeam(
  action: "create" | "rename" | "delete",
  apiBase: string,
  token: string | null,
  payload: { id?: string; name?: string },
  desktop?: SteeldartDesktop,
  origin?: string | null,
): Promise<boolean> {
  if (useDesktopStore(desktop, origin ?? (apiBase || null)) && desktop?.mutateTeam) {
    const result = await desktop.mutateTeam(action, payload);
    return Boolean(result?.ok);
  }
  if (action === "create") {
    const res = await fetch(apiUrl(apiBase, "/api/admin/teams"), {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ name: payload.name }),
    });
    return res.ok;
  }
  if (action === "rename" && payload.id) {
    const res = await fetch(apiUrl(apiBase, `/api/admin/teams/${encodeURIComponent(payload.id)}`), {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ name: payload.name }),
    });
    return res.ok;
  }
  if (action === "delete" && payload.id) {
    const res = await fetch(apiUrl(apiBase, `/api/admin/teams/${encodeURIComponent(payload.id)}`), {
      method: "DELETE",
      headers: headers(token),
    });
    return res.ok;
  }
  return false;
}

export async function assignPlayerTeamApi(
  playerId: string,
  teamId: string | null,
  apiBase: string,
  token: string | null,
  desktop?: SteeldartDesktop,
  origin?: string | null,
): Promise<boolean> {
  if (useDesktopStore(desktop, origin ?? (apiBase || null)) && desktop?.setPlayerTeam) {
    const result = await desktop.setPlayerTeam(playerId, teamId);
    return Boolean(result?.ok);
  }
  const res = await fetch(apiUrl(apiBase, `/api/admin/players/${encodeURIComponent(playerId)}/team`), {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({ teamId }),
  });
  return res.ok;
}

export async function createTeamPlayerApi(
  teamId: string,
  name: string,
  apiBase: string,
  token: string | null,
  desktop?: SteeldartDesktop,
  origin?: string | null,
  passNr?: string | null,
): Promise<{ ok: true; player: RegisteredPlayer } | { ok: false; error: string }> {
  try {
    if (useDesktopStore(desktop, origin ?? (apiBase || null)) && desktop?.createTeamPlayer) {
      const result = await desktop.createTeamPlayer(teamId, name, passNr);
      if (result && typeof result === "object" && "ok" in result) {
        return result as { ok: true; player: RegisteredPlayer } | { ok: false; error: string };
      }
      return { ok: false, error: "Spieler konnte nicht angelegt werden." };
    }
    const res = await fetch(apiUrl(apiBase, `/api/admin/teams/${encodeURIComponent(teamId)}/players`), {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ name, passNr: passNr || null }),
    });
    return parsePlayerResult(res);
  } catch {
    return { ok: false, error: "Spieler konnte nicht angelegt werden. Ist der Server erreichbar?" };
  }
}

export async function removePlayerFromTeamApi(
  playerId: string,
  teamId: string,
  apiBase: string,
  token: string | null,
  desktop?: SteeldartDesktop,
  origin?: string | null,
): Promise<{ ok: boolean; deleted?: boolean; warning?: string; error?: string }> {
  try {
    if (useDesktopStore(desktop, origin ?? (apiBase || null)) && desktop?.removePlayerFromTeam) {
      return desktop.removePlayerFromTeam(playerId, teamId);
    }
    const res = await fetch(apiUrl(apiBase, `/api/admin/players/${encodeURIComponent(playerId)}/remove-from-team`), {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ teamId }),
    });
    const data = (await res.json()) as { ok?: boolean; deleted?: boolean; warning?: string; error?: string };
    if (!res.ok) return { ok: false, error: data.error || "Spieler konnte nicht entfernt werden." };
    return { ok: true, deleted: data.deleted, warning: data.warning };
  } catch {
    return { ok: false, error: "Spieler konnte nicht entfernt werden." };
  }
}

export async function importRosterApi(
  csv: string,
  apiBase: string,
  token: string | null,
  desktop?: SteeldartDesktop,
  origin?: string | null,
): Promise<RosterImportResult> {
  const empty: RosterImportResult = {
    ok: false,
    imported: 0,
    updated: 0,
    createdTeams: [],
    errors: ["Import fehlgeschlagen."],
    summary: "Import fehlgeschlagen.",
  };
  try {
    if (useDesktopStore(desktop, origin ?? (apiBase || null)) && desktop?.importRoster) {
      return (await desktop.importRoster(csv)) as RosterImportResult;
    }
    const res = await fetch(apiUrl(apiBase, "/api/admin/roster/import"), {
      method: "POST",
      headers: headers(token),
      body: JSON.stringify({ csv }),
    });
    return (await res.json()) as RosterImportResult;
  } catch {
    return empty;
  }
}

export async function fetchSpieltage(
  apiBase: string,
  desktop?: SteeldartDesktop,
  origin?: string | null,
): Promise<SpieltagListItem[]> {
  if (useDesktopStore(desktop, origin ?? (apiBase || null)) && desktop?.listSpieltage) {
    const data = await desktop.listSpieltage();
    return data.spieltage ?? [];
  }
  const data = await fetchJson<{ spieltage?: SpieltagListItem[] }>(apiUrl(apiBase, "/api/spieltage"));
  if (!Array.isArray(data.spieltage)) {
    throw new Error("Spieltage konnten nicht geladen werden.");
  }
  return data.spieltage;
}

export async function fetchSpieltag(
  id: string,
  apiBase: string,
  desktop?: SteeldartDesktop,
  origin?: string | null,
): Promise<SpieltagDetail | null> {
  if (useDesktopStore(desktop, origin ?? (apiBase || null)) && desktop?.getSpieltag) {
    return (await desktop.getSpieltag(id)) ?? null;
  }
  let res: Response;
  try {
    res = await fetch(apiUrl(apiBase, `/api/spieltage/${encodeURIComponent(id)}`));
  } catch {
    throw new Error("Spielbericht konnte nicht geladen werden. Server nicht erreichbar.");
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`Spielbericht konnte nicht geladen werden (${res.status}).`);
  }
  return (await res.json()) as SpieltagDetail;
}

export async function rebuildTodaySpieltag(
  apiBase: string,
  token: string | null,
  desktop?: SteeldartDesktop,
  origin?: string | null,
): Promise<SpieltagDetail | null> {
  if (useDesktopStore(desktop, origin ?? (apiBase || null)) && desktop?.rebuildTodaySpieltag) {
    return (await desktop.rebuildTodaySpieltag()) ?? null;
  }
  const data = await fetchJson<{ spieltag?: SpieltagDetail }>(apiUrl(apiBase, "/api/admin/spieltage/today"), {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({}),
  });
  return data.spieltag ?? null;
}

export async function startNewSpieltag(
  apiBase: string,
  token: string | null,
  desktop?: SteeldartDesktop,
  origin?: string | null,
): Promise<SpieltagDetail | null> {
  if (useDesktopStore(desktop, origin ?? (apiBase || null)) && desktop?.startNewSpieltag) {
    return (await desktop.startNewSpieltag()) ?? null;
  }
  const data = await fetchJson<{ spieltag?: SpieltagDetail }>(apiUrl(apiBase, "/api/admin/spieltage/reset"), {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify({}),
  });
  return data.spieltag ?? null;
}

export async function fetchHeadToHead(
  apiBase: string,
  token: string | null,
  desktop?: SteeldartDesktop,
  origin?: string | null,
): Promise<HeadToHeadRow[]> {
  if (useDesktopStore(desktop, origin ?? (apiBase || null)) && desktop?.headToHead) {
    const data = await desktop.headToHead();
    return data.rows ?? [];
  }
  if (token) {
    const res = await fetch(apiUrl(apiBase, "/api/admin/head-to-head"), { headers: headers(token) });
    if (res.ok) {
      const data = (await res.json()) as { rows?: HeadToHeadRow[] };
      return data.rows ?? [];
    }
  }
  const stats = await fetchStats(apiBase, desktop, origin);
  return stats.headToHead ?? [];
}

export function spieltagCsv(day: SpieltagDetail): string {
  const header = [
    "zeit",
    "scheibe",
    "headline",
    "teams",
    "spieler",
    "endstand",
    "darts",
    "runden",
    "checkout",
    "bericht",
  ];
  const lines = [header.join(",")];
  const cell = (value: string | number | null | undefined) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  for (const report of day.reports) {
    const teams = [...new Set(report.payload.players.map((p) => p.teamName).filter(Boolean))];
    lines.push(
      [
        cell(new Date(report.playedAt).toISOString()),
        cell(report.boardName ?? ""),
        cell(report.payload.headline ?? ""),
        cell(teams.join(" vs ")),
        cell(report.payload.players.map((p) => formatPlayerPassLabel(p)).join(" vs ")),
        cell(report.payload.endstand || report.payload.scoreline),
        report.payload.dartsThrown,
        report.payload.roundCount,
        cell(report.payload.checkout ?? ""),
        cell(report.summary),
      ].join(","),
    );
  }
  lines.push("");
  lines.push(["match", "leg", "sieger", "restGegner", "dartsSieger", "darts", "checkout", "beginner", "avg"].join(","));
  for (const report of day.reports) {
    for (const leg of report.payload.legs ?? []) {
      const darts = Object.entries(leg.playerDarts ?? {})
        .map(([id, n]) => `${formatPlayerPassLabel(report.payload.players.find((p) => p.id === id) ?? { name: id })}:${n}`)
        .join(" ");
      lines.push(
        [
          cell(report.payload.headline ?? ""),
          leg.legNumber,
          cell(leg.winnerName),
          cell(leg.opponentRemainingLabel),
          leg.winnerDarts,
          cell(darts),
          cell(leg.checkout ?? ""),
          cell(leg.starterName),
          cell(leg.winnerAverage.toFixed(1)),
        ].join(","),
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

export function spieltagLabel(day: { dateKey: string; startedAt: number }): string {
  return new Date(day.startedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" });
}
