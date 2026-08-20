import type { GameType, LegReport, MatchState, Player, Visit } from "./types.js";

/**
 * 3-Dart-Average (x01-üblich, für alle Spielarten gleich berechnet):
 *   average = dartsThrown > 0 ? 3 * totalPoints / dartsThrown : 0
 *
 * Busts: die Aufnahme zählt 0 Punkte (Visit.total ist bereits 0), die
 * geworfenen Darts zählen trotzdem in dartsThrown. Es wird nicht still
 * mit einer anderen Aufnahme verrechnet.
 *
 * Missed darts: Segment 0.
 * 60+/80+/100+/120+/140+: Visit-Punkte (nicht-Bust) >= Schwelle.
 * 180s: Visit-Punkte genau 180.
 * 26er: Aufnahme 20 + 5 + 1 (beliebige Reihenfolge).
 *
 * Gesamteingabe zählt als 3 Darts. Cricket/Clock/Shanghai: Misses auf
 * Dart-Ebene; Visit-Totals wo eine 3-Dart-Aufnahme existiert (Clock speichert
 * 0 als Total — dann zählt die Summe der Dart-Punkte).
 */
export const AVERAGE_RULE_DE =
  "3-Dart-Average: 3 × Punkte / geworfene Darts. Busts geben 0 Punkte, die Darts zählen mit. First-3 = erste Aufnahme je Leg, First-9 = erste drei Aufnahmen je Leg.";

export const PLAYER_NAME_TAKEN = "Spieler bereits vorhanden, anderen Namen wählen";

export function clubPlayerDisplayName(clubName: string, firstName: string): string {
  return `${clubName.trim()} - ${firstName.trim()}`;
}

export function isClubScopedPlayerName(playerName: string, clubName: string): boolean {
  const prefix = `${clubName.trim()} - `;
  return nameKey(playerName).startsWith(nameKey(prefix)) && playerName.trim().length > prefix.length;
}

/** In-game name: strip a stored `Mannschaft - Name` prefix. */
export function inGamePlayerName(name: string): string {
  const trimmed = name.trim();
  const sep = " - ";
  const idx = trimmed.indexOf(sep);
  if (idx >= 0 && idx < trimmed.length - sep.length) {
    const rest = trimmed.slice(idx + sep.length).trim();
    if (rest) return rest;
  }
  return trimmed;
}

export function formatPlayerPassLabel(player: Pick<Player, "name" | "passNr">): string {
  const name = inGamePlayerName(player.name);
  const pass = (player.passNr ?? "").trim();
  return pass ? `${name} (Pass ${pass})` : name;
}

export function toMatchPlayer(player: Player): Player {
  return {
    id: player.id,
    name: inGamePlayerName(player.name),
    teamId: player.teamId ?? null,
    teamName: player.teamName ?? null,
  };
}

export const TRAINING_TEAM_NAME = "Training";
export const TRAINING_TEAM_ID = "training";

export function isTrainingTeamName(name?: string | null): boolean {
  return nameKey(name ?? "") === nameKey(TRAINING_TEAM_NAME);
}

export function isTrainingTeam(team?: { id?: string | null; name?: string | null } | null): boolean {
  if (!team) return false;
  return team.id === TRAINING_TEAM_ID || isTrainingTeamName(team.name);
}

/** Club/Mannschaft member who counts for Tagesbericht — Training does not. */
export function isDayReportClubPlayer(
  player: { teamId?: string | null; teamName?: string | null; clubId?: string | null },
  trainingTeamId?: string | null,
): boolean {
  if (trainingTeamId && player.teamId === trainingTeamId) return false;
  if (isTrainingTeamName(player.teamName)) return false;
  return Boolean(player.teamId || player.clubId);
}

export function matchNeedsDayReport(
  players: Array<{ teamId?: string | null; teamName?: string | null; clubId?: string | null }> | null | undefined,
  trainingTeamId?: string | null,
): boolean {
  return (players ?? []).some((player) => isDayReportClubPlayer(player, trainingTeamId));
}

