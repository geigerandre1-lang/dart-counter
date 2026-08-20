import { randomUUID } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import express, { type Express, type Request, type Response } from "express";
import { WebSocket, WebSocketServer } from "ws";
import {
  applyAction,
  createDefaultConfig,
  createMatch,
  hydrateMatch,
  isLiveMonitorMatch,
  normalizeConfig,
  toMatchPlayer,
  preferLanUrl,
  ROOM_IDLE_MS,
  STEELDART_APP,
  type ClientAction,
  type LocalSave,
  type MatchConfig,
  type MatchState,
  type MonitorGameSnapshot,
  type RoomSnapshot,
  type WsClientMessage,
} from "../shared/index.js";
import {
  MAX_ONLINE_ROOMS,
  adminTokenValid,
  authorizeRoomCreate,
  issueAdminToken,
  passwordsMatch,
  getAdminPassword,
  revokeAdminToken,
  roomCapError,
} from "./admin.js";
import { defaultDbPath } from "./sqlite.js";
import { openStatsStore, type StatsStore } from "./store.js";

const LOCAL_CODE = "LOCAL";
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export type DeployMode = "offline" | "online";

export { STEELDART_APP };
const PORT_FALLBACKS = 10;

export function deployModeFromEnv(raw: string | undefined = process.env.STEELDART_MODE): DeployMode {
  return String(raw ?? "").trim().toLowerCase() === "online" ? "online" : "offline";
}

function bootLog(...args: unknown[]): void {
  const line = `[${new Date().toISOString()}] ${args.map((a) => String(a)).join(" ")}`;
  try {
    fs.writeSync(1, `${line}\n`);
  } catch {
    console.log(line);
  }
}

function tcpPortOpen(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.setTimeout(400, () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
  });
}

async function isOurServerOn(port: number): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(600) });
    if (!res.ok) return false;
    const data = (await res.json()) as { app?: string };
    return data.app === STEELDART_APP;
  } catch {
    return false;
  }
}

function bindPort(server: http.Server, host: string, port: number, exclusive = true): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => reject(err);
    server.once("error", onError);
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    try {
      server.listen({ port, host, exclusive }, onListening);
    } catch (err) {
      server.off("error", onError);
      reject(err);
    }
  });
}

function parseListenPort(raw: string | undefined): number | undefined {
  if (raw == null) return undefined;
  const trimmed = String(raw).trim();
  if (trimmed === "") return undefined;
  const port = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !/^\d+$/.test(trimmed)) {
    throw new Error(`Ungültiger PORT: ${raw}`);
  }
  return port;
}

/** Hostinger/PaaS inject PORT (or APP_PORT). That number is pinned — never hop. */
function envPort(): number | undefined {
  return parseListenPort(process.env.PORT) ?? parseListenPort(process.env.APP_PORT);
}

async function listenExclusive(server: http.Server, host: string, startPort: number): Promise<number> {
  let lastError: NodeJS.ErrnoException | undefined;
  for (let offset = 0; offset <= PORT_FALLBACKS; offset += 1) {
    const port = startPort + offset;
    if (await tcpPortOpen(port)) {
      const ours = await isOurServerOn(port);
      lastError = Object.assign(
        new Error(ours ? `Port ${port} ist bereits von Steeldart belegt.` : `Port ${port} ist belegt.`),
        { code: "EADDRINUSE" },
      );
      continue;
    }
    try {
      await bindPort(server, host, port);
      if (offset > 0) {
        console.warn(`Port ${startPort} ist belegt — weiche auf ${port} aus.`);
      }
      return port;
    } catch (err) {
      lastError = err as NodeJS.ErrnoException;
      if (lastError.code !== "EADDRINUSE") throw lastError;
    }
  }
  throw lastError ?? Object.assign(new Error(`Port ${startPort} ist belegt.`), { code: "EADDRINUSE" });
}

