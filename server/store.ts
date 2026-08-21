import { randomUUID } from "node:crypto";
import {
  AVERAGE_RULE_DE,
  DEFAULT_PLAYERS,
  PLAYER_NAME_TAKEN,
  TRAINING_TEAM_ID,
  TRAINING_TEAM_NAME,
  computeMatchAnalysis,
  computeMatchReport,
  emptyVisitStats,
  formatPlayerPassLabel,
  isTrainingTeam,
  MATCH_REPORT_HTML_STYLES,
  matchNeedsDayReport,
  matchReportTableHtml,
  inGamePlayerName,
  matchHeadline,
  nameKey,
  parseTeamRosterCsv,
  reportPlayerLabel,
  toMatchPlayer,
  type MatchAnalysisPayload,
  type MatchReportPayload,
  type PlayerVisitStats,
} from "../shared/index.js";
import type { GameType, MatchState, Player } from "../shared/types.js";
import { mysqlConfigured, openMysqlDb } from "./mysql.js";
import { defaultDbPath, openMiniDb, type MiniDb } from "./sqlite.js";

export interface RegisteredPlayer extends Player {
  createdAt: number;
}

export interface Team {
  id: string;
  name: string;
  createdAt: number;
}

export interface TeamTree extends Team {
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
  boards: BoardInfo[];
  reports: StoredMatchReport[];
  html: string;
}

export interface LifetimeRow extends PlayerVisitStats {
  playerId: string;
  matches: number;
}

export interface PlayerStatsView {
  player: RegisteredPlayer;
  lifetime: LifetimeRow;
  analyses: StoredMatchAnalysis[];
}

export interface StoredMatchAnalysis {
  id: string;
  matchId: string;
  playedAt: number;
  mode: "offline" | "online";
  gameType: GameType;
  opponents: Player[];
  playerStats: Record<string, PlayerVisitStats>;
  winnerId: string | null;
  scoreline: string;
  boardId: string | null;
  boardName: string | null;
}

export interface StoredMatchReport {
  id: string;
  matchId: string;
  playedAt: number;
  mode: "offline" | "online";
  gameType: GameType;
  boardId: string | null;
  boardName: string | null;
  summary: string;
  payload: MatchReportPayload;
  synced: boolean;
}

export interface BoardInfo {
  id: string;
  name: string;
  lastSeen: number;
  matches: number;
}

export interface HeadToHeadRow {
  winnerId: string;
  winnerName: string;
  loserId: string;
  loserName: string;
  wins: number;
}

