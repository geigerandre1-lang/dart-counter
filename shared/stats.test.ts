import { describe, expect, it } from "vitest";
import { applyAction, createDefaultConfig, createMatch } from "./engine/match.js";
import { computeMatchAnalysis, computeMatchReport, nameKey, visitPoints, buildMatchSummary, clubPlayerDisplayName, isClubScopedPlayerName, isDayReportClubPlayer, isTrainingTeam, matchNeedsDayReport, matchReportTableHtml, runningEndstand, TRAINING_TEAM_ID } from "./stats.js";
import type { MatchConfig } from "./types.js";

function cfg(partial: Partial<MatchConfig> = {}): MatchConfig {
  return { ...createDefaultConfig(), firstThrowerIndex: 0, ...partial };
}

describe("player names", () => {
  it("normalizes names case-insensitively for uniqueness", () => {
    expect(nameKey("  Anna  ")).toBe("anna");
    expect(nameKey("ANNA")).toBe("anna");
  });

  it("keeps Club - Name distinct from a local first name", () => {
    expect(nameKey("Andre")).not.toBe(nameKey("Testclub - Andre"));
    expect(clubPlayerDisplayName("Testclub", "Andre")).toBe("Testclub - Andre");
    expect(isClubScopedPlayerName("Testclub - Andre", "Testclub")).toBe(true);
    expect(isClubScopedPlayerName("Andre", "Testclub")).toBe(false);
  });
});

describe("Training team and day reports", () => {
  it("treats Training as a built-in team that does not count for Tagesbericht", () => {
    expect(isTrainingTeam({ id: TRAINING_TEAM_ID, name: "Training" })).toBe(true);
    expect(isTrainingTeam({ id: "other", name: "training" })).toBe(true);
    expect(isTrainingTeam({ id: "c1", name: "1. Mannschaft" })).toBe(false);
    expect(isDayReportClubPlayer({ teamId: "c1", teamName: "1. Mannschaft" })).toBe(true);
    expect(isDayReportClubPlayer({ teamId: TRAINING_TEAM_ID, teamName: "Training" }, TRAINING_TEAM_ID)).toBe(false);
    expect(isDayReportClubPlayer({ teamId: null, teamName: null })).toBe(false);
    expect(
      matchNeedsDayReport(
        [
          { teamId: TRAINING_TEAM_ID, teamName: "Training" },
          { teamId: null, teamName: null },
        ],
        TRAINING_TEAM_ID,
      ),
    ).toBe(false);
    expect(
      matchNeedsDayReport(
        [
          { teamId: TRAINING_TEAM_ID, teamName: "Training" },
          { teamId: "c1", teamName: "1. Mannschaft" },
        ],
        TRAINING_TEAM_ID,
      ),
    ).toBe(true);
  });
});