export const GAME_LABELS_DE: Record<GameType, string> = {
  x01: "x01",
  cricket: "Cricket",
  elimination: "Elimination",
  clock: "Around the Clock",
  shanghai: "Shanghai",
};

export interface PlayerVisitStats {
  average: number;
  totalPoints: number;
  dartsThrown: number;
  misses: number;
  visits: number;
  plus60: number;
  plus80: number;
  plus100: number;
  plus120: number;
  plus140: number;
  score180: number;
  matchesWon: number;
  matchesLost: number;
  legsWon: number;
  legsLost: number;
  first3Points: number;
  first3Darts: number;
  first3Average: number;
  first9Points: number;
  first9Darts: number;
  first9Average: number;
  highestFinish: number;
  checkoutHits: number;
  checkoutAttempts: number;
  checkoutPercent: number;
  highestVisit: number;
  score26: number;
}

export interface MatchAnalysisPayload {
  matchId: string;
  playedAt: number;
  gameType: GameType;
  opponents: Player[];
  winnerId: string | null;
  scoreline: string;
  playerStats: Record<string, PlayerVisitStats>;
}

export interface MatchReportPayload {
  matchId: string;
  playedAt: number;
  gameType: GameType;
  gameTitle: string;
  players: Player[];
  winnerId: string | null;
  winnerName: string;
  scoreline: string;
  /** Same as scoreline; sets if setsToWin > 1, otherwise legs. */
  endstand: string;
  matchNumber: number;
  headline: string;
  dartsThrown: number;
  roundCount: number;
  checkout: number | null;
  summary: string;
  playerStats: Record<string, PlayerVisitStats>;
  legs: LegReport[];
}

export function emptyVisitStats(): PlayerVisitStats {
  return {
    average: 0,
    totalPoints: 0,
    dartsThrown: 0,
    misses: 0,
    visits: 0,
    plus60: 0,
    plus80: 0,
    plus100: 0,
    plus120: 0,
    plus140: 0,
    score180: 0,
    matchesWon: 0,
    matchesLost: 0,
    legsWon: 0,
    legsLost: 0,
    first3Points: 0,
    first3Darts: 0,
    first3Average: 0,
    first9Points: 0,
    first9Darts: 0,
    first9Average: 0,
    highestFinish: 0,
    checkoutHits: 0,
    checkoutAttempts: 0,
    checkoutPercent: 0,
    highestVisit: 0,
    score26: 0,
  };
}

export function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/** Points that count toward average / high-visit buckets. Busts are 0. */
export function visitPoints(visit: Visit): number {
  if (visit.bust) return 0;
  if (visit.total > 0) return visit.total;
  return visit.darts.reduce((sum, dart) => sum + dart.segment * dart.multiplier, 0);
}

export function dartsThrownInVisit(visit: Visit): number {
  if (visit.kind === "total") return 3;
  if (visit.darts.length > 0) return visit.darts.length;
  return 3;
}

export function missesInVisit(visit: Visit): number {
  return visit.darts.filter((d) => d.segment === 0).length;
}

export function isBedAndBreakfast(visit: Visit): boolean {
  if (visit.bust || visit.kind === "total") return false;
  if (visit.darts.length !== 3) return false;
  const segs = visit.darts.map((d) => d.segment).sort((a, b) => a - b);
  return segs[0] === 1 && segs[1] === 5 && segs[2] === 20;
}