export interface BoardIdentity {
  id: string;
  name: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  team_id TEXT,
  pass_nr TEXT
);
CREATE TABLE IF NOT EXISTS player_stats (
  player_id TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  total_points INTEGER NOT NULL DEFAULT 0,
  darts_thrown INTEGER NOT NULL DEFAULT 0,
  misses INTEGER NOT NULL DEFAULT 0,
  visits INTEGER NOT NULL DEFAULT 0,
  plus_60 INTEGER NOT NULL DEFAULT 0,
  plus_80 INTEGER NOT NULL DEFAULT 0,
  plus_100 INTEGER NOT NULL DEFAULT 0,
  plus_120 INTEGER NOT NULL DEFAULT 0,
  plus_140 INTEGER NOT NULL DEFAULT 0,
  score_180 INTEGER NOT NULL DEFAULT 0,
  matches INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS match_analyses (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL UNIQUE,
  played_at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  game_type TEXT NOT NULL,
  opponents TEXT NOT NULL,
  player_stats TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS match_analysis_players (
  analysis_id TEXT NOT NULL REFERENCES match_analyses(id) ON DELETE CASCADE,
  player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  PRIMARY KEY (analysis_id, player_id)
);
CREATE TABLE IF NOT EXISTS teams (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS spieltage (
  id TEXT PRIMARY KEY,
  date_key TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL DEFAULT '{}',
  active INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS spieltag_rooms (
  spieltag_id TEXT NOT NULL REFERENCES spieltage(id) ON DELETE CASCADE,
  room_code TEXT NOT NULL,
  PRIMARY KEY (spieltag_id, room_code)
);
CREATE TABLE IF NOT EXISTS match_reports (
  id TEXT PRIMARY KEY,
  match_id TEXT NOT NULL UNIQUE,
  played_at INTEGER NOT NULL,
  mode TEXT NOT NULL,
  game_type TEXT NOT NULL,
  board_id TEXT,
  board_name TEXT,
  summary TEXT NOT NULL,
  payload TEXT NOT NULL,
  synced INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS boards (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  last_seen INTEGER NOT NULL
);
`;

const MYSQL_SCHEMA = `
CREATE TABLE IF NOT EXISTS players (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  name_key VARCHAR(191) NOT NULL,
  created_at BIGINT NOT NULL,
  team_id VARCHAR(64),
  pass_nr VARCHAR(191)
);
CREATE TABLE IF NOT EXISTS player_stats (
  player_id VARCHAR(64) PRIMARY KEY,
  total_points BIGINT NOT NULL DEFAULT 0,
  darts_thrown BIGINT NOT NULL DEFAULT 0,
  misses BIGINT NOT NULL DEFAULT 0,
  visits BIGINT NOT NULL DEFAULT 0,
  plus_60 BIGINT NOT NULL DEFAULT 0,
  plus_80 BIGINT NOT NULL DEFAULT 0,
  plus_100 BIGINT NOT NULL DEFAULT 0,
  plus_120 BIGINT NOT NULL DEFAULT 0,
  plus_140 BIGINT NOT NULL DEFAULT 0,
  score_180 BIGINT NOT NULL DEFAULT 0,
  matches BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS match_analyses (
  id VARCHAR(64) PRIMARY KEY,
  match_id VARCHAR(64) NOT NULL UNIQUE,
  played_at BIGINT NOT NULL,
  mode VARCHAR(32) NOT NULL,
  game_type VARCHAR(64) NOT NULL,
  opponents MEDIUMTEXT NOT NULL,
  player_stats MEDIUMTEXT NOT NULL,
  winner_id VARCHAR(64),
  scoreline VARCHAR(191) NOT NULL DEFAULT '',
  board_id VARCHAR(64),
  board_name VARCHAR(191)
);
CREATE TABLE IF NOT EXISTS match_analysis_players (
  analysis_id VARCHAR(64) NOT NULL,
  player_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (analysis_id, player_id)
);
CREATE TABLE IF NOT EXISTS teams (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  name_key VARCHAR(191) NOT NULL UNIQUE,
  created_at BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS spieltage (
  id VARCHAR(64) PRIMARY KEY,
  date_key VARCHAR(32) NOT NULL,
  started_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  mode VARCHAR(32) NOT NULL,
  summary MEDIUMTEXT NOT NULL,
  payload MEDIUMTEXT NOT NULL,
  active TINYINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS spieltag_rooms (
  spieltag_id VARCHAR(64) NOT NULL,
  room_code VARCHAR(32) NOT NULL,
  PRIMARY KEY (spieltag_id, room_code)
);
CREATE TABLE IF NOT EXISTS match_reports (
  id VARCHAR(64) PRIMARY KEY,
  match_id VARCHAR(64) NOT NULL UNIQUE,
  played_at BIGINT NOT NULL,
  mode VARCHAR(32) NOT NULL,
  game_type VARCHAR(64) NOT NULL,
  board_id VARCHAR(64),
  board_name VARCHAR(191),
  summary MEDIUMTEXT NOT NULL,
  payload MEDIUMTEXT NOT NULL,
  synced TINYINT NOT NULL DEFAULT 1,
  spieltag_id VARCHAR(64)
);
CREATE TABLE IF NOT EXISTS boards (
  id VARCHAR(64) PRIMARY KEY,
  name VARCHAR(191) NOT NULL,
  last_seen BIGINT NOT NULL
);
`;

const PLAYER_STAT_COLUMNS: Array<[string, string]> = [
  ["matches_won", "INTEGER NOT NULL DEFAULT 0"],
  ["matches_lost", "INTEGER NOT NULL DEFAULT 0"],
  ["legs_won", "INTEGER NOT NULL DEFAULT 0"],
  ["legs_lost", "INTEGER NOT NULL DEFAULT 0"],
  ["first3_points", "INTEGER NOT NULL DEFAULT 0"],
  ["first3_darts", "INTEGER NOT NULL DEFAULT 0"],
  ["first9_points", "INTEGER NOT NULL DEFAULT 0"],
  ["first9_darts", "INTEGER NOT NULL DEFAULT 0"],
  ["highest_finish", "INTEGER NOT NULL DEFAULT 0"],
  ["checkout_hits", "INTEGER NOT NULL DEFAULT 0"],
  ["checkout_attempts", "INTEGER NOT NULL DEFAULT 0"],
  ["highest_visit", "INTEGER NOT NULL DEFAULT 0"],
  ["score_26", "INTEGER NOT NULL DEFAULT 0"],
];

function tableColumns(db: MiniDb, table: string): Set<string> {
  if (db.dialect === "mysql") {
    const rows = db.all<{ COLUMN_NAME?: string; column_name?: string }>(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
      table,
    );
    return new Set(rows.map((row) => String(row.COLUMN_NAME ?? row.column_name ?? "")));
  }
  const rows = db.all<{ name?: string; NAME?: string }>(`PRAGMA table_info(${table})`);
  return new Set(rows.map((row) => String(row.name ?? row.NAME ?? "")));
}

function mysqlDdl(ddl: string): string {
  return ddl.replace(/\bINTEGER\b/gi, "BIGINT").replace(/\bTEXT\b/gi, "VARCHAR(191)");
}

function ensureColumn(db: MiniDb, table: string, column: string, ddl: string): void {
  const cols = tableColumns(db, table);
  if (cols.has(column)) return;
  const type = db.dialect === "mysql" ? mysqlDdl(ddl) : ddl;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

function dateKey(ts = Date.now()): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dayBounds(key: string): { from: number; to: number } {
  const [y, m, d] = key.split("-").map(Number);
  const from = new Date(y!, (m ?? 1) - 1, d ?? 1).getTime();
  return { from, to: from + 24 * 60 * 60 * 1000 };
}

function normalizePassNr(value: unknown): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed || null;
}

function safeIdent(value: string): string {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value) ? value : "";
}

function playerIndexColumns(db: MiniDb, indexName: string): string[] {
  const ident = safeIdent(indexName);
  if (!ident) return [];
  return db
    .all<{ name?: string; NAME?: string }>(`PRAGMA index_info(${ident})`)
    .map((row) => String(row.name ?? row.NAME ?? ""))
    .filter(Boolean);
}

function migratePlayersPassNr(db: MiniDb): void {
  ensureColumn(db, "players", "pass_nr", "TEXT");
  if (db.dialect === "mysql") {
    db.exec("UPDATE players SET pass_nr = NULL WHERE pass_nr IS NOT NULL AND TRIM(pass_nr) = ''");
    try {
      db.exec("CREATE UNIQUE INDEX players_name_key ON players (name_key)");
    } catch {
      /* already exists */
    }
    try {
      db.exec("CREATE UNIQUE INDEX players_pass_nr ON players (pass_nr)");
    } catch {
      /* already exists — MySQL erlaubt mehrere NULL */
    }
    return;
  }
  db.exec("UPDATE players SET pass_nr = NULL WHERE pass_nr IS NOT NULL AND trim(pass_nr) = ''");

  const tableSql = String(
    db.get<{ sql?: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'players'")?.sql ?? "",
  );
  const keep = new Set(["players_name_key_no_pass", "players_pass_nr_nonempty"]);
  let needsRebuild = /name_key TEXT NOT NULL UNIQUE/i.test(tableSql) ||
    /pass_nr TEXT\s+NOT NULL/i.test(tableSql) ||
    /pass_nr TEXT(?:\s+NOT NULL)?\s+UNIQUE/i.test(tableSql) ||
    /UNIQUE\s*\([^)]*pass_nr/i.test(tableSql);

  const pragmaIdx = db.all<{ name?: string; unique?: number }>("PRAGMA index_list(players)");
  for (const idx of pragmaIdx) {
    const name = String(idx.name ?? "");
    if (!name || keep.has(name) || Number(idx.unique) !== 1) continue;
    const cols = playerIndexColumns(db, name);
    const blocksPass = cols.includes("pass_nr");
    const blocksNameKey = cols.length === 1 && cols[0] === "name_key";
    if (!blocksPass && !blocksNameKey) continue;
    if (name.startsWith("sqlite_autoindex_")) {
      needsRebuild = true;
      continue;
    }
    const ident = safeIdent(name);
    if (ident) db.exec(`DROP INDEX IF EXISTS ${ident}`);
  }

  if (needsRebuild) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`CREATE TABLE players_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      team_id TEXT,
      pass_nr TEXT
    )`);
    db.exec(`INSERT INTO players_new (id, name, name_key, created_at, team_id, pass_nr)
      SELECT id, name, name_key, created_at, team_id, CASE WHEN trim(ifnull(pass_nr, '')) = '' THEN NULL ELSE pass_nr END FROM players`);
    db.exec("DROP TABLE players");
    db.exec("ALTER TABLE players_new RENAME TO players");
    db.exec("PRAGMA foreign_keys = ON");
  }

  db.exec("DROP INDEX IF EXISTS players_pass_nr");
  db.exec("DROP INDEX IF EXISTS players_pass_nr_unique");
  db.exec("DROP INDEX IF EXISTS idx_players_pass_nr");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS players_name_key_no_pass ON players(name_key) WHERE pass_nr IS NULL OR pass_nr = ''",
  );
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS players_pass_nr_nonempty ON players(pass_nr) WHERE pass_nr IS NOT NULL AND pass_nr != ''",
  );
}

function migrate(db: MiniDb): void {
  ensureColumn(db, "players", "team_id", "TEXT");
  migratePlayersPassNr(db);
  for (const [col, ddl] of PLAYER_STAT_COLUMNS) {
    ensureColumn(db, "player_stats", col, ddl);
  }
  ensureColumn(db, "match_analyses", "winner_id", "TEXT");
  ensureColumn(db, "match_analyses", "scoreline", "TEXT NOT NULL DEFAULT ''");
  ensureColumn(db, "match_analyses", "board_id", "TEXT");
  ensureColumn(db, "match_analyses", "board_name", "TEXT");
  ensureColumn(db, "match_reports", "spieltag_id", "TEXT");
  flattenClubNesting(db);
  migrateSpieltageSessions(db);
}

function migrateSpieltageSessions(db: MiniDb): void {
  ensureColumn(db, "spieltage", "active", "INTEGER NOT NULL DEFAULT 0");
  if (db.dialect === "mysql") return;
  const tableSql = String(
    db.get<{ sql?: string }>("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'spieltage'")?.sql ?? "",
  );
  if (/date_key TEXT NOT NULL UNIQUE/i.test(tableSql)) {
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec(`CREATE TABLE spieltage_new (
      id TEXT PRIMARY KEY,
      date_key TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      mode TEXT NOT NULL,
      summary TEXT NOT NULL DEFAULT '',
      payload TEXT NOT NULL DEFAULT '{}',
      active INTEGER NOT NULL DEFAULT 0
    )`);
    db.exec(`INSERT INTO spieltage_new (id, date_key, started_at, updated_at, mode, summary, payload, active)
      SELECT id, date_key, started_at, updated_at, mode, summary, payload, COALESCE(active, 0) FROM spieltage`);
    db.exec("DROP TABLE spieltage");
    db.exec("ALTER TABLE spieltage_new RENAME TO spieltage");
    db.exec("PRAGMA foreign_keys = ON");
  }
  const active = db.get<{ id: string }>("SELECT id FROM spieltage WHERE active = 1");
  if (!active) {
    const latest = db.get<{ id: string }>("SELECT id FROM spieltage ORDER BY started_at DESC LIMIT 1");
    if (latest) db.run("UPDATE spieltage SET active = 1 WHERE id = ?", latest.id);
  }
  const reports = db.all<{ id: string; played_at: number }>(
    "SELECT id, played_at FROM match_reports WHERE spieltag_id IS NULL OR spieltag_id = ''",
  );
  for (const report of reports) {
    const day = dateKey(Number(report.played_at));
    const tag = db.get<{ id: string }>(
      "SELECT id FROM spieltage WHERE date_key = ? ORDER BY started_at DESC LIMIT 1",
      day,
    );
    if (tag) db.run("UPDATE match_reports SET spieltag_id = ? WHERE id = ?", tag.id, report.id);
  }
}

function flattenClubNesting(db: MiniDb): void {
  if (db.dialect === "mysql") {
    db.exec(`CREATE TABLE IF NOT EXISTS teams (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(191) NOT NULL,
      name_key VARCHAR(191) NOT NULL UNIQUE,
      created_at BIGINT NOT NULL
    )`);
    return;
  }
  if (tableExists(db, "club_teams")) {
    db.exec(`CREATE TABLE IF NOT EXISTS teams_flat (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    )`);
    const rows = tableExists(db, "clubs")
      ? db.all<{ id: string; name: string; created_at: number; club_name?: string }>(
          `SELECT t.id, t.name, t.created_at, c.name AS club_name
             FROM club_teams t
             LEFT JOIN clubs c ON c.id = t.club_id`,
        )
      : db.all<{ id: string; name: string; created_at: number; club_name?: string }>(
          "SELECT id, name, created_at FROM club_teams",
        );
    const used = new Set<string>();
    for (const row of rows) {
      let name = String(row.name ?? "").trim() || "Team";
      let key = nameKey(name);
      if (used.has(key) || db.get<{ id: string }>("SELECT id FROM teams_flat WHERE name_key = ?", key)) {
        const prefix = String(row.club_name ?? "").trim();
        if (prefix) {
          name = `${prefix} - ${name}`;
          key = nameKey(name);
        }
      }
      let n = 2;
      const base = name;
      while (used.has(key) || db.get<{ id: string }>("SELECT id FROM teams_flat WHERE name_key = ?", key)) {
        name = `${base} (${n})`;
        key = nameKey(name);
        n += 1;
      }
      used.add(key);
      try {
        db.run(
          "INSERT INTO teams_flat (id, name, name_key, created_at) VALUES (?, ?, ?, ?)",
          row.id,
          name,
          key,
          Number(row.created_at) || Date.now(),
        );
      } catch {
        continue;
      }
    }
    db.exec("PRAGMA foreign_keys = OFF");
    db.exec("DROP TABLE IF EXISTS club_teams");
    db.exec("DROP TABLE IF EXISTS clubs");
    if (tableExists(db, "teams")) db.exec("DROP TABLE teams");
    db.exec("ALTER TABLE teams_flat RENAME TO teams");
    db.exec("PRAGMA foreign_keys = ON");
  }
  db.exec(`CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_key TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  )`);
}

function tableExists(db: MiniDb, name: string): boolean {
  if (db.dialect === "mysql") {
    const row = db.get<{ name?: string; TABLE_NAME?: string }>(
      "SELECT TABLE_NAME AS name FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
      name,
    );
    return Boolean(row?.name ?? row?.TABLE_NAME);
  }
  const row = db.get<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    name,
  );
  return Boolean(row);
}

function num(value: unknown): number {
  return Number(value) || 0;
}

function coerceStats(raw: Partial<PlayerVisitStats> | undefined): PlayerVisitStats {
  const base = emptyVisitStats();
  if (!raw || typeof raw !== "object") return base;
  return { ...base, ...raw };
}

function lifetimeFromRow(row: Record<string, unknown>): LifetimeRow {
  const dartsThrown = num(row.darts_thrown);
  const totalPoints = num(row.total_points);
  const first3Darts = num(row.first3_darts);
  const first3Points = num(row.first3_points);
  const first9Darts = num(row.first9_darts);
  const first9Points = num(row.first9_points);
  const checkoutAttempts = num(row.checkout_attempts);
  const checkoutHits = num(row.checkout_hits);
  return {
    playerId: String(row.player_id),
    totalPoints,
    dartsThrown,
    misses: num(row.misses),
    visits: num(row.visits),
    plus60: num(row.plus_60),
    plus80: num(row.plus_80),
    plus100: num(row.plus_100),
    plus120: num(row.plus_120),
    plus140: num(row.plus_140),
    score180: num(row.score_180),
    matches: num(row.matches),
    matchesWon: num(row.matches_won),
    matchesLost: num(row.matches_lost),
    legsWon: num(row.legs_won),
    legsLost: num(row.legs_lost),
    first3Points,
    first3Darts,
    first3Average: first3Darts > 0 ? (3 * first3Points) / first3Darts : 0,
    first9Points,
    first9Darts,
    first9Average: first9Darts > 0 ? (3 * first9Points) / first9Darts : 0,
    highestFinish: num(row.highest_finish),
    checkoutHits,
    checkoutAttempts,
    checkoutPercent: checkoutAttempts > 0 ? (100 * checkoutHits) / checkoutAttempts : 0,
    highestVisit: num(row.highest_visit),
    score26: num(row.score_26),
    average: dartsThrown > 0 ? (3 * totalPoints) / dartsThrown : 0,
  };
}

export class StatsStore {
  constructor(private readonly db: MiniDb) {
    this.db.exec(db.dialect === "mysql" ? MYSQL_SCHEMA : SCHEMA);
    migrate(this.db);
    this.seedDefaultPlayers();
    this.seedBuiltInTrainingTeam();
  }

  close(): void {
    this.db.close();
  }

  listTeams(): Team[] {
    return this.db
      .all<{ id: string; name: string; created_at: number }>(
        "SELECT id, name, created_at FROM teams ORDER BY name_key ASC",
      )
      .map((row) => ({ id: row.id, name: row.name, createdAt: Number(row.created_at) }));
  }

  getTeam(id: string): Team | undefined {
    const row = this.db.get<{ id: string; name: string; created_at: number }>(
      "SELECT id, name, created_at FROM teams WHERE id = ?",
      id,
    );
    if (!row) return undefined;
    return { id: row.id, name: row.name, createdAt: Number(row.created_at) };
  }

  createTeam(name: string): { ok: true; team: Team } | { ok: false; error: string } {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Bitte einen Teamnamen eingeben." };
    const key = nameKey(trimmed);
    if (this.db.get<{ id: string }>("SELECT id FROM teams WHERE name_key = ?", key)) {
      return { ok: false, error: "Team bereits vorhanden, anderen Namen wählen." };
    }
    const team: Team = { id: randomUUID(), name: trimmed, createdAt: Date.now() };
    try {
      this.db.run(
        "INSERT INTO teams (id, name, name_key, created_at) VALUES (?, ?, ?, ?)",
        team.id,
        team.name,
        key,
        team.createdAt,
      );
    } catch (err) {
      if (isUniqueConstraint(err)) return { ok: false, error: "Team bereits vorhanden, anderen Namen wählen." };
      return { ok: false, error: "Team konnte nicht gespeichert werden." };
    }
    return { ok: true, team };
  }

  renameTeam(id: string, name: string): { ok: true; team: Team } | { ok: false; error: string } {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Bitte einen Teamnamen eingeben." };
    if (!this.getTeam(id)) return { ok: false, error: "Team nicht gefunden." };
    const key = nameKey(trimmed);
    if (this.db.get<{ id: string }>("SELECT id FROM teams WHERE name_key = ? AND id != ?", key, id)) {
      return { ok: false, error: "Team bereits vorhanden, anderen Namen wählen." };
    }
    try {
      this.db.run("UPDATE teams SET name = ?, name_key = ? WHERE id = ?", trimmed, key, id);
    } catch (err) {
      if (isUniqueConstraint(err)) return { ok: false, error: "Team bereits vorhanden, anderen Namen wählen." };
      return { ok: false, error: "Team konnte nicht gespeichert werden." };
    }
    const team = this.getTeam(id);
    if (!team) return { ok: false, error: "Team nicht gefunden." };
    return { ok: true, team };
  }

  deleteTeam(id: string): { ok: true } | { ok: false; error: string } {
    const team = this.getTeam(id);
    if (!team) return { ok: false, error: "Team nicht gefunden." };
    if (this.isBuiltInTrainingTeam(team)) {
      return { ok: false, error: "Das Team Training kann nicht gelöscht werden." };
    }
    this.db.run("UPDATE players SET team_id = NULL WHERE team_id = ?", id);
    this.db.run("DELETE FROM teams WHERE id = ?", id);
    return { ok: true };
  }

  getTrainingTeam(): Team | undefined {
    const byId = this.getTeam(TRAINING_TEAM_ID);
    if (byId) return byId;
    const row = this.db.get<{ id: string }>(
      "SELECT id FROM teams WHERE name_key = ?",
      nameKey(TRAINING_TEAM_NAME),
    );
    return row ? this.getTeam(row.id) : undefined;
  }

  isBuiltInTrainingTeam(team?: { id?: string | null; name?: string | null } | null): boolean {
    if (!team) return false;
    if (isTrainingTeam(team)) return true;
    const known = this.getTrainingTeam();
    return Boolean(known && team.id === known.id);
  }

  seedBuiltInTrainingTeam(): void {
    if (this.getTrainingTeam()) return;
    const now = Date.now();
    const key = nameKey(TRAINING_TEAM_NAME);
    try {
      this.db.run(
        "INSERT INTO teams (id, name, name_key, created_at) VALUES (?, ?, ?, ?)",
        TRAINING_TEAM_ID,
        TRAINING_TEAM_NAME,
        key,
        now,
      );
    } catch {
      this.ensureTeam(TRAINING_TEAM_NAME);
    }
  }

  shouldWriteDayReport(players?: Player[] | null): boolean {
    const trainingId = this.getTrainingTeam()?.id ?? null;
    const hydrated = (players ?? []).map((player) => {
      const registered = player.id ? this.getPlayer(player.id) : undefined;
      return {
        teamId: player.teamId ?? registered?.teamId ?? null,
        teamName: player.teamName ?? registered?.teamName ?? null,
        clubId: player.clubId ?? null,
      };
    });
    return matchNeedsDayReport(hydrated, trainingId);
  }

  ensureTeam(name: string): { ok: true; team: Team; created: boolean } | { ok: false; error: string } {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Bitte einen Teamnamen eingeben." };
    const key = nameKey(trimmed);
    const existing = this.db.get<{ id: string }>("SELECT id FROM teams WHERE name_key = ?", key);
    if (existing) {
      const team = this.getTeam(existing.id);
      if (!team) return { ok: false, error: "Team nicht gefunden." };
      return { ok: true, team, created: false };
    }
    const created = this.createTeam(trimmed);
    if (!created.ok) return created;
    return { ok: true, team: created.team, created: true };
  }

  createTeamPlayer(
    teamId: string,
    name: string,
    passNr?: string | null,
  ): { ok: true; player: RegisteredPlayer } | { ok: false; error: string } {
    if (!this.getTeam(teamId)) return { ok: false, error: "Team nicht gefunden." };
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Bitte einen Spielernamen eingeben." };
    return this.createPlayer(trimmed, { passNr, teamId });
  }

  removePlayerFromTeam(
    playerId: string,
    teamId: string,
    opts?: { keepRecord?: boolean },
  ): { ok: true; deleted: boolean; warning?: string } | { ok: false; error: string } {
    const player = this.getPlayer(playerId);
    if (!player) return { ok: false, error: "Spieler nicht gefunden." };
    if (!this.getTeam(teamId)) return { ok: false, error: "Team nicht gefunden." };
    if (player.teamId !== teamId) return { ok: false, error: "Spieler gehört nicht zu diesem Team." };
    const isDefault = DEFAULT_PLAYERS.some((d) => nameKey(d.name) === nameKey(player.name));
    this.setPlayerTeam(playerId, null);
    if (isDefault) return { ok: true, deleted: false };
    if (opts?.keepRecord) {
      return {
        ok: true,
        deleted: false,
        warning: "Spieler ist in einem laufenden Match und wurde nur vom Team entfernt.",
      };
    }
    this.deletePlayer(playerId);
    return { ok: true, deleted: true };
  }

  findPlayerByPassNr(passNr: string): RegisteredPlayer | undefined {
    const key = normalizePassNr(passNr);
    if (!key) return undefined;
    const row = this.db.get<{ id: string }>("SELECT id FROM players WHERE pass_nr = ?", key);
    return row ? this.getPlayer(row.id) : undefined;
  }

  importRoster(csvText: string): RosterImportResult {
    const parsed = parseTeamRosterCsv(csvText);
    const errors = [...parsed.errors];
    let imported = 0;
    let updated = 0;
    const createdTeams: string[] = [];
    for (const row of parsed.rows) {
      const team = this.ensureTeam(row.team);
      if (!team.ok) {
        errors.push(`Zeile ${row.line}: ${team.error}`);
        continue;
      }
      if (team.created && !createdTeams.includes(team.team.name)) createdTeams.push(team.team.name);
      const passNr = normalizePassNr(row.passNr);
      const existing = passNr ? this.findPlayerByPassNr(passNr) : undefined;
      if (existing) {
        try {
          this.db.run(
            "UPDATE players SET name = ?, name_key = ?, team_id = ?, pass_nr = ? WHERE id = ?",
            row.name,
            nameKey(row.name),
            team.team.id,
            passNr,
            existing.id,
          );
          updated += 1;
          imported += 1;
        } catch (err) {
          errors.push(`Zeile ${row.line}: ${err instanceof Error ? err.message : "Spieler konnte nicht aktualisiert werden."}`);
        }
        continue;
      }
      const created = this.createPlayer(row.name, { passNr, teamId: team.team.id });
      if (!created.ok) {
        errors.push(`Zeile ${row.line}: ${created.error}`);
        continue;
      }
      imported += 1;
    }
    const parts = [`${imported} Spieler importiert`, `${createdTeams.length} Teams angelegt`];
    if (updated) parts.splice(1, 0, `${updated} aktualisiert`);
    if (errors.length) parts.push(`${errors.length} Fehler`);
    return {
      ok: imported > 0 || errors.length === parsed.errors.length,
      imported,
      updated,
      createdTeams,
      errors,
      summary: `${parts.join(", ")}.`,
    };
  }

  setPlayerTeam(playerId: string, teamId: string | null): { ok: true } | { ok: false; error: string } {
    if (!this.getPlayer(playerId)) return { ok: false, error: "Spieler nicht gefunden." };
    if (teamId && !this.getTeam(teamId)) return { ok: false, error: "Team nicht gefunden." };
    this.db.run("UPDATE players SET team_id = ? WHERE id = ?", teamId, playerId);
    return { ok: true };
  }

  listTeamTree(): TeamTree[] {
    const players = this.listPlayers();
    return this.listTeams().map((team) => ({
      ...team,
      builtIn: this.isBuiltInTrainingTeam(team),
      players: players.filter((p) => p.teamId === team.id),
    }));
  }


  private mapPlayerRow(row: {
    id: string;
    name: string;
    created_at: number;
    team_id?: string | null;
    team_name?: string | null;
    pass_nr?: string | null;
  }): RegisteredPlayer {
    return {
      id: row.id,
      name: row.name,
      createdAt: Number(row.created_at),
      teamId: row.team_id || null,
      teamName: row.team_name || null,
      passNr: normalizePassNr(row.pass_nr),
    };
  }

  private playerRow(id: string): RegisteredPlayer | undefined {
    const row = this.db.get<{
      id: string;
      name: string;
      created_at: number;
      team_id?: string | null;
      team_name?: string | null;
      pass_nr?: string | null;
    }>(
      `SELECT p.id, p.name, p.created_at, p.team_id, p.pass_nr, t.name AS team_name
         FROM players p
         LEFT JOIN teams t ON t.id = p.team_id
        WHERE p.id = ?`,
      id,
    );
    if (!row) return undefined;
    return this.mapPlayerRow(row);
  }

  listPlayers(): RegisteredPlayer[] {
    return this.db
      .all<{
        id: string;
        name: string;
        created_at: number;
        team_id?: string | null;
        team_name?: string | null;
        pass_nr?: string | null;
      }>(
        `SELECT p.id, p.name, p.created_at, p.team_id, p.pass_nr, t.name AS team_name
           FROM players p
           LEFT JOIN teams t ON t.id = p.team_id
          ORDER BY p.name_key ASC`,
      )
      .map((row) => this.mapPlayerRow(row));
  }

  getPlayer(id: string): RegisteredPlayer | undefined {
    return this.playerRow(id);
  }

  createPlayer(
    name: string,
    opts?: { passNr?: string | null; teamId?: string | null },
  ): { ok: true; player: RegisteredPlayer } | { ok: false; error: string } {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, error: "Bitte einen Namen eingeben." };
    const key = nameKey(trimmed);
    const passNr = normalizePassNr(opts?.passNr);
    const teamId = opts?.teamId || null;
    if (passNr && this.findPlayerByPassNr(passNr)) {
      return { ok: false, error: "PassNr bereits vergeben." };
    }
    if (!passNr) {
      const existing = this.db.get<{ id: string }>(
        "SELECT id FROM players WHERE name_key = ? AND (pass_nr IS NULL OR pass_nr = '')",
        key,
      );
      if (existing) return { ok: false, error: PLAYER_NAME_TAKEN };
    }
    const player: RegisteredPlayer = {
      id: randomUUID(),
      name: trimmed,
      createdAt: Date.now(),
      teamId,
      teamName: null,
      passNr,
    };
    try {
      this.db.run(
        "INSERT INTO players (id, name, name_key, created_at, team_id, pass_nr) VALUES (?, ?, ?, ?, ?, ?)",
        player.id,
        player.name,
        key,
        player.createdAt,
        teamId,
        passNr,
      );
    } catch (err) {
      if (isUniqueConstraint(err)) {
        const message = err instanceof Error ? err.message : String(err);
        if (/pass_nr/i.test(message)) return { ok: false, error: "PassNr bereits vergeben." };
        return { ok: false, error: PLAYER_NAME_TAKEN };
      }
      console.error("Spieler-Insert fehlgeschlagen:", err);
      return { ok: false, error: "Spieler konnte nicht gespeichert werden." };
    }
    try {
      this.db.run("INSERT INTO player_stats (player_id) VALUES (?)", player.id);
    } catch (err) {
      console.warn("Spieler-Statistikzeile fehlgeschlagen:", err);
    }
    return { ok: true, player: this.getPlayer(player.id) ?? player };
  }

  seedDefaultPlayers(): void {
    const now = Date.now();
    for (const def of DEFAULT_PLAYERS) {
      const key = nameKey(def.name);
      const byName = this.db.get<{ id: string }>("SELECT id FROM players WHERE name_key = ?", key);
      if (byName) continue;
      const idTaken = this.db.get<{ id: string }>("SELECT id FROM players WHERE id = ?", def.id);
      const id = idTaken ? randomUUID() : def.id;
      try {
        this.db.run(
          "INSERT INTO players (id, name, name_key, created_at, team_id, pass_nr) VALUES (?, ?, ?, ?, NULL, NULL)",
          id,
          def.name,
          key,
          now,
        );
        this.db.run("INSERT INTO player_stats (player_id) VALUES (?)", id);
      } catch (err) {
        if (isUniqueConstraint(err)) continue;
        console.error("Standardspieler konnten nicht angelegt werden:", err);
      }
    }
  }

  defaultMatchPlayers(): Player[] {
    const all = this.listPlayers();
    const picked: RegisteredPlayer[] = [];
    for (const def of DEFAULT_PLAYERS) {
      const found =
        all.find((p) => nameKey(p.name) === nameKey(def.name)) ?? all.find((p) => p.id === def.id);
      if (found && !picked.some((p) => p.id === found.id)) picked.push(found);
    }
    for (const player of all) {
      if (picked.length >= 2) break;
      if (!picked.some((p) => p.id === player.id)) picked.push(player);
    }
    if (picked.length >= 2) {
      return picked.slice(0, 2).map((p) => toMatchPlayer(p));
    }
    return DEFAULT_PLAYERS.map((p) => toMatchPlayer({ id: p.id, name: p.name, teamId: null, teamName: null }));
  }

  deletePlayer(id: string): boolean {
    const result = this.db.run("DELETE FROM players WHERE id = ?", id);
    return result.changes > 0;
  }

  private emptyLifetime(playerId: string): LifetimeRow {
    return { playerId, matches: 0, ...emptyVisitStats() };
  }

  getLifetime(playerId: string): LifetimeRow {
    const row = this.db.get<Record<string, unknown>>("SELECT * FROM player_stats WHERE player_id = ?", playerId);
    if (!row) return this.emptyLifetime(playerId);
    return lifetimeFromRow(row);
  }

  private parseAnalysis(row: {
    id: string;
    match_id: string;
    played_at: number;
    mode: string;
    game_type: string;
    opponents: string;
    player_stats: string;
    winner_id?: string | null;
    scoreline?: string | null;
    board_id?: string | null;
    board_name?: string | null;
  }): StoredMatchAnalysis {
    const rawStats = JSON.parse(row.player_stats) as Record<string, Partial<PlayerVisitStats>>;
    const playerStats: Record<string, PlayerVisitStats> = {};
    for (const [id, stats] of Object.entries(rawStats ?? {})) playerStats[id] = coerceStats(stats);
    return {
      id: row.id,
      matchId: row.match_id,
      playedAt: Number(row.played_at),
      mode: row.mode === "online" ? "online" : "offline",
      gameType: row.game_type as GameType,
      opponents: JSON.parse(row.opponents) as Player[],
      playerStats,
      winnerId: row.winner_id || null,
      scoreline: row.scoreline || "",
      boardId: row.board_id || null,
      boardName: row.board_name || null,
    };
  }

  listAnalysesForPlayer(playerId: string): StoredMatchAnalysis[] {
    const rows = this.db.all<{
      id: string;
      match_id: string;
      played_at: number;
      mode: string;
      game_type: string;
      opponents: string;
      player_stats: string;
      winner_id?: string | null;
      scoreline?: string | null;
      board_id?: string | null;
      board_name?: string | null;
    }>(
      `SELECT a.* FROM match_analyses a
       INNER JOIN match_analysis_players p ON p.analysis_id = a.id
       WHERE p.player_id = ?
       ORDER BY a.played_at DESC`,
      playerId,
    );
    return rows.map((row) => this.parseAnalysis(row));
  }

  listAllAnalyses(): StoredMatchAnalysis[] {
    return this.db
      .all<{
        id: string;
        match_id: string;
        played_at: number;
        mode: string;
        game_type: string;
        opponents: string;
        player_stats: string;
        winner_id?: string | null;
        scoreline?: string | null;
        board_id?: string | null;
        board_name?: string | null;
      }>("SELECT * FROM match_analyses ORDER BY played_at DESC")
      .map((row) => this.parseAnalysis(row));
  }

  playerStats(playerId: string): PlayerStatsView | undefined {
    const player = this.getPlayer(playerId);
    if (!player) return undefined;
    return {
      player,
      lifetime: this.getLifetime(playerId),
      analyses: this.listAnalysesForPlayer(playerId),
    };
  }

  listPlayerStats(): PlayerStatsView[] {
    return this.listPlayers().map((player) => ({
      player,
      lifetime: this.getLifetime(player.id),
      analyses: this.listAnalysesForPlayer(player.id),
    }));
  }

  hasAnalysis(matchId: string): boolean {
    return Boolean(this.db.get<{ id: string }>("SELECT id FROM match_analyses WHERE match_id = ?", matchId));
  }

  touchBoard(board: BoardIdentity | null | undefined): void {
    if (!board?.id) return;
    const name = (board.name || "Scheibe").trim() || "Scheibe";
    const existing = this.db.get<{ id: string }>("SELECT id FROM boards WHERE id = ?", board.id);
    if (existing) {
      this.db.run("UPDATE boards SET name = ?, last_seen = ? WHERE id = ?", name, Date.now(), board.id);
      return;
    }
    this.db.run("INSERT INTO boards (id, name, last_seen) VALUES (?, ?, ?)", board.id, name, Date.now());
  }

  listBoards(): BoardInfo[] {
    const boards = this.db.all<{ id: string; name: string; last_seen: number }>(
      "SELECT id, name, last_seen FROM boards ORDER BY name ASC",
    );
    return boards.map((board) => {
      const count = this.db.get<{ n: number }>(
        "SELECT COUNT(*) as n FROM match_reports WHERE board_id = ?",
        board.id,
      );
      return {
        id: board.id,
        name: board.name,
        lastSeen: Number(board.last_seen),
        matches: num(count?.n),
      };
    });
  }

  currentSpieltag(): { id: string; dateKey: string } | undefined {
    const row = this.db.get<{ id: string; date_key: string }>(
      "SELECT id, date_key FROM spieltage WHERE active = 1 ORDER BY started_at DESC LIMIT 1",
    );
    if (row) return { id: row.id, dateKey: row.date_key };
    const latest = this.db.get<{ id: string; date_key: string }>(
      "SELECT id, date_key FROM spieltage ORDER BY started_at DESC LIMIT 1",
    );
    if (!latest) return undefined;
    this.db.run("UPDATE spieltage SET active = 1 WHERE id = ?", latest.id);
    return { id: latest.id, dateKey: latest.date_key };
  }

  private insertSpieltag(mode: "offline" | "online", startedAt = Date.now()): { id: string; dateKey: string } {
    const id = randomUUID();
    const key = dateKey(startedAt);
    this.db.run("UPDATE spieltage SET active = 0");
    this.db.run(
      `INSERT INTO spieltage (id, date_key, started_at, updated_at, mode, summary, payload, active)
       VALUES (?, ?, ?, ?, ?, '', '{}', 1)`,
      id,
      key,
      startedAt,
      startedAt,
      mode,
    );
    return { id, dateKey: key };
  }

  ensureTodaySpieltag(
    mode: "offline" | "online",
    roomCode?: string | null,
    board?: BoardIdentity | null,
  ): { id: string; dateKey: string } {
    const today = dateKey();
    let current = this.currentSpieltag();
    if (!current || current.dateKey !== today) {
      current = this.insertSpieltag(mode);
    }
    if (roomCode) {
      this.db.run(
        "INSERT OR IGNORE INTO spieltag_rooms (spieltag_id, room_code) VALUES (?, ?)",
        current.id,
        roomCode,
      );
    }
    if (board?.id) this.touchBoard(board);
    this.refreshSpieltag(current.id);
    return current;
  }

  startNewSpieltag(mode: "offline" | "online"): SpieltagDetail {
    const created = this.insertSpieltag(mode);
    this.refreshSpieltag(created.id);
    return this.getSpieltag(created.id)!;
  }

  refreshSpieltag(id: string): void {
    const row = this.db.get<{ id: string; date_key: string; mode: string; started_at: number }>(
      "SELECT id, date_key, mode, started_at FROM spieltage WHERE id = ?",
      id,
    );
    if (!row) return;
    const reports = this.listReportsForSpieltag(id);
    const rooms = this.db
      .all<{ room_code: string }>(
        "SELECT room_code FROM spieltag_rooms WHERE spieltag_id = ? ORDER BY room_code",
        id,
      )
      .map((r) => r.room_code);
    const boards = [...new Map(reports.filter((r) => r.boardId).map((r) => [r.boardId!, r.boardName ?? "Scheibe"]))];
    const clubWins = new Map<string, number>();
    for (const report of reports) {
      if (report.payload.winnerId) {
        const winner = report.payload.players.find((p) => p.id === report.payload.winnerId);
        if (winner?.teamName) clubWins.set(winner.teamName, (clubWins.get(winner.teamName) ?? 0) + 1);
      }
    }
    const clubLine =
      clubWins.size > 0
        ? [...clubWins.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, wins]) => `${name} ${wins}`)
            .join(" – ")
        : "";
    const started = new Date(Number(row.started_at)).toLocaleString("de-DE", {
      dateStyle: "short",
      timeStyle: "short",
    });
    const summary =
      reports.length === 0
        ? `Spieltag ${started}: noch keine abgeschlossenen Spiele.`
        : `Spieltag ${started}: ${reports.length} Spiele${clubLine ? `, Teams ${clubLine}` : ""}.`;
    const payload = {
      dateKey: row.date_key,
      startedAt: Number(row.started_at),
      matchCount: reports.length,
      rooms,
      boards: boards.map(([boardId, name]) => ({ id: boardId, name })),
      clubWins: Object.fromEntries(clubWins),
      summaries: reports.map((r) => r.summary),
    };
    this.db.run(
      "UPDATE spieltage SET updated_at = ?, summary = ?, payload = ? WHERE id = ?",
      Date.now(),
      summary,
      JSON.stringify(payload),
      id,
    );
  }

  rebuildTodaySpieltag(mode: "offline" | "online"): SpieltagDetail {
    const created = this.ensureTodaySpieltag(mode, null, null);
    this.refreshSpieltag(created.id);
    return this.getSpieltag(created.id)!;
  }

  listSpieltage(): SpieltagListItem[] {
    return this.db
      .all<{
        id: string;
        date_key: string;
        started_at: number;
        updated_at: number;
        mode: string;
        summary: string;
        active?: number;
      }>("SELECT id, date_key, started_at, updated_at, mode, summary, active FROM spieltage ORDER BY started_at DESC")
      .map((row) => {
        const matchCount = this.listReportsForSpieltag(row.id).length;
        const roomCount = num(
          this.db.get<{ n: number }>(
            "SELECT COUNT(*) as n FROM spieltag_rooms WHERE spieltag_id = ?",
            row.id,
          )?.n,
        );
        return {
          id: row.id,
          dateKey: row.date_key,
          startedAt: Number(row.started_at),
          updatedAt: Number(row.updated_at),
          mode: row.mode,
          matchCount,
          roomCount,
          summary: row.summary,
        };
      });
  }

  getSpieltag(id: string): SpieltagDetail | undefined {
    const row = this.db.get<{
      id: string;
      date_key: string;
      started_at: number;
      updated_at: number;
      mode: string;
      summary: string;
    }>("SELECT id, date_key, started_at, updated_at, mode, summary FROM spieltage WHERE id = ?", id);
    if (!row) return undefined;
    const reports = this.listReportsForSpieltag(id);
    const rooms = this.db
      .all<{ room_code: string }>(
        "SELECT room_code FROM spieltag_rooms WHERE spieltag_id = ? ORDER BY room_code",
        id,
      )
      .map((r) => r.room_code);
    const boardIds = [...new Set(reports.map((r) => r.boardId).filter(Boolean))] as string[];
    const boards = this.listBoards().filter((b) => boardIds.includes(b.id));
    const item: SpieltagListItem = {
      id: row.id,
      dateKey: row.date_key,
      startedAt: Number(row.started_at),
      updatedAt: Number(row.updated_at),
      mode: row.mode,
      matchCount: reports.length,
      roomCount: rooms.length,
      summary: row.summary,
    };
    const title = new Date(Number(row.started_at)).toLocaleString("de-DE", {
      dateStyle: "short",
      timeStyle: "short",
    });
    return {
      ...item,
      rooms,
      boards,
      reports,
      html: this.dayReportHtml(reports, title),
    };
  }

  recordFinishedMatch(
    state: MatchState,
    mode: "offline" | "online",
    board?: BoardIdentity | null,
  ): MatchAnalysisPayload | null {
    if (state.status !== "matchOver") return null;
    if (!state.id) return null;
    if (this.hasAnalysis(state.id)) return null;

    const players = state.config.players.map((p) => {
      const registered = this.getPlayer(p.id);
      const matchPlayer = toMatchPlayer({
        ...p,
        teamId: p.teamId ?? registered?.teamId ?? null,
        teamName: p.teamName ?? registered?.teamName ?? null,
      });
      return { ...matchPlayer, passNr: registered?.passNr ?? null };
    });
    const tagged: MatchState = { ...state, config: { ...state.config, players } };
    const payload = computeMatchAnalysis(tagged);
    const id = randomUUID();
    this.touchBoard(board ?? undefined);
    this.db.run(
      `INSERT INTO match_analyses (id, match_id, played_at, mode, game_type, opponents, player_stats, winner_id, scoreline, board_id, board_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      payload.matchId,
      payload.playedAt,
      mode,
      payload.gameType,
      JSON.stringify(payload.opponents),
      JSON.stringify(payload.playerStats),
      payload.winnerId,
      payload.scoreline,
      board?.id ?? null,
      board?.name ?? null,
    );

    if (this.shouldWriteDayReport(players)) {
      const spieltag = this.ensureTodaySpieltag(mode, null, board ?? null);
      const matchNumber = this.listReportsForSpieltag(spieltag.id).length + 1;
      const report = computeMatchReport(tagged, Date.now(), matchNumber);
      this.db.run(
        `INSERT INTO match_reports (id, match_id, played_at, mode, game_type, board_id, board_name, summary, payload, synced, spieltag_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        randomUUID(),
        report.matchId,
        report.playedAt,
        mode,
        report.gameType,
        board?.id ?? null,
        board?.name ?? null,
        report.summary,
        JSON.stringify(report),
        mode === "online" ? 1 : 0,
        spieltag.id,
      );
      this.refreshSpieltag(spieltag.id);
    }

    for (const player of payload.opponents) {
      if (!this.getPlayer(player.id)) continue;
      this.db.run(
        "INSERT OR IGNORE INTO match_analysis_players (analysis_id, player_id) VALUES (?, ?)",
        id,
        player.id,
      );
      const stats = coerceStats(payload.playerStats[player.id]);
      const life = this.getLifetime(player.id);
      this.db.run(
        `UPDATE player_stats SET
          total_points = total_points + ?,
          darts_thrown = darts_thrown + ?,
          misses = misses + ?,
          visits = visits + ?,
          plus_60 = plus_60 + ?,
          plus_80 = plus_80 + ?,
          plus_100 = plus_100 + ?,
          plus_120 = plus_120 + ?,
          plus_140 = plus_140 + ?,
          score_180 = score_180 + ?,
          matches = matches + 1,
          matches_won = matches_won + ?,
          matches_lost = matches_lost + ?,
          legs_won = legs_won + ?,
          legs_lost = legs_lost + ?,
          first3_points = first3_points + ?,
          first3_darts = first3_darts + ?,
          first9_points = first9_points + ?,
          first9_darts = first9_darts + ?,
          highest_finish = MAX(highest_finish, ?),
          checkout_hits = checkout_hits + ?,
          checkout_attempts = checkout_attempts + ?,
          highest_visit = MAX(highest_visit, ?),
          score_26 = score_26 + ?
         WHERE player_id = ?`,
        stats.totalPoints,
        stats.dartsThrown,
        stats.misses,
        stats.visits,
        stats.plus60,
        stats.plus80,
        stats.plus100,
        stats.plus120,
        stats.plus140,
        stats.score180,
        stats.matchesWon,
        stats.matchesLost,
        stats.legsWon,
        stats.legsLost,
        stats.first3Points,
        stats.first3Darts,
        stats.first9Points,
        stats.first9Darts,
        Math.max(life.highestFinish, stats.highestFinish),
        stats.checkoutHits,
        stats.checkoutAttempts,
        Math.max(life.highestVisit, stats.highestVisit),
        stats.score26,
        player.id,
      );
    }
    return payload;
  }

  revertMatch(matchId: string): void {
    const row = this.db.get<{
      id: string;
      match_id: string;
      played_at: number;
      mode: string;
      game_type: string;
      opponents: string;
      player_stats: string;
      winner_id?: string | null;
      scoreline?: string | null;
      board_id?: string | null;
      board_name?: string | null;
    }>("SELECT * FROM match_analyses WHERE match_id = ?", matchId);
    if (!row) return;
    const analysis = this.parseAnalysis(row);
    for (const player of analysis.opponents) {
      const stats = analysis.playerStats[player.id];
      if (!stats || !this.getPlayer(player.id)) continue;
      this.db.run(
        `UPDATE player_stats SET
          total_points = MAX(0, total_points - ?),
          darts_thrown = MAX(0, darts_thrown - ?),
          misses = MAX(0, misses - ?),
          visits = MAX(0, visits - ?),
          plus_60 = MAX(0, plus_60 - ?),
          plus_80 = MAX(0, plus_80 - ?),
          plus_100 = MAX(0, plus_100 - ?),
          plus_120 = MAX(0, plus_120 - ?),
          plus_140 = MAX(0, plus_140 - ?),
          score_180 = MAX(0, score_180 - ?),
          matches = MAX(0, matches - 1),
          matches_won = MAX(0, matches_won - ?),
          matches_lost = MAX(0, matches_lost - ?),
          legs_won = MAX(0, legs_won - ?),
          legs_lost = MAX(0, legs_lost - ?),
          first3_points = MAX(0, first3_points - ?),
          first3_darts = MAX(0, first3_darts - ?),
          first9_points = MAX(0, first9_points - ?),
          first9_darts = MAX(0, first9_darts - ?),
          checkout_hits = MAX(0, checkout_hits - ?),
          checkout_attempts = MAX(0, checkout_attempts - ?),
          score_26 = MAX(0, score_26 - ?)
         WHERE player_id = ?`,
        stats.totalPoints,
        stats.dartsThrown,
        stats.misses,
        stats.visits,
        stats.plus60,
        stats.plus80,
        stats.plus100,
        stats.plus120,
        stats.plus140,
        stats.score180,
        stats.matchesWon,
        stats.matchesLost,
        stats.legsWon,
        stats.legsLost,
        stats.first3Points,
        stats.first3Darts,
        stats.first9Points,
        stats.first9Darts,
        stats.checkoutHits,
        stats.checkoutAttempts,
        stats.score26,
        player.id,
      );
    }
    this.db.run("DELETE FROM match_analyses WHERE id = ?", analysis.id);
    this.db.run("DELETE FROM match_reports WHERE match_id = ?", matchId);
  }

  parseReport(row: {
    id: string;
    match_id: string;
    played_at: number;
    mode: string;
    game_type: string;
    board_id?: string | null;
    board_name?: string | null;
    summary: string;
    payload: string;
    synced?: number;
  }): StoredMatchReport {
    const raw = JSON.parse(row.payload) as Partial<MatchReportPayload>;
    const players = (raw.players ?? []).map((p) => {
      const registered = this.getPlayer(p.id);
      return {
        ...p,
        name: inGamePlayerName(p.name),
        teamName: p.teamName ?? registered?.teamName ?? null,
        passNr: normalizePassNr(p.passNr) ?? registered?.passNr ?? null,
      };
    });
    const scoreline = raw.scoreline || raw.endstand || "";
    const matchNumber = raw.matchNumber ?? 1;
    const payload: MatchReportPayload = {
      matchId: raw.matchId || row.match_id,
      playedAt: raw.playedAt ?? Number(row.played_at),
      gameType: (raw.gameType || row.game_type) as MatchReportPayload["gameType"],
      gameTitle: raw.gameTitle || "",
      players,
      winnerId: raw.winnerId ?? null,
      winnerName: raw.winnerId ? reportPlayerLabel(players, raw.winnerId, raw.winnerName ?? "") : raw.winnerName ?? "",
      scoreline,
      endstand: raw.endstand || scoreline,
      matchNumber,
      headline: matchHeadlineSafe(players, matchNumber, raw.headline),
      dartsThrown: raw.dartsThrown ?? 0,
      roundCount: raw.roundCount ?? 0,
      checkout: raw.checkout ?? null,
      summary: raw.summary || row.summary,
      playerStats: raw.playerStats ?? {},
      legs: Array.isArray(raw.legs)
        ? raw.legs.map((leg) => ({
            ...leg,
            winnerName: reportPlayerLabel(players, leg.winnerId, leg.winnerName),
            starterName: reportPlayerLabel(players, leg.starterId, leg.starterName),
          }))
        : [],
    };
    return {
      id: row.id,
      matchId: row.match_id,
      playedAt: Number(row.played_at),
      mode: row.mode === "online" ? "online" : "offline",
      gameType: row.game_type as GameType,
      boardId: row.board_id || null,
      boardName: row.board_name || null,
      summary: payload.summary,
      payload,
      synced: Number(row.synced ?? 1) !== 0,
    };
  }

  listReportsForSpieltag(id: string): StoredMatchReport[] {
    return this.db
      .all<Parameters<StatsStore["parseReport"]>[0]>(
        "SELECT * FROM match_reports WHERE spieltag_id = ? ORDER BY played_at ASC",
        id,
      )
      .map((row) => this.parseReport(row));
  }

  listReports(from: number, to: number, boardId?: string | null): StoredMatchReport[] {
    const rows = boardId
      ? this.db.all<Parameters<StatsStore["parseReport"]>[0]>(
          "SELECT * FROM match_reports WHERE played_at >= ? AND played_at < ? AND board_id = ? ORDER BY played_at ASC",
          from,
          to,
          boardId,
        )
      : this.db.all<Parameters<StatsStore["parseReport"]>[0]>(
          "SELECT * FROM match_reports WHERE played_at >= ? AND played_at < ? ORDER BY played_at ASC",
          from,
          to,
        );
    return rows.map((row) => this.parseReport(row));
  }

  listUnsyncedReports(): StoredMatchReport[] {
    return this.db
      .all<Parameters<StatsStore["parseReport"]>[0]>(
        "SELECT * FROM match_reports WHERE synced = 0 ORDER BY played_at ASC",
      )
      .map((row) => this.parseReport(row));
  }

  markReportsSynced(ids: string[]): void {
    for (const id of ids) this.db.run("UPDATE match_reports SET synced = 1 WHERE id = ?", id);
  }

  importRemoteReport(report: StoredMatchReport, board?: BoardIdentity | null): boolean {
    if (this.hasAnalysis(report.matchId)) return false;
    if (this.db.get<{ id: string }>("SELECT id FROM match_reports WHERE match_id = ?", report.matchId)) {
      this.db.run("UPDATE match_reports SET synced = 1 WHERE match_id = ?", report.matchId);
      return false;
    }
    const boardId = board?.id ?? report.boardId;
    const boardName = board?.name ?? report.boardName;
    if (boardId) this.touchBoard({ id: boardId, name: boardName || "Scheibe" });
    const reportPlayers = report.payload?.players ?? [];
    if (!this.shouldWriteDayReport(reportPlayers)) return false;
    const spieltag = this.ensureTodaySpieltag(report.mode, null, boardId ? { id: boardId, name: boardName || "Scheibe" } : null);
    this.db.run(
      `INSERT INTO match_reports (id, match_id, played_at, mode, game_type, board_id, board_name, summary, payload, synced, spieltag_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      report.id || randomUUID(),
      report.matchId,
      report.playedAt,
      report.mode,
      report.gameType,
      boardId,
      boardName,
      report.summary,
      JSON.stringify(report.payload),
      spieltag.id,
    );
    return true;
  }

  headToHead(): HeadToHeadRow[] {
    const names = new Map(this.listPlayers().map((p) => [p.id, p.name]));
    const counts = new Map<string, number>();
    for (const analysis of this.listAllAnalyses()) {
      if (!analysis.winnerId) continue;
      for (const opp of analysis.opponents) {
        if (opp.id === analysis.winnerId) continue;
        const key = `${analysis.winnerId}::${opp.id}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        if (!names.has(opp.id)) names.set(opp.id, opp.name);
      }
      const winner = analysis.opponents.find((p) => p.id === analysis.winnerId);
      if (winner && !names.has(winner.id)) names.set(winner.id, winner.name);
    }
    return [...counts.entries()]
      .map(([key, wins]) => {
        const [winnerId, loserId] = key.split("::");
        return {
          winnerId: winnerId!,
          winnerName: names.get(winnerId!) ?? winnerId!,
          loserId: loserId!,
          loserName: names.get(loserId!) ?? loserId!,
          wins,
        };
      })
      .sort((a, b) => b.wins - a.wins || a.winnerName.localeCompare(b.winnerName, "de"));
  }

  dayReportHtml(reports: StoredMatchReport[], dateLabel: string): string {
    const blocks = reports
      .map((r) => {
        const headline =
          r.payload.headline ||
          `Spiel ${r.payload.matchNumber ?? 1} — ${r.payload.players.map((p) => formatPlayerPassLabel(p)).join(" vs ")}`;
        const endstand = r.payload.endstand || r.payload.scoreline || "–";
        const meta = [
          r.boardName ?? "Scheibe",
          new Date(r.playedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
        ].join(" · ");
        return matchReportTableHtml({
          headline,
          endstand,
          meta,
          players: r.payload.players,
          legs: r.payload.legs ?? [],
        });
      })
      .join("");
    return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tagesbericht ${escapeHtml(dateLabel)}</title>
<style>${MATCH_REPORT_HTML_STYLES}</style></head>
<body>
<h1>Tagesbericht ${escapeHtml(dateLabel)}</h1>
<p>${reports.length} Spiele</p>
${blocks || "<p>Keine Spiele in diesem Spieltag.</p>"}
</body></html>`;
  }

  dayReportCsv(reports: StoredMatchReport[]): string {
    const header = [
      "playedAt",
      "board",
      "headline",
      "players",
      "endstand",
      "dartsThrown",
      "roundCount",
      "checkout",
      "summary",
    ];
    const lines = [header.join(",")];
    for (const report of reports) {
      lines.push(
        [
          new Date(report.playedAt).toISOString(),
          csvCell(report.boardName ?? ""),
          csvCell(report.payload.headline ?? ""),
          csvCell(report.payload.players.map((p) => formatPlayerPassLabel(p)).join(" vs ")),
          csvCell(report.payload.endstand || report.payload.scoreline),
          report.payload.dartsThrown,
          report.payload.roundCount,
          report.payload.checkout ?? "",
          csvCell(report.summary),
        ].join(","),
      );
    }
    lines.push("");
    lines.push(["match", "leg", "winner", "opponentRemaining", "winnerDarts", "allDarts", "checkout", "beginner", "average"].join(","));
    for (const report of reports) {
      for (const leg of report.payload.legs ?? []) {
        const darts = Object.entries(leg.playerDarts)
          .map(([id, n]) => `${formatPlayerPassLabel(report.payload.players.find((p) => p.id === id) ?? { name: id })}:${n}`)
          .join(" ");
        lines.push(
          [
            csvCell(report.payload.headline ?? report.matchId),
            leg.legNumber,
            csvCell(leg.winnerName),
            csvCell(leg.opponentRemainingLabel),
            leg.winnerDarts,
            csvCell(darts),
            leg.checkout ?? "",
            csvCell(leg.starterName),
            leg.winnerAverage.toFixed(1),
          ].join(","),
        );
      }
    }
    return `${lines.join("\n")}\n`;
  }

  resetPlayerStats(playerId: string): boolean {
    if (!this.getPlayer(playerId)) return false;
    this.db.run("DELETE FROM match_analysis_players WHERE player_id = ?", playerId);
    this.db.run(
      `UPDATE player_stats SET
        total_points = 0, darts_thrown = 0, misses = 0, visits = 0,
        plus_60 = 0, plus_80 = 0, plus_100 = 0, plus_120 = 0, plus_140 = 0,
        score_180 = 0, matches = 0,
        matches_won = 0, matches_lost = 0, legs_won = 0, legs_lost = 0,
        first3_points = 0, first3_darts = 0, first9_points = 0, first9_darts = 0,
        highest_finish = 0, checkout_hits = 0, checkout_attempts = 0,
        highest_visit = 0, score_26 = 0
       WHERE player_id = ?`,
      playerId,
    );
    return true;
  }

  resetAllStats(): void {
    this.db.exec("DELETE FROM match_analysis_players");
    this.db.exec("DELETE FROM match_analyses");
    this.db.exec(
      `UPDATE player_stats SET
        total_points = 0, darts_thrown = 0, misses = 0, visits = 0,
        plus_60 = 0, plus_80 = 0, plus_100 = 0, plus_120 = 0, plus_140 = 0,
        score_180 = 0, matches = 0,
        matches_won = 0, matches_lost = 0, legs_won = 0, legs_lost = 0,
        first3_points = 0, first3_darts = 0, first9_points = 0, first9_darts = 0,
        highest_finish = 0, checkout_hits = 0, checkout_attempts = 0,
        highest_visit = 0, score_26 = 0`,
    );
  }

  exportData(): {
    players: RegisteredPlayer[];
    teams: TeamTree[];
    lifetime: LifetimeRow[];
    analyses: StoredMatchAnalysis[];
    reports: StoredMatchReport[];
    spieltage: SpieltagListItem[];
    headToHead: HeadToHeadRow[];
    boards: BoardInfo[];
  } {
    return {
      players: this.listPlayers(),
      teams: this.listTeamTree(),
      lifetime: this.listPlayers().map((p) => this.getLifetime(p.id)),
      analyses: this.listAllAnalyses(),
      reports: this.db
        .all<Parameters<StatsStore["parseReport"]>[0]>("SELECT * FROM match_reports ORDER BY played_at DESC")
        .map((row) => this.parseReport(row)),
      spieltage: this.listSpieltage(),
      headToHead: this.headToHead(),
      boards: this.listBoards(),
    };
  }

  exportCsv(): string {
    const header = [
      "playerId",
      "name",
      "passNr",
      "team",
      "average",
      "first3Average",
      "first9Average",
      "totalPoints",
      "dartsThrown",
      "misses",
      "visits",
      "plus60",
      "plus80",
      "plus100",
      "plus120",
      "plus140",
      "score180",
      "score26",
      "matches",
      "matchesWon",
      "matchesLost",
      "legsWon",
      "legsLost",
      "highestFinish",
      "checkoutPercent",
      "highestVisit",
    ];
    const lines = [header.join(",")];
    for (const player of this.listPlayers()) {
      const life = this.getLifetime(player.id);
      lines.push(
        [
          player.id,
          csvCell(player.name),
          csvCell(player.passNr ?? ""),
          csvCell(player.teamName ?? ""),
          life.average.toFixed(2),
          life.first3Average.toFixed(2),
          life.first9Average.toFixed(2),
          life.totalPoints,
          life.dartsThrown,
          life.misses,
          life.visits,
          life.plus60,
          life.plus80,
          life.plus100,
          life.plus120,
          life.plus140,
          life.score180,
          life.score26,
          life.matches,
          life.matchesWon,
          life.matchesLost,
          life.legsWon,
          life.legsLost,
          life.highestFinish,
          life.checkoutPercent.toFixed(1),
          life.highestVisit,
        ].join(","),
      );
    }
    lines.push("");
    lines.push("winner,loser,wins");
    for (const row of this.headToHead()) {
      lines.push([csvCell(row.winnerName), csvCell(row.loserName), row.wins].join(","));
    }
    lines.push("");
    lines.push("matchId,playedAt,mode,gameType,opponents,playerStats");
    for (const analysis of this.listAllAnalyses()) {
      lines.push(
        [
          analysis.matchId,
          new Date(analysis.playedAt).toISOString(),
          analysis.mode,
          analysis.gameType,
          csvCell(analysis.opponents.map((p) => p.name).join(" vs ")),
          csvCell(JSON.stringify(analysis.playerStats)),
        ].join(","),
      );
    }
    return `${lines.join("\n")}\n`;
  }
}

function matchHeadlineSafe(players: Player[], matchNumber: number, fallback?: string): string {
  if (players.length) return matchHeadline(players, matchNumber);
  return fallback || `Spiel ${matchNumber}`;
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function isUniqueConstraint(err: unknown): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return /unique|constraint/i.test(message);
}

export async function openStatsStore(filePath = defaultDbPath()): Promise<StatsStore> {
  const db = mysqlConfigured() ? await openMysqlDb() : await openMiniDb(filePath);
  return new StatsStore(db);
}

export { AVERAGE_RULE_DE };
