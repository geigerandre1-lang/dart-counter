import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { STEELDART_APP, startServer } from "./app.js";
import { getAdminPassword, issueAdminToken } from "./admin.js";
import { openStatsStore } from "./store.js";

const dirs: string[] = [];

afterEach(() => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function tmpDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "steeldart-api-"));
  dirs.push(dir);
  return path.join(dir, "steeldart.sqlite");
}

function openWs(port: number): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

function waitType(socket: WebSocket, type: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${type}`)), 4000);
    const onMsg = (raw: WebSocket.RawData) => {
      const msg = JSON.parse(String(raw)) as { type: string };
      if (msg.type !== type) return;
      clearTimeout(timer);
      socket.off("message", onMsg);
      resolve(msg as Record<string, unknown>);
    };
    socket.on("message", onMsg);
  });
}

describe("REST stats API", () => {
  it("serves teams and spieltage from the given sqlite file", async () => {
    const dbPath = tmpDb();
    const store = await openStatsStore(dbPath);
    const created = store.createTeam("1. Mannschaft");
    expect(created.ok).toBe(true);
    store.close();

    const started = await startServer({
      port: 39151,
      host: "127.0.0.1",
      mode: "offline",
      dbPath,
      publicDir: null,
    });
    try {
      const teamsRes = await fetch(`http://127.0.0.1:${started.port}/api/teams`);
      expect(teamsRes.ok).toBe(true);
      const teams = (await teamsRes.json()) as { teams: { name: string }[] };
      expect(teams.teams.some((team) => team.name === "1. Mannschaft")).toBe(true);

      const daysRes = await fetch(`http://127.0.0.1:${started.port}/api/spieltage`);
      expect(daysRes.ok).toBe(true);
      const days = (await daysRes.json()) as { spieltage: unknown[] };
      expect(Array.isArray(days.spieltage)).toBe(true);

      const infoRes = await fetch(`http://127.0.0.1:${started.port}/api/info`);
      const info = (await infoRes.json()) as { port: number; app: string };
      expect(info.app).toBe(STEELDART_APP);
      expect(info.port).toBe(started.port);
    } finally {
      await started.close();
    }
  });
});

describe("GET /api/monitor", () => {
  it("is unavailable on the offline/local server", async () => {
    const started = await startServer({
      port: 39311,
      host: "127.0.0.1",
      mode: "offline",
      dbPath: tmpDb(),
      publicDir: null,
    });
    try {
      const res = await fetch(`http://127.0.0.1:${started.port}/api/monitor`);
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error?: string };
      expect(body.error).toMatch(/Webserver/i);
    } finally {
      await started.close();
    }
  });

  it("lists only live matches with Anlagen-Name and never a room code", async () => {
    const started = await startServer({
      port: 39312,
      host: "127.0.0.1",
      mode: "online",
      dbPath: tmpDb(),
      publicDir: null,
    });
    const sockets: WebSocket[] = [];
    try {
      const emptyRes = await fetch(`http://127.0.0.1:${started.port}/api/monitor`);
      expect(emptyRes.ok).toBe(true);
      const empty = (await emptyRes.json()) as { games: unknown[] };
      expect(empty.games).toEqual([]);

      const setup = await openWs(started.port);
      sockets.push(setup);
      const setupSnap = waitType(setup, "snapshot");
      setup.send(
        JSON.stringify({
          type: "createRoom",
          mode: "online",
          password: getAdminPassword(),
        }),
      );
      await setupSnap;

      const setupMonitor = await fetch(`http://127.0.0.1:${started.port}/api/monitor`);
      expect(((await setupMonitor.json()) as { games: unknown[] }).games).toEqual([]);

      const live = await openWs(started.port);
      sockets.push(live);
      const created = waitType(live, "snapshot");
      live.send(
        JSON.stringify({
          type: "createRoom",
          mode: "online",
          password: getAdminPassword(),
          boardName: "Scheibe 1",
        }),
      );
      const createdMsg = (await created) as { snapshot?: { code?: string; match?: unknown } };
      expect(createdMsg.snapshot?.code).toBeTruthy();
      expect(createdMsg.snapshot?.match).toBeNull();

      const startedSnap = waitType(live, "snapshot");
      live.send(JSON.stringify({ type: "startMatch" }));
      await startedSnap;

      const liveRes = await fetch(`http://127.0.0.1:${started.port}/api/monitor`);
      expect(liveRes.ok).toBe(true);
      const liveBody = (await liveRes.json()) as {
        games: Array<{ boardName: string | null; occupancy: number; match: { id: string }; code?: string }>;
      };
      expect(liveBody.games).toHaveLength(1);
      expect(liveBody.games[0]?.boardName).toBe("Scheibe 1");
      expect(liveBody.games[0]).not.toHaveProperty("code");
      expect(liveBody.games[0]?.match?.id).toBeTruthy();
      expect(Object.keys(liveBody.games[0] ?? {}).sort()).toEqual(["boardName", "match", "occupancy"]);

      const unnamed = await openWs(started.port);
      sockets.push(unnamed);
      const unnamedCreated = waitType(unnamed, "snapshot");
      unnamed.send(
        JSON.stringify({
          type: "createRoom",
          mode: "online",
          password: getAdminPassword(),
        }),
      );
      await unnamedCreated;
      const unnamedStarted = waitType(unnamed, "snapshot");
      unnamed.send(JSON.stringify({ type: "startMatch" }));
      await unnamedStarted;

      const bothRes = await fetch(`http://127.0.0.1:${started.port}/api/monitor`);
      const both = (await bothRes.json()) as {
        games: Array<{ boardName: string | null }>;
      };
      expect(both.games).toHaveLength(2);
      expect(both.games.some((game) => game.boardName === "Scheibe 1")).toBe(true);
      expect(both.games.some((game) => game.boardName == null)).toBe(true);
      expect(both.games.every((game) => !("code" in game))).toBe(true);
    } finally {
      for (const socket of sockets) {
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }
      await started.close();
    }
  });
});