export function addVisitToStats(stats: PlayerVisitStats, visit: Visit): void {
  const points = visitPoints(visit);
  stats.totalPoints += points;
  stats.dartsThrown += dartsThrownInVisit(visit);
  stats.visits += 1;
  stats.misses += missesInVisit(visit);
  if (!visit.bust) {
    if (points >= 60) stats.plus60 += 1;
    if (points >= 80) stats.plus80 += 1;
    if (points >= 100) stats.plus100 += 1;
    if (points >= 120) stats.plus120 += 1;
    if (points >= 140) stats.plus140 += 1;
    if (points === 180) stats.score180 += 1;
    if (points > stats.highestVisit) stats.highestVisit = points;
  }
  if (isBedAndBreakfast(visit)) stats.score26 += 1;
  if (visit.checkoutAttempt) stats.checkoutAttempts += 1;
  if (visit.checkout) {
    stats.checkoutHits += 1;
    const finish = visit.finishScore ?? points;
    if (finish > stats.highestFinish) stats.highestFinish = finish;
  }
  stats.average = stats.dartsThrown > 0 ? (3 * stats.totalPoints) / stats.dartsThrown : 0;
  stats.checkoutPercent = stats.checkoutAttempts > 0 ? (100 * stats.checkoutHits) / stats.checkoutAttempts : 0;
}

export function statsFromVisits(visits: Visit[], playerIds: string[]): Record<string, PlayerVisitStats> {
  const byPlayer: Record<string, PlayerVisitStats> = {};
  for (const id of playerIds) byPlayer[id] = emptyVisitStats();
  for (const visit of visits) {
    const stats = byPlayer[visit.playerId] ?? emptyVisitStats();
    addVisitToStats(stats, visit);
    byPlayer[visit.playerId] = stats;
  }
  applyFirstAverages(byPlayer, visits);
  return byPlayer;
}

function applyFirstAverages(byPlayer: Record<string, PlayerVisitStats>, visits: Visit[]): void {
  const grouped = new Map<string, Visit[]>();
  for (const visit of visits) {
    const key = `${visit.playerId}#${visit.legSeq ?? 1}`;
    const list = grouped.get(key) ?? [];
    list.push(visit);
    grouped.set(key, list);
  }
  for (const [key, list] of grouped) {
    const playerId = key.split("#")[0]!;
    const stats = byPlayer[playerId];
    if (!stats) continue;
    const first = list[0];
    if (first) {
      stats.first3Points += visitPoints(first);
      stats.first3Darts += dartsThrownInVisit(first);
    }
    for (const visit of list.slice(0, 3)) {
      stats.first9Points += visitPoints(visit);
      stats.first9Darts += dartsThrownInVisit(visit);
    }
  }
  for (const stats of Object.values(byPlayer)) {
    stats.first3Average = stats.first3Darts > 0 ? (3 * stats.first3Points) / stats.first3Darts : 0;
    stats.first9Average = stats.first9Darts > 0 ? (3 * stats.first9Points) / stats.first9Darts : 0;
  }
}

export function allMatchVisits(state: MatchState): Visit[] {
  if (state.matchVisits?.length) return state.matchVisits;
  return state.currentLeg?.visits ?? [];
}

export function matchScoreline(state: MatchState): string {
  const n = state.config.players.length;
  if (state.config.setsToWin > 1) {
    return (state.setsWon ?? Array.from({ length: n }, () => 0)).join(":");
  }
  const legs = state.matchLegsWon ?? state.legsWon ?? Array.from({ length: n }, () => 0);
  return legs.join(":");
}

export function gameTitle(state: MatchState): string {
  const game = state.config.gameType;
  if (game === "x01") return String(state.config.x01.startScore);
  if (game === "elimination") return `Elimination ${state.config.elimination.target}`;
  return GAME_LABELS_DE[game];
}

function lastCheckout(state: MatchState): number | null {
  const visits = allMatchVisits(state);
  for (let i = visits.length - 1; i >= 0; i--) {
    const visit = visits[i]!;
    if (visit.checkout) return visit.finishScore ?? visitPoints(visit);
  }
  return null;
}

export function formatPlayerMatchLabel(player: Player): string {
  const labeled = formatPlayerPassLabel(player);
  if ((player.passNr ?? "").trim()) return labeled;
  if (player.teamName) return `${labeled} (${player.teamName})`;
  return labeled;
}

export function matchHeadline(players: Player[], matchNumber: number): string {
  const n = Math.max(1, Math.round(matchNumber) || 1);
  return `Spiel ${n} — ${players.map(formatPlayerMatchLabel).join(" vs ")}`;
}

