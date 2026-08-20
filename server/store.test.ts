import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyAction, createDefaultConfig, createMatch, PLAYER_NAME_TAKEN, TRAINING_TEAM_NAME } from "../shared/index.js";
import { openStatsStore, type StatsStore } from "./store.js";
import { openMiniDb } from "./sqlite.js";
import type { MatchConfig } from "../shared/types.js";

const dirs: string[] = [];

afterEach(async () => {
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

async function tempStore(): Promise<StatsStore> {
  const dir = mkdtempSync(path.join(tmpdir(), "steeldart-"));
  dirs.push(dir);
  return openStatsStore(path.join(dir, "test.sqlite"));
}

function cfg(partial: Partial<MatchConfig> = {}): MatchConfig {
  return { ...createDefaultConfig(), firstThrowerIndex: 0, ...partial };
}

describe("player registry", () => {
  it("seeds Spieler 1 and Spieler 2 on an empty database", async () => {
    const store = await tempStore();
    const players = store.listPlayers();
    expect(players.map((p) => p.name).sort()).toEqual(["Spieler 1", "Spieler 2"]);
    expect(new Set(players.map((p) => p.id)).size).toBe(2);
    const roster = store.defaultMatchPlayers();
    expect(roster).toHaveLength(2);
    expect(roster.map((p) => p.name)).toEqual(["Spieler 1", "Spieler 2"]);
    store.seedDefaultPlayers();
    expect(store.listPlayers()).toHaveLength(2);
    store.close();
  });

  it("rejects a duplicate name (case-insensitive trim)", async () => {
    const store = await tempStore();
    const first = store.createPlayer("  Anna Müller ");
    expect(first.ok).toBe(true);
    const dup = store.createPlayer("anna müller");
    expect(dup.ok).toBe(false);
    if (dup.ok) return;
    expect(dup.error).toBe(PLAYER_NAME_TAKEN);
    const again = store.createPlayer("Spieler 1");
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toBe(PLAYER_NAME_TAKEN);
    store.close();
  });
});

describe("match analysis", () => {
  it("counts a 180 and inserts a match analysis row", async () => {
    const store = await tempStore();
    const p1 = store.createPlayer("Alex");
    const p2 = store.createPlayer("Kim");
    expect(p1.ok && p2.ok).toBe(true);
    if (!p1.ok || !p2.ok) return;

    let state = createMatch(
      cfg({
        players: [
          { id: p1.player.id, name: p1.player.name },
          { id: p2.player.id, name: p2.player.name },
        ],
        x01: { startScore: 180, inMode: "straight", outMode: "straight" },
        legsToWinSet: 1,
        setsToWin: 1,
      }),
    );
    const visit = applyAction(state, { type: "SET_VISIT_TOTAL", playerId: p1.player.id, total: 180 });
    expect(visit.ok).toBe(true);
    if (!visit.ok) return;
    state = visit.state;
    expect(state.status).toBe("matchOver");
    expect(state.matchVisits.some((v) => v.total === 180)).toBe(true);

    const recorded = store.recordFinishedMatch(state, "offline");
    expect(recorded).not.toBeNull();
    expect(recorded?.playerStats[p1.player.id]?.score180).toBe(1);
    expect(recorded?.playerStats[p1.player.id]?.average).toBe(180);

    const view = store.playerStats(p1.player.id);
    expect(view?.lifetime.score180).toBe(1);
    expect(view?.lifetime.matches).toBe(1);
    expect(view?.analyses).toHaveLength(1);
    expect(view?.analyses[0]?.matchId).toBe(state.id);
    expect(store.hasAnalysis(state.id)).toBe(true);

    const again = store.recordFinishedMatch(state, "offline");
    expect(again).toBeNull();
    expect(store.playerStats(p1.player.id)?.analyses).toHaveLength(1);
    store.close();
  });
});

describe("teams and spieltage", () => {
  it("lists Spieler under Teams without nesting", async () => {
    const store = await tempStore();
    const team = store.createTeam("1. Mannschaft");
    expect(team.ok).toBe(true);
    if (!team.ok) return;
    const extra = store.createTeam("Pokalteam");
    expect(extra.ok).toBe(true);
    if (!extra.ok) return;
    const player = store.createPlayer("Alex");
    expect(player.ok).toBe(true);
    if (!player.ok) return;
    expect(store.setPlayerTeam(player.player.id, extra.team.id).ok).toBe(true);
    const tree = store.listTeamTree();
    const pokal = tree.find((t) => t.name === "Pokalteam");
    expect(pokal?.players.map((p) => p.name)).toEqual(["Alex"]);
    const listed = store.listPlayers().find((p) => p.id === player.player.id);
    expect(listed?.teamName).toBe("Pokalteam");
    store.close();
  });

  it("creates a Spieltag for today and keeps it after stats reset", async () => {
    const store = await tempStore();
    const created = store.ensureTodaySpieltag("offline", "ABCD", { id: "board-1", name: "Scheibe 1" });
    expect(created.dateKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const listed = store.listSpieltage();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.roomCount).toBe(1);
    expect(listed[0]?.id).toBe(created.id);

    const p1 = store.createPlayer("Alex");
    const p2 = store.createPlayer("Kim");
    expect(p1.ok && p2.ok).toBe(true);
    if (!p1.ok || !p2.ok) return;
    let state = createMatch(
      cfg({
        players: [
          { id: p1.player.id, name: p1.player.name, teamId: "c1", teamName: "DC Nord" },
          { id: p2.player.id, name: p2.player.name, teamId: "c2", teamName: "DC Süd" },
        ],
        teams: [
          { id: "c1", name: "DC Nord" },
          { id: "c2", name: "DC Süd" },
        ],
        x01: { startScore: 40, inMode: "straight", outMode: "double" },
        legsToWinSet: 1,
        setsToWin: 1,
      }),
    );
    const visit = applyAction(state, {
      type: "THROW_DART",
      playerId: p1.player.id,
      dart: { segment: 20, multiplier: 2 },
    });
    expect(visit.ok).toBe(true);
    if (!visit.ok) return;
    state = visit.state;
    expect(state.status).toBe("matchOver");
    const recorded = store.recordFinishedMatch(state, "offline", { id: "board-1", name: "Scheibe 1" });
    expect(recorded).not.toBeNull();

    const detail = store.getSpieltag(created.id);
    expect(detail?.reports).toHaveLength(1);
    expect(detail?.reports[0]?.summary).toContain("DC Nord schlägt DC Süd");
    expect(detail?.html).toContain("Alex");
    expect(detail?.html).toContain("DC Nord");
    expect(detail?.html).toContain("Endstand");
    expect(detail?.reports[0]?.payload.headline).toContain("Spiel 1");
    expect(detail?.reports[0]?.payload.legs?.length).toBeGreaterThan(0);

    store.resetAllStats();
    expect(store.listSpieltage()).toHaveLength(1);
    expect(store.getSpieltag(created.id)?.reports).toHaveLength(1);
    expect(store.playerStats(p1.player.id)?.lifetime.matches).toBe(0);
    store.close();
  });

  it("adds a player to an empty team with optional PassNr", async () => {
    const store = await tempStore();
    const team = store.createTeam("Testclub");
    expect(team.ok).toBe(true);
    if (!team.ok) return;
    expect(store.listTeamTree()[0]?.players).toEqual([]);
    const created = store.createTeamPlayer(team.team.id, "Alex", "12345");
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.player.name).toBe("Alex");
    expect(created.player.passNr).toBe("12345");
    expect(created.player.teamName).toBe("Testclub");
    const dupPass = store.createTeamPlayer(team.team.id, "Kim", "12345");
    expect(dupPass.ok).toBe(false);
    const other = store.createTeamPlayer(team.team.id, "Kim");
    expect(other.ok).toBe(true);
    if (!other.ok) return;
    expect(other.player.passNr).toBeNull();
    const dupName = store.createTeamPlayer(team.team.id, "Kim");
    expect(dupName.ok).toBe(false);
    const removed = store.removePlayerFromTeam(created.player.id, team.team.id);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.deleted).toBe(true);
    expect(store.getPlayer(created.player.id)).toBeUndefined();
    store.close();
  });

  it("resets the Spieltag into a new row on the same calendar date", async () => {
    const store = await tempStore();
    const first = store.ensureTodaySpieltag("offline", "AAAA", null);
    const again = store.ensureTodaySpieltag("offline", "BBBB", null);
    expect(again.id).toBe(first.id);
    const next = store.startNewSpieltag("offline");
    expect(next.id).not.toBe(first.id);
    expect(next.dateKey).toBe(first.dateKey);
    expect(store.listSpieltage()).toHaveLength(2);
    const attached = store.ensureTodaySpieltag("offline", "CCCC", null);
    expect(attached.id).toBe(next.id);
    expect(store.getSpieltag(first.id)?.rooms).toContain("AAAA");
    expect(store.getSpieltag(next.id)?.rooms).toContain("CCCC");
    store.close();
  });

  it("seeds Training and refuses to delete it", async () => {
    const store = await tempStore();
    const training = store.getTrainingTeam();
    expect(training?.name).toBe(TRAINING_TEAM_NAME);
    expect(store.listTeams().some((t) => t.name === TRAINING_TEAM_NAME)).toBe(true);
    store.seedBuiltInTrainingTeam();
    expect(store.listTeams().filter((t) => t.name === TRAINING_TEAM_NAME)).toHaveLength(1);
    const blocked = store.deleteTeam(training!.id);
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) expect(blocked.error).toBe("Das Team Training kann nicht gelöscht werden.");
    expect(store.getTrainingTeam()?.id).toBe(training!.id);

    const added = store.createTeamPlayer(training!.id, "Trainingspartner");
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.player.passNr).toBeNull();
    const second = store.createTeamPlayer(training!.id, "Trainingsgast", "   ");
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.player.passNr).toBeNull();
    const dupPass = store.createTeamPlayer(training!.id, "Mit Pass", "T-1");
    expect(dupPass.ok).toBe(true);
    const clash = store.createTeamPlayer(training!.id, "Andere Person", "T-1");
    expect(clash.ok).toBe(false);
    if (!clash.ok) expect(clash.error).toBe("PassNr bereits vergeben.");
    const removed = store.removePlayerFromTeam(added.player.id, training!.id, { keepRecord: true });
    expect(removed.ok).toBe(true);
    expect(store.getPlayer(added.player.id)?.teamId).toBeNull();
    store.close();
  });

  it("migrates a unique pass_nr index so Training players can be added without PassNr", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "steeldart-"));
    dirs.push(dir);
    const file = path.join(dir, "legacy.sqlite");
    const db = await openMiniDb(file);
    db.exec(`CREATE TABLE players (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_key TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      team_id TEXT,
      pass_nr TEXT
    )`);
    db.exec("CREATE UNIQUE INDEX players_pass_nr ON players(pass_nr)");
    db.run(
      "INSERT INTO players (id, name, name_key, created_at, team_id, pass_nr) VALUES (?, ?, ?, ?, ?, ?)",
      "legacy-1",
      "Alt",
      "alt",
      Date.now(),
      null,
      "",
    );
    db.close();

    const store = await openStatsStore(file);
    const training = store.getTrainingTeam();
    expect(training).toBeTruthy();
    const first = store.createTeamPlayer(training!.id, "Gast A");
    const second = store.createTeamPlayer(training!.id, "Gast B", "  ");
    const admin = store.createPlayer("Admin Gast");
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    expect(admin.ok).toBe(true);
    if (first.ok) expect(first.player.passNr).toBeNull();
    if (second.ok) expect(second.player.passNr).toBeNull();
    if (admin.ok) expect(admin.player.passNr).toBeNull();
    store.close();
  });

  it("imports Training players from CSV without PassNr", async () => {
    const store = await tempStore();
    const result = store.importRoster("TEAM;PassNr;Name\nTraining;;Gast A\nTraining;;Gast B\nTraining;T-9;Gast C\n");
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.imported).toBe(3);
    const training = store.listTeamTree().find((team) => team.name === TRAINING_TEAM_NAME);
    expect(training?.players.map((p) => p.name).sort()).toEqual(["Gast A", "Gast B", "Gast C"]);
    expect(training?.players.filter((p) => !p.passNr)).toHaveLength(2);
    store.close();
  });

  it("writes Tagesberichte only when a non-Training Mannschaft player is in the match", async () => {
    const store = await tempStore();
    const training = store.getTrainingTeam();
    expect(training).toBeTruthy();
    if (!training) return;
    const club = store.createTeam("1. Mannschaft");
    expect(club.ok).toBe(true);
    if (!club.ok) return;
    const local = store.listPlayers().find((p) => p.name === "Spieler 2");
    const t1 = store.createTeamPlayer(training.id, "Train A");
    const t2 = store.createTeamPlayer(training.id, "Train B");
    const c1 = store.createTeamPlayer(club.team.id, "Club A");
    expect(t1.ok).toBe(true);
    expect(t2.ok).toBe(true);
    expect(c1.ok).toBe(true);
    expect(local).toBeTruthy();
    if (!t1.ok || !t2.ok || !c1.ok || !local) {
      store.close();
      return;
    }

    const play = (players: { id: string; name: string; teamId?: string | null; teamName?: string | null }[]) => {
      let state = createMatch(
        cfg({
          players,
          x01: { startScore: 40, inMode: "straight", outMode: "double" },
          legsToWinSet: 1,
          setsToWin: 1,
        }),
      );
      const visit = applyAction(state, {
        type: "THROW_DART",
        playerId: players[0]!.id,
        dart: { segment: 20, multiplier: 2 },
      });
      expect(visit.ok).toBe(true);
      if (!visit.ok) return null;
      state = visit.state;
      expect(state.status).toBe("matchOver");
      return store.recordFinishedMatch(state, "offline");
    };

    expect(play([t1.player, { id: local.id, name: local.name, teamId: null, teamName: null }])).not.toBeNull();
    expect(store.listSpieltage()).toHaveLength(0);

    expect(play([t1.player, t2.player])).not.toBeNull();
    expect(store.listSpieltage()).toHaveLength(0);

    expect(play([t1.player, c1.player])).not.toBeNull();
    const days = store.listSpieltage();
    expect(days).toHaveLength(1);
    expect(store.getSpieltag(days[0]!.id)?.reports).toHaveLength(1);
    store.close();
  });
});