describe("player create API", () => {
  it("creates players and Training members with empty PassNr", async () => {
    const started = await startServer({
      port: 39321,
      host: "127.0.0.1",
      mode: "offline",
      dbPath: tmpDb(),
      publicDir: null,
    });
    try {
      const token = issueAdminToken();
      const created = await fetch(`http://127.0.0.1:${started.port}/api/players`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Admin Gast", passNr: "" }),
      });
      expect(created.status).toBe(200);
      const body = (await created.json()) as { ok: boolean; player?: { passNr: string | null } };
      expect(body.ok).toBe(true);
      expect(body.player?.passNr).toBeNull();

      const teamsRes = await fetch(`http://127.0.0.1:${started.port}/api/teams`);
      const teams = (await teamsRes.json()) as { teams: { id: string; name: string }[] };
      const training = teams.teams.find((team) => team.name === "Training");
      expect(training).toBeTruthy();

      const first = await fetch(`http://127.0.0.1:${started.port}/api/admin/teams/${training!.id}/players`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: "Trainingsgast", passNr: "" }),
      });
      expect(first.status).toBe(200);
      const firstBody = (await first.json()) as { ok: boolean; player?: { passNr: string | null } };
      expect(firstBody.ok).toBe(true);
      expect(firstBody.player?.passNr).toBeNull();

      const second = await fetch(`http://127.0.0.1:${started.port}/api/admin/teams/${training!.id}/players`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: "Noch ein Gast" }),
      });
      expect(second.status).toBe(200);
      const secondBody = (await second.json()) as { ok: boolean };
      expect(secondBody.ok).toBe(true);
    } finally {
      await started.close();
    }
  });
});

describe("Hostinger PORT bind", () => {
  it("listens on process.env.PORT exactly", async () => {
    const prev = process.env.PORT;
    process.env.PORT = "39401";
    try {
      const started = await startServer({
        host: "127.0.0.1",
        mode: "offline",
        dbPath: tmpDb(),
        publicDir: null,
      });
      try {
        expect(started.port).toBe(39401);
        const res = await fetch(`http://127.0.0.1:${started.port}/api/health`);
        expect(res.ok).toBe(true);
      } finally {
        await started.close();
      }
    } finally {
      if (prev == null) delete process.env.PORT;
      else process.env.PORT = prev;
    }
  });
});