export function reportPlayerLabel(players: Player[], id: string, fallback = ""): string {
  const player = players.find((p) => p.id === id);
  if (player) return formatPlayerPassLabel(player);
  return inGamePlayerName(fallback);
}

export const LEG_REPORT_TABLE_HEADERS = [
  "Leg",
  "Gewinner",
  "Beginner des Legs",
  "Rest Gegner",
  "Darts",
  "Checkout",
  "Average",
  "Endstand",
] as const;

export type LegReportView = Pick<
  LegReport,
  "legNumber" | "winnerName" | "starterName" | "opponentRemainingLabel" | "winnerDarts" | "checkout" | "winnerAverage"
> &
  Partial<Pick<LegReport, "setNumber" | "winnerId" | "starterId" | "playerDarts">>;

export function formatLegDartsCell(leg: LegReportView, players: Player[]): string {
  const darts = leg.playerDarts ?? {};
  if (players.length > 1 && Object.keys(darts).length > 0) {
    return players.map((p) => `${formatPlayerPassLabel(p)} ${darts[p.id] ?? 0}`).join(" / ");
  }
  return String(leg.winnerDarts);
}

export function formatCheckoutCell(checkout: number | null | undefined): string {
  return checkout != null && checkout > 0 ? String(checkout) : "–";
}

export function runningEndstand(legs: LegReportView[], players: Player[]): string[] {
  const counts = players.map(() => 0);
  const indexById = new Map(players.map((p, i) => [p.id, i]));
  const indexByName = new Map(players.map((p, i) => [inGamePlayerName(p.name), i]));
  return legs.map((leg) => {
    const byId = leg.winnerId ? indexById.get(leg.winnerId) : undefined;
    const byName = indexByName.get(inGamePlayerName(leg.winnerName));
    const i = byId ?? byName;
    if (i != null) counts[i] += 1;
    return counts.join(":");
  });
}

export function formatLegNumberCell(leg: LegReportView): string {
  if (leg.setNumber && leg.setNumber > 1) return `${leg.legNumber} · Satz ${leg.setNumber}`;
  return String(leg.legNumber);
}

export function formatLegReportLine(leg: LegReport, players: Player[]): string {
  const darts = formatLegDartsCell(leg, players);
  const checkout = leg.checkout != null && leg.checkout > 0 ? ` · Checkout ${leg.checkout}` : "";
  const winnerName = reportPlayerLabel(players, leg.winnerId, leg.winnerName);
  const starterName = reportPlayerLabel(players, leg.starterId, leg.starterName);
  return `Leg ${leg.legNumber}: ${winnerName} gewinnt · Rest Gegner ${leg.opponentRemainingLabel} · Darts ${darts} · Beginner des Legs ${starterName} · Avg ${formatAverage(leg.winnerAverage)}${checkout}`;
}

function escapeReportHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/** Dark-theme HTML table for Spielbericht / Tagesbericht (web + desktop export). */
export function matchReportTableHtml(opts: {
  headline: string;
  endstand: string;
  meta?: string;
  players: Player[];
  legs: LegReportView[];
}): string {
  const scores = runningEndstand(opts.legs, opts.players);
  const rows =
    opts.legs
      .map((leg, i) => {
        const starter = reportPlayerLabel(opts.players, leg.starterId ?? "", leg.starterName);
        return `<tr>
              <td>${escapeReportHtml(formatLegNumberCell(leg))}</td>
              <td>${escapeReportHtml(leg.winnerName)}</td>
              <td class="beginner"><strong>${escapeReportHtml(starter)}</strong></td>
              <td>${escapeReportHtml(leg.opponentRemainingLabel || "–")}</td>
              <td>${escapeReportHtml(formatLegDartsCell(leg, opts.players))}</td>
              <td>${escapeReportHtml(formatCheckoutCell(leg.checkout))}</td>
              <td>${escapeReportHtml(formatAverage(leg.winnerAverage))}</td>
              <td>${escapeReportHtml(scores[i] || "–")}</td>
            </tr>`;
      })
      .join("") || `<tr><td colspan="${LEG_REPORT_TABLE_HEADERS.length}">Keine Leg-Daten.</td></tr>`;
  const head = LEG_REPORT_TABLE_HEADERS.map((label) =>
    label === "Beginner des Legs" ? `<th class="beginner">${label}</th>` : `<th>${label}</th>`,
  ).join("");
  const meta = opts.meta ? `<p class="meta">${escapeReportHtml(opts.meta)}</p>` : "";
  return `<section class="match-report">
          <h2>${escapeReportHtml(opts.headline)}</h2>
          <p class="endstand">Endstand ${escapeReportHtml(opts.endstand)}</p>
          ${meta}
          <div class="table-wrap">
          <table>
            <thead><tr>${head}</tr></thead>
            <tbody>${rows}</tbody>
          </table>
          </div>
        </section>`;
}