export interface StartServerOptions {
  port?: number;
  host?: string;
  mode?: DeployMode;
  publicDir?: string | null;
  persistPath?: string | null;
  restore?: LocalSave | null;
  dbPath?: string | null;
}

export interface StartedServer {
  app: Express;
  server: http.Server;
  port: number;
  host: string;
  mode: DeployMode;
  lanUrls: string[];
  store: StatsStore;
  close: () => Promise<void>;
}

interface Room {
  code: string;
  mode: "local" | "online";
  config: MatchConfig;
  match: MatchState | null;
  clients: Map<WebSocket, string>;
  lastActive: number;
  hostClientId?: string;
  boardId?: string | null;
  boardName?: string | null;
}

export function findPublicDir(explicit?: string | null): string | null {
  const candidates = [
    explicit,
    path.join(process.cwd(), "dist/client"),
    path.join(process.cwd(), "dist", "client"),
  ].filter((d): d is string => Boolean(d));
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

function generateCode(rooms: Map<string, Room>): string {
  let code = "";
  for (let i = 0; i < 5; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  if (rooms.has(code)) return generateCode(rooms);
  return code;
}

export function lanUrls(port: number): string[] {
  const urls: string[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    if (!iface) continue;
    for (const addr of iface) {
      if (addr.family !== "IPv4" || addr.internal) continue;
      urls.push(`http://${addr.address}:${port}`);
    }
  }
  const best = preferLanUrl(urls);
  if (!best) return urls;
  return [best, ...urls.filter((u) => u !== best)];
}

function send(ws: WebSocket, data: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

function snapshotFor(room: Room, clientId: string, port: number): RoomSnapshot {
  return {
    code: room.code,
    mode: room.mode,
    phase: room.match ? "match" : "setup",
    config: room.config,
    match: room.match,
    lanUrls: lanUrls(port),
    clientId,
    isHost: clientId === room.hostClientId,
  };
}

function broadcast(room: Room, port: number): void {
  touch(room);
  for (const [client, clientId] of room.clients) {
    send(client, { type: "snapshot", snapshot: snapshotFor(room, clientId, port) });
  }
}

function touch(room: Room): void {
  room.lastActive = Date.now();
}

function writePersist(file: string | null | undefined, room: Room | undefined): void {
  if (!file || !room) return;
  const payload: LocalSave = {
    savedAt: Date.now(),
    config: room.config,
    match: room.match,
  };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload)}\n`);
}

function currentPlayerId(match: MatchState): string {
  return match.config.players[match.currentLeg.currentPlayerIndex]!.id;
}

function injectTurn(match: MatchState, action: ClientAction): ClientAction {
  if (action.type === "THROW_DART" || action.type === "SET_VISIT_TOTAL" || action.type === "CONFIRM_VISIT") {
    return { ...action, playerId: currentPlayerId(match) };
  }
  return action;
}

function readAdminToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (typeof header === "string" && header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  const bodyToken = req.body && typeof req.body.token === "string" ? req.body.token : undefined;
  const queryToken = typeof req.query.token === "string" ? req.query.token : undefined;
  return bodyToken || queryToken;
}

export async function startServer(options: StartServerOptions = {}): Promise<StartedServer> {
  const pinnedEnvPort = envPort();
  const hop = pinnedEnvPort == null;
  const runtime = { port: pinnedEnvPort ?? options.port ?? 3000 };
  const HOST = options.host ?? process.env.HOST ?? "0.0.0.0";
  const DEPLOY_MODE: DeployMode = options.mode ?? deployModeFromEnv();
  bootLog(
    "steeldart startServer",
    `mode=${DEPLOY_MODE}`,
    `STEELDART_MODE=${process.env.STEELDART_MODE ?? ""}`,
    `PORT=${process.env.PORT ?? ""}`,
    `APP_PORT=${process.env.APP_PORT ?? ""}`,
    `HOST=${HOST}`,
    `hop=${hop}`,
    `bind=${runtime.port}`,
  );
  const persistPath = options.persistPath ?? null;
  const store = await openStatsStore(options.dbPath ?? defaultDbPath());

  const rooms = new Map<string, Room>();
  const app = express();
  app.get("/healthz", (_req, res) => {
    res.status(200).type("text/plain").send("ok");
  });
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
      res.setHeader("Access-Control-Allow-Private-Network", "true");
    }
    if (req.method === "OPTIONS" && req.path.startsWith("/api")) {
      res.status(204).end();
      return;
    }
    next();
  });
  app.use(express.json());

  const requireAdmin = (req: Request, res: Response): boolean => {
    if (!adminTokenValid(readAdminToken(req))) {
      res.status(401).json({ ok: false, error: "Nicht angemeldet." });
      return false;
    }
    return true;
  };

  const boardOf = (room: Room) =>
    room.boardId ? { id: room.boardId, name: room.boardName || "Scheibe" } : null;

  const applyBoard = (room: Room, boardId?: string, boardName?: string) => {
    if (boardId) {
      room.boardId = boardId;
      room.boardName = boardName || room.boardName || "Scheibe";
    }
  };

  const finalizeMatch = (match: MatchState | null, room: Room): void => {
    if (match?.status === "matchOver") {
      store.recordFinishedMatch(match, DEPLOY_MODE, boardOf(room));
    }
  };

  const attachSpieltag = (room: Room): void => {
    const players = room.match?.config.players ?? room.config.players;
    if (!store.shouldWriteDayReport(players)) return;
    store.ensureTodaySpieltag(DEPLOY_MODE, room.code, boardOf(room));
  };

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/info", (_req, res) => {
    res.json({
      app: STEELDART_APP,
      mode: DEPLOY_MODE,
      port: runtime.port,
      lanUrls: lanUrls(runtime.port),
      roomCount: DEPLOY_MODE === "online" ? rooms.size : 1,
      maxRooms: DEPLOY_MODE === "online" ? MAX_ONLINE_ROOMS : 1,
    });
  });

  const liveMonitorGames = (): MonitorGameSnapshot[] => {
    const games: MonitorGameSnapshot[] = [];
    for (const room of rooms.values()) {
      if (!isLiveMonitorMatch(room.match)) continue;
      if (room.clients.size < 1) continue;
      games.push({
        boardName: room.boardName?.trim() || null,
        occupancy: room.clients.size,
        match: room.match!,
      });
    }
    return games;
  };

  app.get("/api/monitor", (_req, res) => {
    if (DEPLOY_MODE !== "online") {
      res.status(404).json({ ok: false, error: "Monitor nur auf dem Webserver verfügbar." });
      return;
    }
    res.json({ games: liveMonitorGames() });
  });

  app.post("/api/admin/login", (req, res) => {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!passwordsMatch(password, getAdminPassword())) {
      res.status(401).json({ ok: false, error: "Falsches Passwort." });
      return;
    }
    res.json({ ok: true, token: issueAdminToken() });
  });

  app.post("/api/admin/verify", (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    if (!adminTokenValid(token)) {
      res.status(401).json({ ok: false, error: "Nicht angemeldet." });
      return;
    }
    res.json({ ok: true });
  });

  app.post("/api/admin/logout", (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    revokeAdminToken(token);
    res.json({ ok: true });
  });

  app.get("/api/players", (_req, res) => {
    res.json({ players: store.listPlayers() });
  });

  app.post("/api/players", (req, res) => {
    const name = typeof req.body?.name === "string" ? req.body.name : "";
    const passNr = typeof req.body?.passNr === "string" ? req.body.passNr : null;
    const result = store.createPlayer(name, { passNr: passNr || null });
    if (!result.ok) {
      res.status(409).json(result);
      return;
    }
    res.json(result);
  });

  app.get("/api/stats", (_req, res) => {
    res.json({
      players: store.listPlayerStats(),
      rule: "3-Dart-Average: 3 × Punkte / geworfene Darts. Busts geben 0 Punkte, die Darts zählen mit. First-3 = erste Aufnahme je Leg, First-9 = erste drei Aufnahmen je Leg.",
      headToHead: store.headToHead(),
      spieltage: store.listSpieltage(),
      boards: store.listBoards(),
      teams: store.listTeamTree(),
    });
  });

  app.get("/api/stats/:playerId", (req, res) => {
    const view = store.playerStats(String(req.params.playerId ?? ""));
    if (!view) {
      res.status(404).json({ ok: false, error: "Spieler nicht gefunden." });
      return;
    }
    res.json(view);
  });

  app.get("/api/teams", (_req, res) => {
    res.json({ teams: store.listTeamTree() });
  });

  app.post("/api/admin/teams", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const result = store.createTeam(typeof req.body?.name === "string" ? req.body.name : "");
    if (!result.ok) {
      res.status(409).json(result);
      return;
    }
    res.json(result);
  });

  app.post("/api/admin/teams/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const result = store.renameTeam(String(req.params.id ?? ""), typeof req.body?.name === "string" ? req.body.name : "");
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  });

  app.delete("/api/admin/teams/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const result = store.deleteTeam(String(req.params.id ?? ""));
    if (!result.ok) {
      res.status(result.error.includes("nicht gefunden") ? 404 : 409).json(result);
      return;
    }
    res.json({ ok: true });
  });

  app.post("/api/admin/teams/:id/players", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const result = store.createTeamPlayer(
      String(req.params.id ?? ""),
      typeof req.body?.name === "string" ? req.body.name : "",
      typeof req.body?.passNr === "string" ? req.body.passNr || null : null,
    );
    if (!result.ok) {
      res.status(/bereits vorhanden|PassNr/.test(result.error) ? 409 : 400).json(result);
      return;
    }
    res.json(result);
  });

  app.post("/api/admin/roster/import", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const csv = typeof req.body?.csv === "string" ? req.body.csv : "";
    const result = store.importRoster(csv);
    res.json(result);
  });

  const playerInActiveMatch = (playerId: string): boolean => {
    for (const room of rooms.values()) {
      if (!room.match || room.match.status === "matchOver") continue;
      const ids = room.match.config.players.map((p) => p.id);
      if (ids.includes(playerId)) return true;
    }
    return false;
  };

  app.post("/api/admin/players/:id/team", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const teamId = req.body?.teamId == null || req.body.teamId === "" ? null : String(req.body.teamId);
    const result = store.setPlayerTeam(String(req.params.id ?? ""), teamId);
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  });

  app.post("/api/admin/players/:id/remove-from-team", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const playerId = String(req.params.id ?? "");
    const teamId = typeof req.body?.teamId === "string" ? req.body.teamId : "";
    const result = store.removePlayerFromTeam(playerId, teamId, {
      keepRecord: playerInActiveMatch(playerId),
    });
    if (!result.ok) {
      res.status(400).json(result);
      return;
    }
    res.json(result);
  });

  app.get("/api/spieltage", (_req, res) => {
    res.json({ spieltage: store.listSpieltage() });
  });

  app.get("/api/spieltage/:id", (req, res) => {
    const detail = store.getSpieltag(String(req.params.id ?? ""));
    if (!detail) {
      res.status(404).json({ ok: false, error: "Spieltag nicht gefunden." });
      return;
    }
    res.json(detail);
  });

  app.post("/api/admin/spieltage/today", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ ok: true, spieltag: store.rebuildTodaySpieltag(DEPLOY_MODE) });
  });

  app.post("/api/admin/spieltage/reset", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ ok: true, spieltag: store.startNewSpieltag(DEPLOY_MODE) });
  });

  app.get("/api/admin/spieltage/:id.html", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const detail = store.getSpieltag(String(req.params.id ?? ""));
    if (!detail) {
      res.status(404).send("Spieltag nicht gefunden.");
      return;
    }
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(detail.html);
  });

  app.get("/api/admin/boards", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ boards: store.listBoards() });
  });

  app.get("/api/admin/head-to-head", (req, res) => {
    if (!requireAdmin(req, res)) return;
    res.json({ rows: store.headToHead() });
  });

  app.post("/api/reports/sync", (req, res) => {
    const reports = Array.isArray(req.body?.reports) ? req.body.reports : [];
    const board =
      typeof req.body?.boardId === "string"
        ? { id: req.body.boardId, name: String(req.body.boardName || "Scheibe") }
        : null;
    let imported = 0;
    for (const report of reports) {
      if (report && typeof report === "object" && store.importRemoteReport(report, board)) imported += 1;
    }
    res.json({ ok: true, imported });
  });

  app.get("/api/admin/export", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const format = String(req.query.format ?? "json").toLowerCase();
    if (format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=steeldart-statistik.csv");
      res.send(store.exportCsv());
      return;
    }
    res.json({ ok: true, ...store.exportData() });
  });

  app.post("/api/admin/stats/reset", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const playerId = typeof req.body?.playerId === "string" ? req.body.playerId : "";
    if (playerId) {
      if (!store.resetPlayerStats(playerId)) {
        res.status(404).json({ ok: false, error: "Spieler nicht gefunden." });
        return;
      }
      res.json({ ok: true });
      return;
    }
    store.resetAllStats();
    res.json({ ok: true });
  });

  app.delete("/api/admin/players/:id", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const playerId = String(req.params.id ?? "");
    if (playerInActiveMatch(playerId)) {
      res.status(409).json({
        ok: false,
        error: "Spieler ist in einem laufenden Match und kann nicht gelöscht werden.",
      });
      return;
    }
    if (!store.deletePlayer(playerId)) {
      res.status(404).json({ ok: false, error: "Spieler nicht gefunden." });
      return;
    }
    res.json({ ok: true });
  });

  app.get("/api/admin/rooms", (req, res) => {
    if (!requireAdmin(req, res)) return;
    const list = [...rooms.values()]
      .filter((room) => room.mode === "online")
      .map((room) => ({
        code: room.code,
        phase: room.match ? "match" : "setup",
        occupancy: room.clients.size,
        status: room.match?.status ?? null,
      }));
    res.json({ rooms: list, maxRooms: MAX_ONLINE_ROOMS, roomCount: list.length });
  });

  app.delete("/api/admin/rooms/:code", (req, res) => {
    if (!requireAdmin(req, res)) return;
    if (DEPLOY_MODE !== "online") {
      res.status(400).json({ ok: false, error: "Räume löschen geht nur im Online-Modus." });
      return;
    }
    const code = String(req.params.code ?? "")
      .trim()
      .toUpperCase();
    const room = rooms.get(code);
    if (!room || room.mode !== "online") {
      res.status(404).json({ ok: false, error: "Raum nicht gefunden." });
      return;
    }
    for (const [client] of room.clients) {
      send(client, { type: "error", message: "Raum wurde geschlossen." });
      try {
        client.close();
      } catch {
        /* ignore */
      }
    }
    finalizeMatch(room.match, room);
    rooms.delete(code);
    res.json({ ok: true });
  });

  const publicDir = findPublicDir(options.publicDir);
  if (publicDir) {
    const spa = (_req: Request, res: Response) => {
      res.sendFile(path.join(publicDir, "index.html"));
    };
    app.get("/monitor/", (_req, res) => {
      res.redirect(302, "/monitor");
    });
    app.get("/monitor", spa);
    app.use(express.static(publicDir));
    app.get("*", spa);
  }

  function defaultRoomConfig(): MatchConfig {
    return normalizeConfig({ ...createDefaultConfig(), players: store.defaultMatchPlayers() });
  }

  function ensureLocalRoom(): Room {
    let room = rooms.get(LOCAL_CODE);
    if (!room) {
      const restore = options.restore;
      room = {
        code: LOCAL_CODE,
        mode: "local",
        config: restore?.config ? normalizeConfig(restore.config) : defaultRoomConfig(),
        match: restore?.match ? hydrateMatch(restore.match) : null,
        clients: new Map(),
        lastActive: Date.now(),
      };
      rooms.set(LOCAL_CODE, room);
      attachSpieltag(room);
    }
    return room;
  }

  function attach(ws: WebSocket, clientId: string, room: Room, current: Room | null): Room {
    if (current && current !== room) current.clients.delete(ws);
    room.clients.set(ws, clientId);
    const hostConnected = [...room.clients.values()].includes(room.hostClientId ?? "");
    if (!room.hostClientId || !hostConnected) room.hostClientId = clientId;
    room.lastActive = Date.now();
    send(ws, { type: "snapshot", snapshot: snapshotFor(room, clientId, runtime.port) });
    return room;
  }

  function persistLocal(): void {
    if (DEPLOY_MODE !== "offline") return;
    writePersist(persistPath, rooms.get(LOCAL_CODE));
  }

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    let joined: Room | null = null;
    const clientId = randomUUID();

    if (DEPLOY_MODE === "offline") {
      joined = attach(ws, clientId, ensureLocalRoom(), null);
    }

    ws.on("message", (raw) => {
      let msg: WsClientMessage;
      try {
        msg = JSON.parse(String(raw)) as WsClientMessage;
      } catch {
        send(ws, { type: "error", message: "Ungültige Nachricht." });
        return;
      }

      try {
        if (msg.type === "createRoom") {
          if (DEPLOY_MODE === "offline") {
            joined = attach(ws, clientId, ensureLocalRoom(), joined);
            return;
          }
          const auth = authorizeRoomCreate({ password: msg.password, adminToken: msg.adminToken });
          if (!auth.ok) {
            send(ws, { type: "error", message: auth.error });
            return;
          }
          const cap = roomCapError(rooms.size);
          if (cap) {
            send(ws, { type: "error", message: cap });
            return;
          }
          const code = generateCode(rooms);
          const incoming = msg.config ?? createDefaultConfig();
          const needsRoster = !incoming.players?.length || incoming.players.every((p) => !p.id);
          const config = normalizeConfig(
            needsRoster ? { ...incoming, players: store.defaultMatchPlayers() } : incoming,
          );
          const room: Room = {
            code,
            mode: "online",
            config,
            match: null,
            clients: new Map(),
            lastActive: Date.now(),
            boardId: typeof msg.boardId === "string" ? msg.boardId : null,
            boardName: typeof msg.boardName === "string" ? msg.boardName : null,
          };
          rooms.set(code, room);
          attachSpieltag(room);
          joined = attach(ws, clientId, room, joined);
          return;
        }

        if (msg.type === "joinRoom") {
          if (DEPLOY_MODE === "offline") {
            joined = attach(ws, clientId, ensureLocalRoom(), joined);
            return;
          }
          const code = msg.code.trim().toUpperCase();
          const room = rooms.get(code);
          if (!room) {
            send(ws, { type: "error", message: "Raum nicht gefunden." });
            return;
          }
          joined = attach(ws, clientId, room, joined);
          return;
        }

        if (!joined) {
          send(ws, { type: "error", message: "Kein Raum verbunden." });
          return;
        }

        if (msg.type === "updateConfig") {
          if (joined.match) {
            send(ws, { type: "error", message: "Match läuft bereits." });
            return;
          }
          joined.config = normalizeConfig(msg.config);
          broadcast(joined, runtime.port);
          persistLocal();
          return;
        }

        if (msg.type === "startMatch") {
          applyBoard(joined, msg.boardId, msg.boardName);
          joined.config = normalizeConfig({
            ...joined.config,
            players: joined.config.players.map((p) => {
              const full = store.getPlayer(p.id);
              return full ? toMatchPlayer(full) : toMatchPlayer(p);
            }),
          });
          joined.match = createMatch(joined.config);
          attachSpieltag(joined);
          broadcast(joined, runtime.port);
          persistLocal();
          return;
        }

        if (msg.type === "toSetup") {
          finalizeMatch(joined.match, joined);
          joined.match = null;
          broadcast(joined, runtime.port);
          persistLocal();
          return;
        }

        if (msg.type === "action") {
          if (!joined.match) {
            send(ws, { type: "error", message: "Kein Match aktiv." });
            return;
          }
          const action = injectTurn(joined.match, msg.action);
          const hostOnly = action.type === "SET_LEG_STARTER" || action.type === "REOPEN_BULL_UP";
          if (hostOnly && clientId !== joined.hostClientId) {
            send(ws, { type: "error", message: "Nur der Host kann Ausbullen festlegen." });
            return;
          }
          const prev = joined.match;
          const result = applyAction(joined.match, action);
          if (!result.ok) {
            send(ws, { type: "error", message: result.error });
            touch(joined);
            persistLocal();
            send(ws, { type: "snapshot", snapshot: snapshotFor(joined, clientId, runtime.port) });
            return;
          }
          if (action.type === "REMATCH" && prev.status === "matchOver") {
            finalizeMatch(prev, joined);
          }
          joined.match = result.state;
          broadcast(joined, runtime.port);
          persistLocal();
        }
      } catch (err) {
        send(ws, { type: "error", message: err instanceof Error ? err.message : "Serverfehler." });
      }
    });

    ws.on("close", () => {
      if (joined) {
        joined.clients.delete(ws);
        persistLocal();
      }
    });
  });

  if (DEPLOY_MODE === "offline") ensureLocalRoom();

  const persistTimer = setInterval(() => persistLocal(), 15_000);
  persistTimer.unref();

  const cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - ROOM_IDLE_MS;
    for (const [code, room] of rooms) {
      if (code === LOCAL_CODE) continue;
      if (room.lastActive < cutoff) {
        finalizeMatch(room.match, room);
        rooms.delete(code);
      }
    }
  }, 30_000);
  cleanupTimer.unref();

  try {
    if (server.listening) {
      const addr = server.address();
      if (addr && typeof addr === "object") runtime.port = addr.port;
    } else if (!hop && pinnedEnvPort != null) {
      await bindPort(server, HOST, pinnedEnvPort, false);
      runtime.port = pinnedEnvPort;
    } else {
      runtime.port = await listenExclusive(server, HOST, runtime.port);
    }
  } catch (err) {
    clearInterval(cleanupTimer);
    clearInterval(persistTimer);
    try {
      store.close();
    } catch {
      /* ignore */
    }
    throw err;
  }

  const urls = lanUrls(runtime.port);
  const listenUrl = `http://${HOST}:${runtime.port}`;
  bootLog(`listening ${listenUrl}`);
  bootLog(`hop=${hop} bind=${runtime.port}`);
  bootLog(`Steeldart Dart-Counter (${DEPLOY_MODE}) auf ${listenUrl}`);
  if (DEPLOY_MODE === "offline") {
    console.log("  Offline: Geräte die die IP öffnen, landen im lokalen Spiel.");
  } else {
    console.log("  Online: Raum erstellen oder per Raum-ID beitreten. Räume bleiben 2h nach letzter Aktion.");
  }
  for (const url of urls) console.log(`  LAN: ${url}`);

  const close = () =>
    new Promise<void>((done) => {
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        done();
      };
      persistLocal();
      clearInterval(cleanupTimer);
      clearInterval(persistTimer);
      wss.close();
      try {
        store.close();
      } catch {
        /* already closed */
      }
      if (!server.listening) {
        finish();
        return;
      }
      server.close(() => finish());
      setTimeout(finish, 2500);
    });

  return { app, server, port: runtime.port, host: HOST, mode: DEPLOY_MODE, lanUrls: urls, store, close };
}