describe("visit stats", () => {
  it("counts an exact 180 visit", () => {
    let state = createMatch(
      cfg({
        x01: { startScore: 501, inMode: "straight", outMode: "double" },
        legsToWinSet: 1,
        setsToWin: 1,
      }),
    );
    const result = applyAction(state, { type: "SET_VISIT_TOTAL", playerId: "p1", total: 180 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    const visit = state.matchVisits.at(-1);
    expect(visit?.total).toBe(180);
    expect(visitPoints(visit!)).toBe(180);

    const analysis = computeMatchAnalysis(state);
    expect(analysis.playerStats.p1?.score180).toBe(1);
    expect(analysis.playerStats.p1?.plus140).toBe(1);
    expect(analysis.playerStats.p1?.plus60).toBe(1);
    expect(analysis.playerStats.p1?.average).toBe(180);
  });

  it("excludes busts from scoring but counts the darts", () => {
    let state = createMatch(
      cfg({
        x01: { startScore: 50, inMode: "straight", outMode: "double" },
        legsToWinSet: 1,
        setsToWin: 1,
      }),
    );
    const bust = applyAction(state, { type: "SET_VISIT_TOTAL", playerId: "p1", total: 60 });
    expect(bust.ok).toBe(true);
    if (!bust.ok) return;
    state = bust.state;
    const analysis = computeMatchAnalysis(state);
    expect(analysis.playerStats.p1?.totalPoints).toBe(0);
    expect(analysis.playerStats.p1?.dartsThrown).toBe(3);
    expect(analysis.playerStats.p1?.plus60).toBe(0);
    expect(analysis.playerStats.p1?.average).toBe(0);
  });

  it("counts First-3 / First-9 and a 26er visit", () => {
    let state = createMatch(
      cfg({
        x01: { startScore: 501, inMode: "straight", outMode: "double" },
        legsToWinSet: 1,
        setsToWin: 1,
      }),
    );
    const first = applyAction(state, { type: "SET_VISIT_TOTAL", playerId: "p1", total: 180 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    state = first.state;
    const second = applyAction(state, { type: "SET_VISIT_TOTAL", playerId: "p2", total: 60 });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    state = second.state;
    const twenty = applyAction(state, { type: "THROW_DART", playerId: "p1", dart: { segment: 20, multiplier: 1 } });
    expect(twenty.ok).toBe(true);
    if (!twenty.ok) return;
    state = twenty.state;
    const five = applyAction(state, { type: "THROW_DART", playerId: "p1", dart: { segment: 5, multiplier: 1 } });
    expect(five.ok).toBe(true);
    if (!five.ok) return;
    state = five.state;
    const one = applyAction(state, { type: "THROW_DART", playerId: "p1", dart: { segment: 1, multiplier: 1 } });
    expect(one.ok).toBe(true);
    if (!one.ok) return;
    state = one.state;

    const analysis = computeMatchAnalysis(state);
    expect(analysis.playerStats.p1?.score26).toBe(1);
    expect(analysis.playerStats.p1?.first3Average).toBe(180);
    expect(analysis.playerStats.p1?.first9Points).toBe(180 + 26);
    expect(analysis.playerStats.p1?.first9Average).toBe((3 * (180 + 26)) / 6);
  });
});

describe("match summary", () => {
  it("prefixes a Wettkampf with Mannschaft vs Mannschaft", () => {
    let state = createMatch(
      cfg({
        players: [
          { id: "p1", name: "Alex", teamId: "c1", teamName: "DC Nord" },
          { id: "p2", name: "Kim", teamId: "c2", teamName: "DC Süd" },
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
    const result = applyAction(state, {
      type: "THROW_DART",
      playerId: "p1",
      dart: { segment: 20, multiplier: 2 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    state = result.state;
    const summary = buildMatchSummary(state);
    expect(summary).toContain("Spiel 1 —");
    expect(summary).toContain("DC Nord schlägt DC Süd.");
    expect(summary).toContain("Alex schlägt Kim");
    expect(summary).toContain("Endstand 1:0");
    const report = computeMatchReport(state, Date.now(), 1);
    expect(report.headline).toContain("Spiel 1 —");
    expect(report.endstand).toBe("1:0");
    expect(report.legs).toHaveLength(1);
    expect(report.legs[0]?.winnerName).toBe("Alex");
    expect(report.legs[0]?.starterName).toBe("Alex");
    expect(report.legs[0]?.checkout).toBe(40);
    expect(summary).toContain("Beginner des Legs");
    const html = matchReportTableHtml({
      headline: report.headline,
      endstand: report.endstand,
      players: report.players,
      legs: report.legs,
    });
    expect(html).toContain("<table>");
    expect(html).toContain("Beginner des Legs");
    expect(html).toMatch(/<strong>Alex<\/strong>/);
    expect(html).toContain("Endstand 1:0");
  });

  it("tracks running endstand after each leg", () => {
    const players = [
      { id: "p1", name: "Alex" },
      { id: "p2", name: "Kim" },
    ];
    const scores = runningEndstand(
      [
        { legNumber: 1, winnerId: "p1", winnerName: "Alex", starterName: "Kim", opponentRemainingLabel: "40", winnerDarts: 3, checkout: 40, winnerAverage: 40 },
        { legNumber: 2, winnerId: "p2", winnerName: "Kim", starterName: "Alex", opponentRemainingLabel: "80", winnerDarts: 12, checkout: null, winnerAverage: 50 },
        { legNumber: 3, winnerId: "p1", winnerName: "Alex", starterName: "Kim", opponentRemainingLabel: "24", winnerDarts: 15, checkout: 24, winnerAverage: 55 },
      ],
      players,
    );
    expect(scores).toEqual(["1:0", "1:1", "2:1"]);
  });
});