export const MATCH_REPORT_HTML_STYLES = `
  body { font-family: "Segoe UI", system-ui, sans-serif; background: #05070d; color: #e2e8f0; padding: 20px; }
  h1 { font-size: 1.6rem; color: #f8fafc; }
  h2 { font-size: 1.15rem; margin: 1.5rem 0 0.25rem; color: #fff; }
  .endstand { margin: 0 0 0.35rem; font-size: 1rem; color: #ffb020; font-weight: 700; }
  .meta { margin: 0 0 0.75rem; color: #94a3b8; font-size: 0.85rem; }
  .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table { border-collapse: collapse; width: 100%; min-width: 36rem; margin: 0 0 1.5rem; }
  th, td { border-bottom: 1px solid #1e2c44; padding: 0.55rem 0.6rem; text-align: left; font-size: 0.9rem; vertical-align: top; }
  th { color: #94a3b8; font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em; }
  td.beginner, th.beginner, td.beginner strong { font-weight: 700; color: #fff; }
  section.match-report { margin-bottom: 1.25rem; }
`;

export function snapshotCompletedLeg(state: MatchState, winnerIndex: number): LegReport {
  const winner = state.config.players[winnerIndex]!;
  const starter = state.config.players[state.currentLeg.firstThrowerIndex] ?? winner;
  const visits = state.currentLeg.visits ?? [];
  const playerIds = state.config.players.map((p) => p.id);
  const playerDarts: Record<string, number> = {};
  for (const id of playerIds) playerDarts[id] = 0;
  for (const visit of visits) {
    playerDarts[visit.playerId] = (playerDarts[visit.playerId] ?? 0) + dartsThrownInVisit(visit);
  }
  const stats = statsFromVisits(visits, playerIds);
  const playerAverages: Record<string, number> = {};
  for (const id of playerIds) playerAverages[id] = stats[id]?.average ?? 0;

  let opponentRemaining: number | null = null;
  let opponentRemainingLabel = "–";
  const others = state.config.players
    .map((player, index) => ({ player, index }))
    .filter(({ index }) => index !== winnerIndex);
  if (state.config.gameType === "x01" && others.length > 0) {
    const scores = others.map(({ player, index }) => {
      const remaining = state.currentLeg.players[index]?.remaining ?? 0;
      return { name: player.name, remaining };
    });
    opponentRemaining = scores[0]?.remaining ?? null;
    opponentRemainingLabel =
      scores.length === 1 ? String(scores[0]!.remaining) : scores.map((s) => `${s.name} ${s.remaining}`).join(", ");
  } else if (state.config.gameType === "elimination" && others.length > 0) {
    const scores = others.map(({ player, index }) => {
      const remaining = state.currentLeg.players[index]?.remaining ?? 0;
      return { name: player.name, remaining };
    });
    opponentRemaining = scores[0]?.remaining ?? null;
    opponentRemainingLabel =
      scores.length === 1 ? String(scores[0]!.remaining) : scores.map((s) => `${s.name} ${s.remaining}`).join(", ");
  }

  let checkout: number | null = null;
  for (let i = visits.length - 1; i >= 0; i--) {
    const visit = visits[i]!;
    if (visit.checkout) {
      checkout = visit.finishScore ?? visitPoints(visit);
      break;
    }
  }

  return {
    legNumber: state.legSeq ?? 1,
    setNumber: state.currentSet ?? 1,
    winnerId: winner.id,
    winnerName: winner.name,
    starterId: starter.id,
    starterName: starter.name,
    opponentRemaining,
    opponentRemainingLabel,
    winnerDarts: playerDarts[winner.id] ?? 0,
    playerDarts,
    playerAverages,
    checkout,
    winnerAverage: stats[winner.id]?.average ?? 0,
  };
}

