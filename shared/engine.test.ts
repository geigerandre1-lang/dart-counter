import { describe, expect, it } from "vitest";
import { IMPOSSIBLE_HIGH_TOTALS, isPossibleVisitTotal } from "./darts.js";
import { applyAction, createDefaultConfig, createMatch, currentLegRound, normalizeConfig } from "./engine/match.js";
import type { DartThrow, MatchConfig, MatchState } from "./types.js";

function cfg(partial: Partial<MatchConfig> = {}): MatchConfig {
  return { ...createDefaultConfig(), firstThrowerIndex: 0, ...partial };
}

function throwDart(state: MatchState, playerId: string, dart: DartThrow): MatchState {
  const result = applyAction(state, { type: "THROW_DART", playerId, dart });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function throwVisit(state: MatchState, playerId: string, darts: DartThrow[]): MatchState {
  let next = state;
  for (const dart of darts) next = throwDart(next, playerId, dart);
  return next;
}

const MISS: DartThrow = { segment: 0, multiplier: 1 };

function missVisit(state: MatchState, playerId: string): MatchState {
  return throwVisit(state, playerId, [MISS, MISS, MISS]);
}

describe("x01", () => {
  it("wins on double-out checkout", () => {
    const state = createMatch(
      cfg({
        x01: { startScore: 40, inMode: "straight", outMode: "double" },
        legsToWinSet: 1,
        setsToWin: 1,
      }),
    );
    const result = applyAction(state, {
      type: "THROW_DART",
      playerId: "p1",
      dart: { segment: 20, multiplier: 2 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe("matchOver");
    expect(result.state.lastWinnerIndex).toBe(0);
    expect(result.state.currentLeg.players[0]?.remaining).toBe(0);
    expect(result.state.canUndo).toBe(true);
    const undone = applyAction(result.state, { type: "UNDO" });
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.state.status).toBe("playing");
    expect(undone.state.currentLeg.players[0]?.remaining).toBe(40);
  });

  it("busts a visit that overthrows and restores the start remaining", () => {
    let state = createMatch(
      cfg({
        x01: { startScore: 50, inMode: "straight", outMode: "double" },
      }),
    );
    const first = applyAction(state, {
      type: "THROW_DART",
      playerId: "p1",
      dart: { segment: 10, multiplier: 1 },
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.state.currentLeg.players[0]?.remaining).toBe(40);

    const bust = applyAction(first.state, {
      type: "THROW_DART",
      playerId: "p1",
      dart: { segment: 20, multiplier: 3 },
    });
    expect(bust.ok).toBe(true);
    if (!bust.ok) return;
    expect(bust.state.currentLeg.players[0]?.remaining).toBe(50);
    expect(bust.state.currentLeg.currentPlayerIndex).toBe(1);
    expect(bust.state.currentLeg.visits.at(-1)?.bust).toBe(true);
  });

  it("busts finishing on a single when double-out is required", () => {
    const state = createMatch(
      cfg({ x01: { startScore: 20, inMode: "straight", outMode: "double" } }),
    );
    const result = applyAction(state, {
      type: "THROW_DART",
      playerId: "p1",
      dart: { segment: 20, multiplier: 1 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.currentLeg.players[0]?.remaining).toBe(20);
    expect(result.state.currentLeg.currentPlayerIndex).toBe(1);
  });

  it("rejects a dart from the player who is not throwing", () => {
    const state = createMatch(cfg());
    const result = applyAction(state, {
      type: "THROW_DART",
      playerId: "p2",
      dart: { segment: 20, multiplier: 3 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Nicht an der Reihe/);
  });
});

describe("cricket", () => {
  it("opens a number with a triple and scores extra marks against an unclosed opponent", () => {
    let state = createMatch(
      cfg({
        gameType: "cricket",
        cricket: { numbers: [20, 19], includeBull: false },
      }),
    );
    const close = applyAction(state, {
      type: "THROW_DART",
      playerId: "p1",
      dart: { segment: 20, multiplier: 3 },
    });
    expect(close.ok).toBe(true);
    if (!close.ok) return;
    expect(close.state.currentLeg.players[0]?.marks["20"]).toBe(3);
    expect(close.state.currentLeg.players[0]?.cricketScore).toBe(0);

    state = close.state;
    for (const miss of [1, 2]) {
      const r = applyAction(state, {
        type: "THROW_DART",
        playerId: "p1",
        dart: { segment: 0, multiplier: 1 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      state = r.state;
      void miss;
    }
    expect(state.currentLeg.currentPlayerIndex).toBe(1);

    for (let i = 0; i < 3; i++) {
      const r = applyAction(state, {
        type: "THROW_DART",
        playerId: "p2",
        dart: { segment: 0, multiplier: 1 },
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      state = r.state;
    }
    expect(state.currentLeg.currentPlayerIndex).toBe(0);

    const score = applyAction(state, {
      type: "THROW_DART",
      playerId: "p1",
      dart: { segment: 20, multiplier: 1 },
    });
    expect(score.ok).toBe(true);
    if (!score.ok) return;
    expect(score.state.currentLeg.players[0]?.cricketScore).toBe(20);
  });

  it("wins after closing all numbers with a score not behind", () => {
    const state = createMatch(
      cfg({
        gameType: "cricket",
        cricket: { numbers: [20], includeBull: false },
        legsToWinSet: 1,
        setsToWin: 1,
      }),
    );
    const result = applyAction(state, {
      type: "THROW_DART",
      playerId: "p1",
      dart: { segment: 20, multiplier: 3 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe("matchOver");
    expect(result.state.lastWinnerIndex).toBe(0);
  });
});

describe("elimination", () => {
  const elim = (
    extra: Partial<MatchConfig["elimination"]> = {},
    rest: Partial<MatchConfig> = {},
  ): MatchConfig =>
    cfg({
      gameType: "elimination",
      elimination: {
        target: 301,
        inMode: "straight",
        outMode: "double",
        extreme: false,
        ...extra,
      },
      ...rest,
    });

  it("scores up from 0", () => {
    const state = throwDart(createMatch(elim()), "p1", { segment: 20, multiplier: 3 });
    expect(state.currentLeg.players[0]?.remaining).toBe(60);
    expect(state.currentLeg.players[0]?.opened).toBe(true);
    expect(state.config.inputMode).toBe("single");
  });

  it("blocks singles until double-in", () => {
    const state = throwDart(
      createMatch(elim({ inMode: "double" })),
      "p1",
      { segment: 20, multiplier: 1 },
    );
    expect(state.currentLeg.players[0]?.remaining).toBe(0);
    expect(state.currentLeg.players[0]?.opened).toBe(false);
  });

  it("resets an opponent to 0 after one dart on an equal score", () => {
    let state = throwVisit(createMatch(elim()), "p1", [
      { segment: 20, multiplier: 3 },
      MISS,
      MISS,
    ]);
    expect(state.currentLeg.players[0]?.remaining).toBe(60);
    expect(state.currentLeg.currentPlayerIndex).toBe(1);

    state = throwDart(state, "p2", { segment: 20, multiplier: 3 });
    expect(state.currentLeg.players[1]?.remaining).toBe(60);
    expect(state.currentLeg.players[0]?.remaining).toBe(0);
    expect(state.currentLeg.knockedPlayerIds).toContain("p1");
  });

  it("Normal bust reverts the visit score", () => {
    let state = throwVisit(createMatch(elim({ target: 50 })), "p1", [
      { segment: 20, multiplier: 1 },
      MISS,
      MISS,
    ]);
    expect(state.currentLeg.players[0]?.remaining).toBe(20);
    state = missVisit(state, "p2");
    const bust = applyAction(state, {
      type: "THROW_DART",
      playerId: "p1",
      dart: { segment: 20, multiplier: 3 },
    });
    expect(bust.ok).toBe(true);
    if (!bust.ok) return;
    expect(bust.state.currentLeg.players[0]?.remaining).toBe(20);
    expect(bust.state.currentLeg.currentPlayerIndex).toBe(1);
    expect(bust.state.currentLeg.visits.at(-1)?.bust).toBe(true);
  });

  it("Extreme T20 from 298 at 301 becomes 244", () => {
    let state = createMatch(elim({ extreme: true }));
    state = {
      ...state,
      currentLeg: {
        ...state.currentLeg,
        players: state.currentLeg.players.map((p, i) =>
          i === 0 ? { ...p, remaining: 298, opened: true } : p,
        ),
        visitStartSnapshot: state.currentLeg.players.map((p, i) =>
          i === 0 ? { ...p, remaining: 298, opened: true } : p,
        ),
      },
    };
    state = throwDart(state, "p1", { segment: 20, multiplier: 3 });
    expect(state.currentLeg.players[0]?.remaining).toBe(244);
    expect(state.currentLeg.currentPlayerIndex).toBe(1);
    expect(state.status).toBe("playing");
    expect(state.currentLeg.visits.at(-1)?.bust).toBeFalsy();
  });

  it("wins on exact 301 double-out", () => {
    let state = createMatch(elim({}, { legsToWinSet: 1, setsToWin: 1 }));
    state = {
      ...state,
      currentLeg: {
        ...state.currentLeg,
        players: state.currentLeg.players.map((p, i) =>
          i === 0 ? { ...p, remaining: 261, opened: true } : p,
        ),
        visitStartSnapshot: state.currentLeg.players.map((p, i) =>
          i === 0 ? { ...p, remaining: 261, opened: true } : p,
        ),
      },
    };
    const result = applyAction(state, {
      type: "THROW_DART",
      playerId: "p1",
      dart: { segment: 20, multiplier: 2 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.currentLeg.players[0]?.remaining).toBe(301);
    expect(result.state.status).toBe("matchOver");
    expect(result.state.lastWinnerIndex).toBe(0);
  });

  it("forces single input and rejects visit totals", () => {
    const state = createMatch(elim({}, { inputMode: "total" }));
    expect(state.config.inputMode).toBe("single");
    const result = applyAction(state, { type: "SET_VISIT_TOTAL", playerId: "p1", total: 60 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Gesamteingabe/);
  });

  it("migrates old lives configs without crashing", () => {
    const normalized = normalizeConfig({
      ...createDefaultConfig(),
      gameType: "elimination",
      inputMode: "total",
      elimination: { lives: 3 },
    } as unknown as MatchConfig);
    expect(normalized.elimination.target).toBe(501);
    expect(normalized.elimination.extreme).toBe(false);
    expect(normalized.elimination.inMode).toBe("straight");
    expect(normalized.inputMode).toBe("single");
    expect(createMatch(normalized).currentLeg.players[0]?.remaining).toBe(0);
  });
});

describe("shanghai", () => {
  it("S1 advances to 2 and scores 1", () => {
    const state = throwDart(createMatch(cfg({ gameType: "shanghai" })), "p1", {
      segment: 1,
      multiplier: 1,
    });
    expect(state.currentLeg.players[0]?.nextTarget).toBe(2);
    expect(state.currentLeg.players[0]?.shanghaiScore).toBe(1);
  });

  it("S6+T7+D8 in one visit wins immediately", () => {
    let state = createMatch(cfg({ gameType: "shanghai", legsToWinSet: 1, setsToWin: 1 }));
    state = throwVisit(state, "p1", [
      { segment: 1, multiplier: 1 },
      { segment: 2, multiplier: 1 },
      { segment: 3, multiplier: 1 },
    ]);
    state = missVisit(state, "p2");
    state = throwVisit(state, "p1", [
      { segment: 4, multiplier: 1 },
      { segment: 5, multiplier: 1 },
      MISS,
    ]);
    expect(state.currentLeg.players[0]?.nextTarget).toBe(6);
    expect(state.currentLeg.players[0]?.shanghaiScore).toBe(15);
    state = missVisit(state, "p2");
    state = throwDart(state, "p1", { segment: 6, multiplier: 1 });
    state = throwDart(state, "p1", { segment: 7, multiplier: 3 });
    const result = applyAction(state, {
      type: "THROW_DART",
      playerId: "p1",
      dart: { segment: 8, multiplier: 2 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.status).toBe("matchOver");
    expect(result.state.lastWinnerIndex).toBe(0);
    expect(result.state.currentLeg.visits.at(-1)?.shanghai).toBe(true);
    expect(result.state.currentLeg.players[0]?.shanghaiScore).toBe(15 + 6 + 21 + 16);
  });

  it("after 7 rounds the highest score wins if nobody hit S+D+T", () => {
    let state = createMatch(cfg({ gameType: "shanghai", legsToWinSet: 1, setsToWin: 1 }));
    state = throwVisit(state, "p1", [{ segment: 1, multiplier: 1 }, MISS, MISS]);
    for (let round = 1; round <= 7; round++) {
      if (round > 1) state = missVisit(state, "p1");
      state = missVisit(state, "p2");
    }
    expect(state.status).toBe("matchOver");
    expect(state.lastWinnerIndex).toBe(0);
    expect(state.currentLeg.players[0]?.shanghaiScore).toBe(1);
    expect(state.currentLeg.players[1]?.shanghaiScore).toBe(0);
  });

  it("forces single input and rejects visit totals", () => {
    const state = createMatch(cfg({ gameType: "shanghai", inputMode: "total" }));
    expect(state.config.inputMode).toBe("single");
    const result = applyAction(state, { type: "SET_VISIT_TOTAL", playerId: "p1", total: 60 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/Gesamteingabe/);
  });
});

describe("start player rotation", () => {
  it("rotates the first thrower after a won leg", () => {
    let state = createMatch(
      cfg({
        x01: { startScore: 40, inMode: "straight", outMode: "double" },
        legsToWinSet: 2,
        setsToWin: 1,
      }),
    );
    expect(state.currentLeg.firstThrowerIndex).toBe(0);
    const won = applyAction(state, {
      type: "THROW_DART",
      playerId: "p1",
      dart: { segment: 20, multiplier: 2 },
    });
    expect(won.ok).toBe(true);
    if (!won.ok) return;
    expect(won.state.status).toBe("legOver");

    const next = applyAction(won.state, { type: "ACKNOWLEDGE" });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.state.status).toBe("playing");
    expect(next.state.currentLeg.firstThrowerIndex).toBe(1);
    expect(next.state.currentLeg.currentPlayerIndex).toBe(1);
    expect(won.state.legReports).toHaveLength(1);
    expect(won.state.legReports[0]?.winnerName).toBe("Spieler 1");
    expect(won.state.legReports[0]?.opponentRemaining).toBe(40);
    expect(won.state.legReports[0]?.checkout).toBe(40);
    expect(won.state.legReports[0]?.starterName).toBe("Spieler 1");
    expect(next.state.legReports).toHaveLength(1);
  });
});

describe("3-dart totals", () => {
  it("rejects well-known impossible visit totals", () => {
    const state = createMatch(cfg());
    for (const total of IMPOSSIBLE_HIGH_TOTALS) {
      expect(isPossibleVisitTotal(total)).toBe(false);
      const result = applyAction(state, {
        type: "SET_VISIT_TOTAL",
        playerId: "p1",
        total,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/Unmögliche/);
    }
  });

  it("accepts 180 and 0", () => {
    expect(isPossibleVisitTotal(180)).toBe(true);
    expect(isPossibleVisitTotal(0)).toBe(true);
    const state = createMatch(cfg());
    const result = applyAction(state, {
      type: "SET_VISIT_TOTAL",
      playerId: "p1",
      total: 180,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.currentLeg.players[0]?.remaining).toBe(321);
  });
});

describe("leg round", () => {
  it("counts 3-dart visits of the current leg", () => {
    let state = createMatch(cfg({ x01: { startScore: 501, inMode: "straight", outMode: "double" } }));
    expect(currentLegRound(state)).toBe(1);
    const first = applyAction(state, { type: "SET_VISIT_TOTAL", playerId: "p1", total: 60 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;
    expect(currentLegRound(state)).toBe(1);
    const second = applyAction(state, { type: "SET_VISIT_TOTAL", playerId: "p2", total: 60 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(currentLegRound(second.state)).toBe(2);
  });

  it("uses the Shanghai number as Runde", () => {
    const state = createMatch(cfg({ gameType: "shanghai" }));
    expect(currentLegRound(state)).toBe(1);
    expect(state.currentLeg.shanghaiRound).toBe(1);
  });
});

describe("default starter and ausbullen", () => {
  it("defaults to Spieler 2 as first thrower with ausbullen on", () => {
    const config = createDefaultConfig();
    expect(config.firstThrowerIndex).toBe(1);
    expect(config.bullUpLastLeg).toBe(true);
    const state = createMatch(config);
    expect(state.currentLeg.firstThrowerIndex).toBe(1);
    expect(state.currentLeg.currentPlayerIndex).toBe(1);
  });

  it("pauses for ausbullen before the deciding last leg", () => {
    let state = createMatch(
      cfg({
        x01: { startScore: 40, inMode: "straight", outMode: "double" },
        legsToWinSet: 2,
        setsToWin: 1,
        bullUpLastLeg: true,
      }),
    );
    const won = applyAction(state, {
      type: "THROW_DART",
      playerId: "p1",
      dart: { segment: 20, multiplier: 2 },
    });
    expect(won.ok).toBe(true);
    if (!won.ok) return;
    const afterFirst = applyAction(won.state, { type: "ACKNOWLEDGE" });
    expect(afterFirst.ok).toBe(true);
    if (!afterFirst.ok) return;
    expect(afterFirst.state.status).toBe("playing");
    expect(afterFirst.state.currentLeg.firstThrowerIndex).toBe(1);

    const second = applyAction(afterFirst.state, {
      type: "THROW_DART",
      playerId: "p2",
      dart: { segment: 20, multiplier: 2 },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.state.status).toBe("legOver");
    const bull = applyAction(second.state, { type: "ACKNOWLEDGE" });
    expect(bull.ok).toBe(true);
    if (!bull.ok) return;
    expect(bull.state.status).toBe("bullUp");

    const started = applyAction(bull.state, { type: "SET_LEG_STARTER", playerIndex: 0 });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.state.status).toBe("playing");
    expect(started.state.currentLeg.firstThrowerIndex).toBe(0);
    expect(started.state.currentLeg.currentPlayerIndex).toBe(0);
  });

  it("skips ausbullen when the setting is off", () => {
    let state = createMatch(
      cfg({
        x01: { startScore: 40, inMode: "straight", outMode: "double" },
        legsToWinSet: 2,
        setsToWin: 1,
        bullUpLastLeg: false,
      }),
    );
    const won = applyAction(state, {
      type: "THROW_DART",
      playerId: "p1",
      dart: { segment: 20, multiplier: 2 },
    });
    expect(won.ok).toBe(true);
    if (!won.ok) return;
    const afterFirst = applyAction(won.state, { type: "ACKNOWLEDGE" });
    expect(afterFirst.ok).toBe(true);
    if (!afterFirst.ok) return;
    const second = applyAction(afterFirst.state, {
      type: "THROW_DART",
      playerId: "p2",
      dart: { segment: 20, multiplier: 2 },
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    const next = applyAction(second.state, { type: "ACKNOWLEDGE" });
    expect(next.ok).toBe(true);
    if (!next.ok) return;
    expect(next.state.status).toBe("playing");
  });

  it("reopens ausbullen after a mis-click and switches the starter", () => {
    let state = createMatch(
      cfg({
        x01: { startScore: 40, inMode: "straight", outMode: "double" },
        legsToWinSet: 2,
        setsToWin: 1,
        bullUpLastLeg: true,
      }),
    );
    state = throwDart(state, "p1", { segment: 20, multiplier: 2 });
    const afterFirst = applyAction(state, { type: "ACKNOWLEDGE" });
    expect(afterFirst.ok).toBe(true);
    if (!afterFirst.ok) return;
    state = throwDart(afterFirst.state, "p2", { segment: 20, multiplier: 2 });
    const bull = applyAction(state, { type: "ACKNOWLEDGE" });
    expect(bull.ok).toBe(true);
    if (!bull.ok) return;

    const started = applyAction(bull.state, { type: "SET_LEG_STARTER", playerIndex: 0 });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.state.status).toBe("playing");
    expect(started.state.currentLeg.firstThrowerIndex).toBe(0);

    const reopened = applyAction(started.state, { type: "REOPEN_BULL_UP" });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.state.status).toBe("bullUp");
    expect(reopened.state.currentLeg.currentVisit).toEqual([]);

    const switched = applyAction(reopened.state, { type: "SET_LEG_STARTER", playerIndex: 1 });
    expect(switched.ok).toBe(true);
    if (!switched.ok) return;
    expect(switched.state.status).toBe("playing");
    expect(switched.state.currentLeg.firstThrowerIndex).toBe(1);
    expect(switched.state.currentLeg.currentPlayerIndex).toBe(1);
  });

  it("clears an in-progress visit when reopening ausbullen", () => {
    let state = createMatch(
      cfg({
        x01: { startScore: 40, inMode: "straight", outMode: "double" },
        legsToWinSet: 2,
        setsToWin: 1,
        bullUpLastLeg: true,
      }),
    );
    state = throwDart(state, "p1", { segment: 20, multiplier: 2 });
    const afterFirst = applyAction(state, { type: "ACKNOWLEDGE" });
    expect(afterFirst.ok).toBe(true);
    if (!afterFirst.ok) return;
    state = throwDart(afterFirst.state, "p2", { segment: 20, multiplier: 2 });
    const bull = applyAction(state, { type: "ACKNOWLEDGE" });
    expect(bull.ok).toBe(true);
    if (!bull.ok) return;
    const started = applyAction(bull.state, { type: "SET_LEG_STARTER", playerIndex: 0 });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const midVisit = applyAction(started.state, {
      type: "THROW_DART",
      playerId: "p1",
      dart: { segment: 20, multiplier: 1 },
    });
    expect(midVisit.ok).toBe(true);
    if (!midVisit.ok) return;
    expect(midVisit.state.currentLeg.currentVisit.length).toBe(1);
    expect(midVisit.state.currentLeg.players[0]?.remaining).toBe(20);

    const reopened = applyAction(midVisit.state, { type: "REOPEN_BULL_UP" });
    expect(reopened.ok).toBe(true);
    if (!reopened.ok) return;
    expect(reopened.state.status).toBe("bullUp");
    expect(reopened.state.currentLeg.currentVisit).toEqual([]);
    expect(reopened.state.currentLeg.players[0]?.remaining).toBe(40);
  });

  it("blocks ausbullen change after a completed visit", () => {
    let state = createMatch(
      cfg({
        x01: { startScore: 40, inMode: "straight", outMode: "double" },
        legsToWinSet: 2,
        setsToWin: 1,
        bullUpLastLeg: true,
      }),
    );
    state = throwDart(state, "p1", { segment: 20, multiplier: 2 });
    const afterFirst = applyAction(state, { type: "ACKNOWLEDGE" });
    expect(afterFirst.ok).toBe(true);
    if (!afterFirst.ok) return;
    state = throwDart(afterFirst.state, "p2", { segment: 20, multiplier: 2 });
    const bull = applyAction(state, { type: "ACKNOWLEDGE" });
    expect(bull.ok).toBe(true);
    if (!bull.ok) return;
    const started = applyAction(bull.state, { type: "SET_LEG_STARTER", playerIndex: 0 });
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    let last = started.state;
    last = throwDart(last, "p1", { segment: 5, multiplier: 1 });
    last = throwDart(last, "p1", { segment: 5, multiplier: 1 });
    last = throwDart(last, "p1", { segment: 5, multiplier: 1 });
    expect(last.currentLeg.visits.length).toBe(1);

    const blocked = applyAction(last, { type: "REOPEN_BULL_UP" });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error).toBe("Erst Aufnahme zurücknehmen.");
  });

  it("rejects reopening ausbullen when it is not the deciding last leg", () => {
    const state = createMatch(
      cfg({
        x01: { startScore: 40, inMode: "straight", outMode: "double" },
        legsToWinSet: 2,
        setsToWin: 1,
        bullUpLastLeg: true,
      }),
    );
    const blocked = applyAction(state, { type: "REOPEN_BULL_UP" });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error).toBe("Kein Ausbullen in diesem Leg.");
  });
});