function reconstructLegReports(state: MatchState): LegReport[] {
  if (state.legReports?.length) return state.legReports;
  const visits = allMatchVisits(state);
  const byLeg = new Map<number, Visit[]>();
  for (const visit of visits) {
    const seq = visit.legSeq ?? 1;
    const list = byLeg.get(seq) ?? [];
    list.push(visit);
    byLeg.set(seq, list);
  }
  const reports: LegReport[] = [];
  for (const [legNumber, list] of [...byLeg.entries()].sort((a, b) => a[0] - b[0])) {
    const checkoutVisit = [...list].reverse().find((v) => v.checkout);
    const winner = checkoutVisit
      ? state.config.players.find((p) => p.id === checkoutVisit.playerId)
      : undefined;
    if (!winner) continue;
    const playerIds = state.config.players.map((p) => p.id);
    const playerDarts: Record<string, number> = {};
    for (const id of playerIds) playerDarts[id] = 0;
    for (const visit of list) {
      playerDarts[visit.playerId] = (playerDarts[visit.playerId] ?? 0) + dartsThrownInVisit(visit);
    }
    const stats = statsFromVisits(list, playerIds);
    const playerAverages: Record<string, number> = {};
    for (const id of playerIds) playerAverages[id] = stats[id]?.average ?? 0;
    const starter = state.config.players.find((p) => p.id === list[0]?.playerId) ?? winner;
    reports.push({
      legNumber,
      setNumber: 1,
      winnerId: winner.id,
      winnerName: winner.name,
      starterId: starter.id,
      starterName: starter.name,
      opponentRemaining: null,
      opponentRemainingLabel: "–",
      winnerDarts: playerDarts[winner.id] ?? 0,
      playerDarts,
      playerAverages,
      checkout: checkoutVisit ? (checkoutVisit.finishScore ?? visitPoints(checkoutVisit)) : null,
      winnerAverage: stats[winner.id]?.average ?? 0,
    });
  }
  return reports;
}

export function computeMatchAnalysis(state: MatchState, playedAt = Date.now()): MatchAnalysisPayload {
  const playerIds = state.config.players.map((p) => p.id);
  const playerStats = statsFromVisits(allMatchVisits(state), playerIds);
  const winnerId =
    state.lastWinnerIndex != null ? (state.config.players[state.lastWinnerIndex]?.id ?? null) : null;
  const totalLegs = (state.matchLegsWon ?? state.legsWon ?? []).reduce((s, n) => s + n, 0);
  for (const [i, player] of state.config.players.entries()) {
    const stats = playerStats[player.id];
    if (!stats) continue;
    const legs = state.matchLegsWon?.[i] ?? state.legsWon[i] ?? 0;
    stats.legsWon = legs;
    stats.legsLost = Math.max(0, totalLegs - legs);
    if (state.status === "matchOver" && winnerId) {
      if (player.id === winnerId) stats.matchesWon = 1;
      else stats.matchesLost = 1;
    }
  }
  return {
    matchId: state.id,
    playedAt,
    gameType: state.config.gameType,
    opponents: state.config.players.map((p) => ({
      id: p.id,
      name: inGamePlayerName(p.name),
      teamId: p.teamId ?? null,
      teamName: p.teamName ?? null,
      passNr: (p.passNr ?? "").trim() || null,
    })),
    winnerId,
    scoreline: matchScoreline(state),
    playerStats,
  };
}

export function buildMatchSummary(
  state: MatchState,
  analysis = computeMatchAnalysis(state),
  matchNumber = 1,
): string {
  const winner = analysis.opponents.find((p) => p.id === analysis.winnerId);
  const others = analysis.opponents.filter((p) => p.id !== analysis.winnerId);
  const title = gameTitle(state);
  const teams = state.config.teams ?? [];
  const clubPrefix = (() => {
    if (teams.length < 2 || !winner) return "";
    const winnerTeam = winner.teamName || teams.find((t) => t.id === winner.teamId)?.name;
    const otherTeam = teams.find((t) => t.name !== winnerTeam)?.name;
    if (winnerTeam && otherTeam) return `${winnerTeam} schlägt ${otherTeam}. `;
    return "";
  })();
  const headline = matchHeadline(analysis.opponents, matchNumber);
  const endstand = analysis.scoreline;
  const legs = reconstructLegReports(state);
  const legLines = legs.map((leg) => formatLegReportLine(leg, analysis.opponents));
  if (!winner) {
    return [`${headline}`, clubPrefix.trim(), `Endstand ${endstand || "–"} in ${title}.`, ...legLines]
      .filter(Boolean)
      .join("\n");
  }
  const vs = others.map((p) => formatPlayerPassLabel(p)).join(" und ") || "die Gegner";
  const winnerStats = analysis.playerStats[winner.id];
  const avg = winnerStats ? formatAverage(winnerStats.average) : "0.0";
  const checkout = lastCheckout(state);
  const checkoutPart = checkout != null && checkout > 0 ? `, Checkout ${checkout}` : "";
  const lead = `${clubPrefix}${formatPlayerPassLabel(winner)} schlägt ${vs} ${endstand} in ${title}, Average ${avg}${checkoutPart}.`;
  return [`${headline}`, `Endstand ${endstand}`, lead, ...legLines].join("\n");
}

export function computeMatchReport(
  state: MatchState,
  playedAt = Date.now(),
  matchNumber = 1,
): MatchReportPayload {
  const analysis = computeMatchAnalysis(state, playedAt);
  const visits = allMatchVisits(state);
  const dartsThrown = visits.reduce((sum, visit) => sum + dartsThrownInVisit(visit), 0);
  const winner = analysis.opponents.find((p) => p.id === analysis.winnerId);
  const n = Math.max(1, Math.round(matchNumber) || 1);
  const players = analysis.opponents;
  return {
    matchId: analysis.matchId,
    playedAt,
    gameType: analysis.gameType,
    gameTitle: gameTitle(state),
    players,
    winnerId: analysis.winnerId,
    winnerName: winner ? formatPlayerPassLabel(winner) : "",
    scoreline: analysis.scoreline,
    endstand: analysis.scoreline,
    matchNumber: n,
    headline: matchHeadline(players, n),
    dartsThrown,
    roundCount: roundCountOf(state),
    checkout: lastCheckout(state),
    summary: buildMatchSummary(state, analysis, n),
    playerStats: analysis.playerStats,
    legs: reconstructLegReports(state).map((leg) => ({
      ...leg,
      winnerName: reportPlayerLabel(players, leg.winnerId, leg.winnerName),
      starterName: reportPlayerLabel(players, leg.starterId, leg.starterName),
    })),
  };
}

function roundCountOf(state: MatchState): number {
  if (state.config.gameType === "shanghai") {
    return Math.max(1, state.currentLeg.shanghaiRound || 1);
  }
  const n = Math.max(1, state.config.players.length);
  return Math.max(1, Math.ceil(allMatchVisits(state).length / n));
}

export function formatAverage(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0.0";
  return value.toFixed(1);
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0%";
  return `${value.toFixed(0)}%`;
}
