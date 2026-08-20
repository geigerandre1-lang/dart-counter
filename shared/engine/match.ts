import { canCheckout, checkoutHint, isValidFinishDart } from "../checkouts.js";
import { cricketTargets, dartsForTotal, isPossibleVisitTotal, isValidDart, pointsOf } from "../darts.js";
import { inGamePlayerName, snapshotCompletedLeg } from "../stats.js";
import type {
  ActionResult,
  ClientAction,
  CricketOptions,
  DartThrow,
  LegState,
  MatchConfig,
  MatchState,
  Player,
  PlayerLegState,
  Visit,
} from "../types.js";
import { STANDARD_CRICKET_NUMBERS } from "../types.js";

const MAX_UNDO = 80;

function clone<T>(value: T): T {
  return structuredClone(value);
}

function emptyMarks(targets: number[]): Record<string, number> {
  const marks: Record<string, number> = {};
  for (const n of targets) marks[String(n)] = 0;
  return marks;
}

function cricketNumbers(options: CricketOptions): number[] {
  return cricketTargets(options.numbers, options.includeBull);
}

function initPlayer(config: MatchConfig): PlayerLegState {
  const elimination = config.gameType === "elimination";
  return {
    remaining: elimination ? 0 : config.x01.startScore,
    opened: elimination ? config.elimination.inMode === "straight" : config.x01.inMode === "straight",
    marks: emptyMarks(cricketNumbers(config.cricket)),
    cricketScore: 0,
    lives: 0,
    eliminated: false,
    nextTarget: 1,
    shanghaiScore: 0,
    clockFinished: false,
  };
}

function createLeg(config: MatchConfig, firstThrowerIndex: number): LegState {
  const players = config.players.map(() => initPlayer(config));
  return {
    firstThrowerIndex,
    currentPlayerIndex: firstThrowerIndex,
    players,
    currentVisit: [],
    visitStartSnapshot: clone(players),
    visits: [],
    winnerIndex: null,
    bustMessage: null,
    eliminationTarget: config.gameType === "elimination" ? config.elimination.target : null,
    knockedPlayerIds: [],
    shanghaiRound: 1,
    roundVisits: 0,
  };
}

/** Stable default roster so a match can start without creating players. */
export const DEFAULT_PLAYERS: Player[] = [
  { id: "p1", name: "Spieler 1" },
  { id: "p2", name: "Spieler 2" },
];

export function createDefaultConfig(): MatchConfig {
  return {
    gameType: "x01",
    players: DEFAULT_PLAYERS.map((p) => ({ ...p })),
    firstThrowerIndex: 1,
    legsToWinSet: 3,
    setsToWin: 1,
    inputMode: "single",
    x01: { startScore: 501, inMode: "straight", outMode: "double" },
    cricket: { numbers: [...STANDARD_CRICKET_NUMBERS], includeBull: true },
    elimination: { target: 501, inMode: "straight", outMode: "double", extreme: false },
    clock: { requireMode: "any" },
    shanghai: { endNumber: 7, shanghaiWins: true },
    teams: [],
    bullUpLastLeg: true,
  };
}

export function normalizeConfig(raw: MatchConfig): MatchConfig {
  const players = (raw.players ?? [])
    .slice(0, 8)
    .map((p, i) => {
      const fallback = `Spieler ${i + 1}`;
      const rawName = (p.name || fallback).trim() || fallback;
      return {
        id: p.id || `p${i + 1}`,
        name: inGamePlayerName(rawName) || fallback,
        teamId: p.teamId ?? null,
        teamName: p.teamName ?? null,
      };
    });
  while (players.length < 1) {
    players.push({ id: "p1", name: "Spieler 1", teamId: null, teamName: null });
  }
  const fallbackFirst = players.length >= 2 ? 1 : 0;
  const hasFirst = Number.isInteger(raw.firstThrowerIndex);
  const first = Math.min(
    Math.max(0, hasFirst ? raw.firstThrowerIndex : fallbackFirst),
    Math.max(0, players.length - 1),
  );
  const startScore = Math.min(10001, Math.max(2, Math.round(raw.x01?.startScore ?? 501)));
  const elimRaw = raw.elimination as (MatchConfig["elimination"] & { lives?: number; target?: number }) | undefined;
  const elimTarget = Math.min(
    10001,
    Math.max(2, Math.round(elimRaw?.target ?? startScore)),
  );
  const endNumber = Math.min(20, Math.max(1, Math.round(raw.shanghai?.endNumber ?? 7)));
  const legsToWinSet = Math.min(21, Math.max(1, Math.round(raw.legsToWinSet ?? 1)));
  const setsToWin = Math.min(21, Math.max(1, Math.round(raw.setsToWin ?? 1)));
  let numbers = (raw.cricket?.numbers ?? [...STANDARD_CRICKET_NUMBERS])
    .filter((n) => Number.isInteger(n) && n >= 1 && n <= 20);
  numbers = [...new Set(numbers)];
  if (numbers.length === 0) numbers = [...STANDARD_CRICKET_NUMBERS];
  const includeBull = raw.cricket?.includeBull !== false;
  const gameType = raw.gameType;
  let inputMode = raw.inputMode ?? "single";
  if (gameType === "cricket" || gameType === "clock" || gameType === "shanghai" || gameType === "elimination") {
    inputMode = "single";
  }
  return {
    gameType,
    players,
    firstThrowerIndex: first,
    legsToWinSet,
    setsToWin,
    inputMode,
    x01: {
      startScore,
      inMode: raw.x01?.inMode === "double" ? "double" : "straight",
      outMode: raw.x01?.outMode === "straight" || raw.x01?.outMode === "master" ? raw.x01.outMode : "double",
    },
    cricket: { numbers, includeBull },
    elimination: {
      target: elimTarget,
      inMode: elimRaw?.inMode === "double" ? "double" : "straight",
      outMode: elimRaw?.outMode === "straight" || elimRaw?.outMode === "master" ? elimRaw.outMode : "double",
      extreme: elimRaw?.extreme === true,
    },
    clock: {
      requireMode:
        raw.clock?.requireMode === "double" || raw.clock?.requireMode === "triple"
          ? raw.clock.requireMode
          : "any",
    },
    shanghai: { endNumber, shanghaiWins: raw.shanghai?.shanghaiWins !== false },
    teams: ((raw.teams ?? (raw as { clubs?: MatchConfig["teams"] }).clubs) ?? [])
      .filter((c) => c?.id && c?.name)
      .slice(0, 2)
      .map((c) => ({ id: c.id, name: c.name.trim() })),
    bullUpLastLeg: raw.bullUpLastLeg !== false,
  };
}

export function createMatch(config: MatchConfig): MatchState {
  const normalized = normalizeConfig(config);
  const n = normalized.players.length;
  return {
    id: newMatchId(),
    config: normalized,
    status: "playing",
    currentLeg: createLeg(normalized, normalized.firstThrowerIndex),
    matchVisits: [],
    legsWon: Array.from({ length: n }, () => 0),
    setsWon: Array.from({ length: n }, () => 0),
    currentSet: 1,
    currentLegInSet: 1,
    lastWinnerIndex: null,
    lastEvent: null,
    canUndo: false,
    matchLegsWon: Array.from({ length: n }, () => 0),
    legSeq: 1,
    legReports: [],
  };
}

function currentPlayerId(state: MatchState): string {
  return state.config.players[state.currentLeg.currentPlayerIndex]!.id;
}

function activeIndices(leg: LegState): number[] {
  return leg.players.map((p, i) => (p.eliminated ? -1 : i)).filter((i) => i >= 0);
}

function nextPlayerIndex(leg: LegState, from: number): number {
  const n = leg.players.length;
  for (let step = 1; step <= n; step++) {
    const i = (from + step) % n;
    if (!leg.players[i]!.eliminated) return i;
  }
  return from;
}

function beginVisit(leg: LegState): void {
  leg.currentVisit = [];
  leg.visitStartSnapshot = clone(leg.players);
  leg.bustMessage = null;
}

function restoreVisitStart(leg: LegState): void {
  leg.players = clone(leg.visitStartSnapshot);
}

function nextTurn(leg: LegState): void {
  leg.currentPlayerIndex = nextPlayerIndex(leg, leg.currentPlayerIndex);
  beginVisit(leg);
}

function newMatchId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function recordVisit(state: MatchState, visit: Visit): void {
  if (!state.matchVisits) state.matchVisits = [];
  visit.legSeq = state.legSeq ?? 1;
  const idx = state.config.players.findIndex((p) => p.id === visit.playerId);
  const start = idx >= 0 ? state.currentLeg.visitStartSnapshot[idx] : undefined;
  const game = state.config.gameType;
  if ((game === "x01" || game === "elimination") && start) {
    const remaining =
      game === "x01" ? start.remaining : state.config.elimination.target - start.remaining;
    const outMode = game === "x01" ? state.config.x01.outMode : state.config.elimination.outMode;
    if (remaining > 0 && canCheckout(remaining, outMode, 3)) visit.checkoutAttempt = true;
    if (visit.checkout) visit.finishScore = remaining;
  }
  state.currentLeg.visits.push(visit);
  state.matchVisits.push(visit);
}

function finishVisitAndRotate(state: MatchState, visit: Visit): void {
  recordVisit(state, visit);
  nextTurn(state.currentLeg);
}

export function hydrateMatch(raw: MatchState): MatchState {
  const config = raw?.config ? normalizeConfig(raw.config) : createDefaultConfig();
  const fallbackLeg = createLeg(config, config.firstThrowerIndex);
  const visits = Array.isArray(raw?.matchVisits)
    ? raw.matchVisits
    : [...(raw?.currentLeg?.visits ?? [])];
  const n = config.players.length;
  const status = raw?.status;
  return {
    ...raw,
    id: raw?.id || newMatchId(),
    config,
    status:
      status === "playing" ||
      status === "legOver" ||
      status === "setOver" ||
      status === "matchOver" ||
      status === "bullUp"
        ? status
        : "playing",
    matchVisits: visits,
    currentLeg: {
      ...fallbackLeg,
      ...(raw?.currentLeg ?? {}),
      knockedPlayerIds: raw?.currentLeg?.knockedPlayerIds ?? [],
      players:
        Array.isArray(raw?.currentLeg?.players) && raw.currentLeg.players.length === n
          ? raw.currentLeg.players
          : fallbackLeg.players,
      firstThrowerIndex: raw?.currentLeg?.firstThrowerIndex ?? fallbackLeg.firstThrowerIndex,
      currentPlayerIndex: raw?.currentLeg?.currentPlayerIndex ?? fallbackLeg.currentPlayerIndex,
    },
    matchLegsWon: raw?.matchLegsWon ?? Array.from({ length: n }, () => 0),
    legsWon: Array.isArray(raw?.legsWon) ? raw.legsWon : Array.from({ length: n }, () => 0),
    setsWon: Array.isArray(raw?.setsWon) ? raw.setsWon : Array.from({ length: n }, () => 0),
    legSeq: raw?.legSeq ?? 1,
    legReports: Array.isArray(raw?.legReports) ? raw.legReports : [],
  };
}

const undoStacks = new WeakMap<MatchState, MatchState[]>();

function pushUndo(from: MatchState, next: MatchState): MatchState {
  const stack = undoStacks.get(from) ?? [];
  const copy = clone(from);
  undoStacks.delete(from);
  const newStack = [...stack, copy].slice(-MAX_UNDO);
  undoStacks.set(next, newStack);
  next.canUndo = newStack.length > 0;
  return next;
}

function popUndo(state: MatchState): MatchState | null {
  const stack = undoStacks.get(state);
  if (!stack || stack.length === 0) return null;
  const prev = stack.pop()!;
  undoStacks.set(prev, stack);
  prev.canUndo = stack.length > 0;
  return prev;
}

function assertPlaying(state: MatchState): string | null {
  if (state.status !== "playing") return "Spiel ist nicht aktiv.";
  return null;
}

function assertTurn(state: MatchState, playerId: string): string | null {
  const playing = assertPlaying(state);
  if (playing) return playing;
  if (playerId !== currentPlayerId(state)) return "Nicht an der Reihe.";
  const p = state.currentLeg.players[state.currentLeg.currentPlayerIndex];
  if (p?.eliminated) return "Spieler ist ausgeschieden.";
  return null;
}

function applyX01Dart(state: MatchState, dart: DartThrow): ActionResult {
  const next = clone(state);
  const leg = next.currentLeg;
  const idx = leg.currentPlayerIndex;
  const player = leg.players[idx]!;
  const { outMode } = next.config.x01;

  if (leg.currentVisit.length === 0) {
    leg.visitStartSnapshot = clone(leg.players);
  }

  let scored = 0;
  if (!player.opened) {
    if (dart.multiplier === 2 && dart.segment > 0) {
      player.opened = true;
      scored = pointsOf(dart);
    } else {
      scored = 0;
    }
  } else {
    scored = pointsOf(dart);
  }

  const remainingAfter = player.remaining - scored;
  player.remaining = remainingAfter;
  leg.currentVisit.push(dart);
  next.lastEvent = null;

  const bust = (reason: string): ActionResult => {
    restoreVisitStart(leg);
    const visit: Visit = {
      playerId: next.config.players[idx]!.id,
      darts: [...leg.currentVisit],
      total: 0,
      kind: "darts",
      bust: true,
    };
    leg.bustMessage = reason;
    next.lastEvent = reason;
    finishVisitAndRotate(next, visit);
    return { ok: true, state: next };
  };

  if (!player.opened) {
    if (leg.currentVisit.length >= 3) {
      const visit: Visit = {
        playerId: next.config.players[idx]!.id,
        darts: [...leg.currentVisit],
        total: 0,
        kind: "darts",
      };
      finishVisitAndRotate(next, visit);
    }
    return { ok: true, state: next };
  }

  if (remainingAfter < 0) return bust("Bust – überworfen");
  if (remainingAfter === 0) {
    if (!isValidFinishDart(dart, outMode)) {
      return bust(outMode === "double" ? "Bust – kein Doppel-Out" : "Bust – kein gültiger Finish");
    }
    const visit: Visit = {
      playerId: next.config.players[idx]!.id,
      darts: [...leg.currentVisit],
      total: leg.visitStartSnapshot[idx]!.remaining,
      kind: "darts",
      checkout: true,
    };
    recordVisit(next, visit);
    return completeLeg(next, idx);
  }
  if (remainingAfter === 1 && outMode !== "straight") {
    return bust("Bust – Rest 1");
  }

  if (leg.currentVisit.length >= 3) {
    const total = leg.visitStartSnapshot[idx]!.remaining - player.remaining;
    const visit: Visit = {
      playerId: next.config.players[idx]!.id,
      darts: [...leg.currentVisit],
      total,
      kind: "darts",
    };
    finishVisitAndRotate(next, visit);
  }
  return { ok: true, state: next };
}

function applyX01Total(state: MatchState, total: number): ActionResult {
  const next = clone(state);
  const leg = next.currentLeg;
  const idx = leg.currentPlayerIndex;
  const player = leg.players[idx]!;
  const { inMode, outMode } = next.config.x01;
  const darts = dartsForTotal(total) ?? [
    { segment: 0, multiplier: 1 as const },
    { segment: 0, multiplier: 1 as const },
    { segment: 0, multiplier: 1 as const },
  ];

  if (!player.opened) {
    if (total === 0) {
      const visit: Visit = { playerId: next.config.players[idx]!.id, darts, total: 0, kind: "total" };
      finishVisitAndRotate(next, visit);
      return { ok: true, state: next };
    }
    if (inMode === "double") player.opened = true;
  }

  const remainingAfter = player.remaining - total;
  const bust = (reason: string): ActionResult => {
    const visit: Visit = {
      playerId: next.config.players[idx]!.id,
      darts,
      total: 0,
      kind: "total",
      bust: true,
    };
    leg.bustMessage = reason;
    next.lastEvent = reason;
    finishVisitAndRotate(next, visit);
    return { ok: true, state: next };
  };

  if (remainingAfter < 0) return bust("Bust – überworfen");
  if (remainingAfter === 0) {
    if (!canCheckout(player.remaining, outMode, 3)) {
      return bust(outMode === "double" ? "Bust – kein Doppel-Out" : "Bust – kein gültiger Finish");
    }
    player.remaining = 0;
    const visit: Visit = {
      playerId: next.config.players[idx]!.id,
      darts,
      total,
      kind: "total",
      checkout: true,
    };
    recordVisit(next, visit);
    return completeLeg(next, idx);
  }
  if (remainingAfter === 1 && outMode !== "straight") return bust("Bust – Rest 1");

  player.remaining = remainingAfter;
  const visit: Visit = { playerId: next.config.players[idx]!.id, darts, total, kind: "total" };
  finishVisitAndRotate(next, visit);
  return { ok: true, state: next };
}

function applyCricketDart(state: MatchState, dart: DartThrow): ActionResult {
  const next = clone(state);
  const leg = next.currentLeg;
  const idx = leg.currentPlayerIndex;
  const player = leg.players[idx]!;
  const targets = cricketNumbers(next.config.cricket);

  if (leg.currentVisit.length === 0) {
    leg.visitStartSnapshot = clone(leg.players);
  }

  const segment = dart.segment;
  const isTarget = targets.includes(segment);
  if (isTarget && dart.segment > 0) {
    let marksToAdd = dart.multiplier;
    if (segment === 25) marksToAdd = dart.multiplier === 2 ? 2 : 1;
    const key = String(segment);
    while (marksToAdd > 0) {
      const current = player.marks[key] ?? 0;
      if (current < 3) {
        player.marks[key] = current + 1;
      } else {
        const anyoneOpen = leg.players.some((p, i) => i !== idx && (p.marks[key] ?? 0) < 3);
        if (anyoneOpen) {
          player.cricketScore += segment;
        }
      }
      marksToAdd -= 1;
    }
  }

  leg.currentVisit.push(dart);

  if (cricketHasWon(player, leg.players, targets)) {
    const total = leg.currentVisit.reduce((s, d) => s + pointsOf(d), 0);
    const visit: Visit = {
      playerId: next.config.players[idx]!.id,
      darts: [...leg.currentVisit],
      total,
      kind: "darts",
      checkout: true,
    };
    recordVisit(next, visit);
    return completeLeg(next, idx);
  }

  if (leg.currentVisit.length >= 3) {
    const total = leg.currentVisit.reduce((s, d) => s + pointsOf(d), 0);
    const visit: Visit = {
      playerId: next.config.players[idx]!.id,
      darts: [...leg.currentVisit],
      total,
      kind: "darts",
    };
    finishVisitAndRotate(next, visit);
  }
  return { ok: true, state: next };
}

function cricketHasWon(player: PlayerLegState, all: PlayerLegState[], targets: number[]): boolean {
  const closed = targets.every((n) => (player.marks[String(n)] ?? 0) >= 3);
  if (!closed) return false;
  return all.every((p) => player.cricketScore >= p.cricketScore);
}

function clockHit(dart: DartThrow, target: number, requireMode: "any" | "double" | "triple"): boolean {
  if (target === 25) {
    if (requireMode === "double") return dart.segment === 25 && dart.multiplier === 2;
    return dart.segment === 25;
  }
  if (dart.segment !== target) return false;
  if (requireMode === "double") return dart.multiplier === 2;
  if (requireMode === "triple") return dart.multiplier === 3;
  return true;
}

function applyClockDart(state: MatchState, dart: DartThrow): ActionResult {
  const next = clone(state);
  const leg = next.currentLeg;
  const idx = leg.currentPlayerIndex;
  const player = leg.players[idx]!;
  const mode = next.config.clock.requireMode;

  if (leg.currentVisit.length === 0) {
    leg.visitStartSnapshot = clone(leg.players);
  }

  if (!player.clockFinished && clockHit(dart, player.nextTarget, mode)) {
    if (player.nextTarget === 25) {
      player.clockFinished = true;
      player.nextTarget = 26;
      leg.currentVisit.push(dart);
      const visit: Visit = {
        playerId: next.config.players[idx]!.id,
        darts: [...leg.currentVisit],
        total: 0,
        kind: "darts",
        checkout: true,
      };
      recordVisit(next, visit);
      return completeLeg(next, idx);
    }
    player.nextTarget += 1;
    if (player.nextTarget === 21) player.nextTarget = 25;
  }

  leg.currentVisit.push(dart);
  if (leg.currentVisit.length >= 3) {
    const visit: Visit = {
      playerId: next.config.players[idx]!.id,
      darts: [...leg.currentVisit],
      total: 0,
      kind: "darts",
    };
    finishVisitAndRotate(next, visit);
  }
  return { ok: true, state: next };
}

function sequentialShanghai(
  startTarget: number,
  darts: DartThrow[],
): { single: boolean; double: boolean; triple: boolean; score: number; shanghai: boolean } {
  let target = startTarget;
  let single = false;
  let dbl = false;
  let triple = false;
  let score = 0;
  for (const d of darts) {
    if (d.segment !== target || d.segment <= 0) continue;
    score += target * d.multiplier;
    if (d.multiplier === 1) single = true;
    if (d.multiplier === 2) dbl = true;
    if (d.multiplier === 3) triple = true;
    target += 1;
  }
  return { single, double: dbl, triple, score, shanghai: single && dbl && triple };
}

function applyShanghaiDart(state: MatchState, dart: DartThrow): ActionResult {
  const next = clone(state);
  const leg = next.currentLeg;
  const idx = leg.currentPlayerIndex;
  const player = leg.players[idx]!;

  if (leg.currentVisit.length === 0) {
    leg.visitStartSnapshot = clone(leg.players);
  }

  if (dart.segment === player.nextTarget && dart.segment > 0) {
    player.shanghaiScore += player.nextTarget * dart.multiplier;
    player.nextTarget += 1;
  }
  leg.currentVisit.push(dart);
  next.lastEvent = null;

  const startTarget = leg.visitStartSnapshot[idx]!.nextTarget;
  const hits = sequentialShanghai(startTarget, leg.currentVisit);

  if (hits.shanghai && next.config.shanghai.shanghaiWins) {
    const visit: Visit = {
      playerId: next.config.players[idx]!.id,
      darts: [...leg.currentVisit],
      total: hits.score,
      kind: "darts",
      shanghai: true,
      checkout: true,
    };
    recordVisit(next, visit);
    next.lastEvent = "Shanghai!";
    return completeLeg(next, idx);
  }

  if (leg.currentVisit.length >= 3) {
    return completeShanghaiVisit(next, idx, hits.score, hits.shanghai);
  }
  return { ok: true, state: next };
}

function completeShanghaiVisit(
  next: MatchState,
  idx: number,
  visitScore: number,
  isShanghai: boolean,
): ActionResult {
  const leg = next.currentLeg;
  const round = leg.shanghaiRound;
  const visit: Visit = {
    playerId: next.config.players[idx]!.id,
    darts: [...leg.currentVisit],
    total: visitScore,
    kind: "darts",
    shanghai: isShanghai,
  };

  recordVisit(next, visit);
  leg.roundVisits += 1;
  const active = activeIndices(leg).length;
  if (leg.roundVisits >= active) {
    if (round >= next.config.shanghai.endNumber) {
      return finishShanghaiGame(next);
    }
    leg.shanghaiRound = round + 1;
    leg.roundVisits = 0;
    nextTurn(leg);
    return { ok: true, state: next };
  }
  nextTurn(leg);
  return { ok: true, state: next };
}

function finishShanghaiGame(state: MatchState): ActionResult {
  const scores = state.currentLeg.players.map((p) => p.shanghaiScore);
  const max = Math.max(...scores);
  const winners = scores.map((s, i) => (s === max ? i : -1)).filter((i) => i >= 0);
  if (winners.length === 1) {
    return completeLeg(state, winners[0]!);
  }
  state.currentLeg.shanghaiRound += 1;
  state.currentLeg.roundVisits = 0;
  state.lastEvent = `Gleichstand – weiter bis jemand führt (Runde ${state.currentLeg.shanghaiRound})`;
  nextTurn(state.currentLeg);
  return { ok: true, state };
}

function playerNamesForIds(state: MatchState, ids: string[]): string[] {
  return ids.map((id) => state.config.players.find((p) => p.id === id)?.name).filter((n): n is string => Boolean(n));
}

function applyKnockOff(state: MatchState, throwerIdx: number): string[] {
  const leg = state.currentLeg;
  const score = leg.players[throwerIdx]!.remaining;
  const ids: string[] = [];
  if (score <= 0) return ids;
  const openedAfterReset = state.config.elimination.inMode === "straight";
  for (let i = 0; i < leg.players.length; i++) {
    if (i === throwerIdx) continue;
    const other = leg.players[i]!;
    if (other.remaining !== score) continue;
    other.remaining = 0;
    other.opened = openedAfterReset;
    ids.push(state.config.players[i]!.id);
  }
  return ids;
}

function finishEliminationVisit(
  next: MatchState,
  idx: number,
  opts: { bust?: boolean; checkout?: boolean },
): ActionResult {
  const leg = next.currentLeg;
  const darts = [...leg.currentVisit];
  const total = opts.bust ? 0 : darts.reduce((sum, dart) => sum + pointsOf(dart), 0);
  const visit: Visit = {
    playerId: next.config.players[idx]!.id,
    darts,
    total,
    kind: "darts",
    bust: opts.bust,
    checkout: opts.checkout,
    knocked: (leg.knockedPlayerIds?.length ?? 0) > 0,
  };
  if (opts.checkout) {
    recordVisit(next, visit);
    return completeLeg(next, idx);
  }
  finishVisitAndRotate(next, visit);
  return { ok: true, state: next };
}

function applyEliminationDart(state: MatchState, dart: DartThrow): ActionResult {
  const next = clone(state);
  const leg = next.currentLeg;
  const idx = leg.currentPlayerIndex;
  const player = leg.players[idx]!;
  const { outMode, target, extreme } = next.config.elimination;

  if (leg.currentVisit.length === 0) {
    leg.visitStartSnapshot = clone(leg.players);
  }
  leg.knockedPlayerIds = [];
  next.lastEvent = null;

  if (!player.opened) {
    if (dart.multiplier === 2 && dart.segment > 0) {
      player.opened = true;
      player.remaining += pointsOf(dart);
    }
  } else {
    player.remaining += pointsOf(dart);
  }
  const projected = player.remaining;
  leg.currentVisit.push(dart);

  const bust = (reason: string): ActionResult => {
    restoreVisitStart(leg);
    leg.knockedPlayerIds = [];
    leg.bustMessage = reason;
    next.lastEvent = reason;
    return finishEliminationVisit(next, idx, { bust: true });
  };

  if (!player.opened) {
    if (leg.currentVisit.length >= 3) return finishEliminationVisit(next, idx, {});
    return { ok: true, state: next };
  }

  if (projected > target) {
    if (extreme) {
      const adjusted = Math.max(0, 2 * target - projected);
      player.remaining = adjusted;
      const knocked = applyKnockOff(next, idx);
      leg.knockedPlayerIds = knocked;
      const names = playerNamesForIds(next, knocked);
      const over = `Überhang – Score ${adjusted}`;
      next.lastEvent = names.length ? `${over}. ${names.join(", ")} auf 0` : over;
      leg.bustMessage = over;
      return finishEliminationVisit(next, idx, {});
    }
    return bust("Bust – überworfen");
  }

  if (projected === target) {
    if (!isValidFinishDart(dart, outMode)) {
      return bust(outMode === "double" ? "Bust – kein Doppel-Out" : "Bust – kein gültiger Finish");
    }
    return finishEliminationVisit(next, idx, { checkout: true });
  }

  if (target - projected === 1 && outMode !== "straight") {
    return bust("Bust – Rest 1");
  }

  const knocked = applyKnockOff(next, idx);
  leg.knockedPlayerIds = knocked;
  if (knocked.length) {
    const names = playerNamesForIds(next, knocked);
    next.lastEvent = `${next.config.players[idx]!.name} setzt ${names.join(" und ")} auf 0`;
  }

  if (leg.currentVisit.length >= 3) return finishEliminationVisit(next, idx, {});
  return { ok: true, state: next };
}

function completeLeg(state: MatchState, winnerIndex: number): ActionResult {
  const next = state;
  next.currentLeg.winnerIndex = winnerIndex;
  next.lastWinnerIndex = winnerIndex;
  next.legsWon[winnerIndex] = (next.legsWon[winnerIndex] ?? 0) + 1;
  if (!next.matchLegsWon || next.matchLegsWon.length !== next.config.players.length) {
    next.matchLegsWon = Array.from({ length: next.config.players.length }, () => 0);
  }
  next.matchLegsWon[winnerIndex] = (next.matchLegsWon[winnerIndex] ?? 0) + 1;
  if (!next.legReports) next.legReports = [];
  next.legReports = [...next.legReports, snapshotCompletedLeg(next, winnerIndex)];
  const name = next.config.players[winnerIndex]!.name;
  next.lastEvent = `${name} gewinnt das Leg`;

  if ((next.legsWon[winnerIndex] ?? 0) >= next.config.legsToWinSet) {
    next.setsWon[winnerIndex] = (next.setsWon[winnerIndex] ?? 0) + 1;
    if ((next.setsWon[winnerIndex] ?? 0) >= next.config.setsToWin) {
      next.status = "matchOver";
      next.lastEvent = `${name} gewinnt das Match`;
      return { ok: true, state: next };
    }
    next.status = "setOver";
    next.lastEvent = `${name} gewinnt den Satz`;
    return { ok: true, state: next };
  }
  next.status = "legOver";
  return { ok: true, state: next };
}

function shouldBullUpNext(state: MatchState): boolean {
  if (state.config.bullUpLastLeg === false) return false;
  const need = Math.max(1, state.config.legsToWinSet);
  if (need < 2) return false;
  const oneAway = (state.legsWon ?? []).filter((n) => n >= need - 1).length;
  return oneAway >= 2;
}

/** True while the deciding last leg is waiting for / was started via Ausbullen. */
export function isBullUpDecidingLeg(state: MatchState): boolean {
  return shouldBullUpNext(state);
}

function resetOpenVisit(leg: LegState): void {
  restoreVisitStart(leg);
  beginVisit(leg);
  leg.knockedPlayerIds = [];
}

function startNextLeg(state: MatchState): MatchState {
  const n = state.config.players.length;
  const prevFirst = state.currentLeg.firstThrowerIndex ?? 0;
  const nextFirst = (prevFirst + 1) % n;
  const resetLegs = state.status === "setOver";
  const next = clone(state);
  if (resetLegs) {
    next.legsWon = Array.from({ length: n }, () => 0);
    next.currentSet += 1;
    next.currentLegInSet = 1;
  } else {
    next.currentLegInSet += 1;
  }
  next.currentLeg = createLeg(next.config, nextFirst);
  next.legSeq = (next.legSeq ?? 1) + 1;
  next.status = "playing";
  next.lastEvent = null;
  return next;
}

function applyThrow(state: MatchState, dart: DartThrow): ActionResult {
  if (!isValidDart(dart)) return { ok: false, error: "Ungültiger Wurf.", state };
  if (state.currentLeg.currentVisit.length >= 3) {
    return { ok: false, error: "Aufnahme ist voll.", state };
  }
  switch (state.config.gameType) {
    case "x01":
      return applyX01Dart(state, dart);
    case "cricket":
      return applyCricketDart(state, dart);
    case "elimination":
      return applyEliminationDart(state, dart);
    case "clock":
      return applyClockDart(state, dart);
    case "shanghai":
      return applyShanghaiDart(state, dart);
  }
}

function applyTotal(state: MatchState, total: number): ActionResult {
  if (!isPossibleVisitTotal(total)) {
    return { ok: false, error: "Unmögliche 3-Dart-Summe.", state };
  }
  const game = state.config.gameType;
  if (game === "cricket" || game === "clock" || game === "shanghai" || game === "elimination") {
    return { ok: false, error: "Gesamteingabe ist in diesem Spiel nicht möglich.", state };
  }
  if (state.currentLeg.currentVisit.length > 0) {
    return { ok: false, error: "Aufnahme läuft bereits – zuerst bestätigen oder rückgängig.", state };
  }
  if (game === "x01") return applyX01Total(state, total);
  return { ok: false, error: "Gesamteingabe ist in diesem Spiel nicht möglich.", state };
}

function applyConfirm(state: MatchState): ActionResult {
  const visit = state.currentLeg.currentVisit;
  if (visit.length === 0) return { ok: false, error: "Keine Darts eingegeben.", state };
  const miss: DartThrow = { segment: 0, multiplier: 1 };
  let current: ActionResult = { ok: true, state };
  while (
    current.ok &&
    current.state.status === "playing" &&
    current.state.currentLeg.currentVisit.length > 0 &&
    current.state.currentLeg.currentVisit.length < 3
  ) {
    current = applyThrow(current.state, miss);
  }
  return current;
}

export function applyAction(state: MatchState, action: ClientAction): ActionResult {
  if (action.type === "UNDO") {
    const prev = popUndo(state);
    if (!prev) return { ok: false, error: "Nichts rückgängig zu machen.", state };
    return { ok: true, state: prev };
  }

  if (action.type === "SET_INPUT_MODE") {
    const next = clone(state);
    const game = next.config.gameType;
    if (game === "cricket" || game === "clock" || game === "shanghai" || game === "elimination") {
      next.config.inputMode = "single";
    } else {
      next.config.inputMode = action.mode;
    }
    const stack = undoStacks.get(state) ?? [];
    undoStacks.set(next, stack);
    next.canUndo = stack.length > 0;
    return { ok: true, state: next };
  }

  if (action.type === "ACKNOWLEDGE") {
    if (state.status === "matchOver") {
      return { ok: false, error: "Match ist beendet.", state };
    }
    if (state.status !== "legOver" && state.status !== "setOver") {
      return { ok: false, error: "Kein Abschluss zum Bestätigen.", state };
    }
    const bullUp = state.status === "legOver" && shouldBullUpNext(state);
    const next = startNextLeg(state);
    if (bullUp) next.status = "bullUp";
    return { ok: true, state: next };
  }

  if (action.type === "REOPEN_BULL_UP") {
    if (state.status !== "playing") {
      return { ok: false, error: "Ausbullen kann jetzt nicht geändert werden.", state };
    }
    if (!shouldBullUpNext(state)) {
      return { ok: false, error: "Kein Ausbullen in diesem Leg.", state };
    }
    if ((state.currentLeg.visits ?? []).length > 0) {
      return { ok: false, error: "Erst Aufnahme zurücknehmen.", state };
    }
    const next = clone(state);
    resetOpenVisit(next.currentLeg);
    next.status = "bullUp";
    next.lastEvent = null;
    undoStacks.set(next, []);
    next.canUndo = false;
    return { ok: true, state: next };
  }

  if (action.type === "SET_LEG_STARTER") {
    if (state.status !== "bullUp") {
      return { ok: false, error: "Kein Ausbullen aktiv.", state };
    }
    const n = Math.max(1, state.config.players.length);
    const idx = Math.min(Math.max(0, Math.round(action.playerIndex)), n - 1);
    const next = clone(state);
    resetOpenVisit(next.currentLeg);
    next.currentLeg.firstThrowerIndex = idx;
    next.currentLeg.currentPlayerIndex = idx;
    next.status = "playing";
    next.lastEvent = null;
    undoStacks.set(next, []);
    next.canUndo = false;
    return { ok: true, state: next };
  }

  if (action.type === "REMATCH") {
    const next = createMatch(state.config);
    return { ok: true, state: next };
  }

  const err =
    action.type === "THROW_DART" || action.type === "SET_VISIT_TOTAL" || action.type === "CONFIRM_VISIT"
      ? assertTurn(state, action.playerId)
      : null;
  if (err) return { ok: false, error: err, state };

  let result: ActionResult;
  if (action.type === "THROW_DART") result = applyThrow(state, action.dart);
  else if (action.type === "SET_VISIT_TOTAL") result = applyTotal(state, action.total);
  else result = applyConfirm(state);

  if (!result.ok) return result;
  return { ok: true, state: pushUndo(state, result.state) };
}

export function currentVisitTotal(leg: LegState): number {
  return leg.currentVisit.reduce((s, d) => s + pointsOf(d), 0);
}

export function remainingPreview(state: MatchState): number | null {
  const idx = state.currentLeg.currentPlayerIndex;
  if (state.config.gameType === "x01") {
    return state.currentLeg.players[idx]!.remaining;
  }
  if (state.config.gameType === "elimination") {
    const player = state.currentLeg.players[idx]!;
    if (!player.opened) return null;
    return state.config.elimination.target - player.remaining;
  }
  return null;
}

export function hintForState(state: MatchState): string | null {
  const outMode =
    state.config.gameType === "x01"
      ? state.config.x01.outMode
      : state.config.gameType === "elimination"
        ? state.config.elimination.outMode
        : null;
  if (!outMode || outMode === "straight") return null;
  const remaining = remainingPreview(state);
  if (remaining == null) return null;
  const dartsLeft = 3 - state.currentLeg.currentVisit.length;
  return checkoutHint(remaining, outMode, Math.max(1, dartsLeft));
}

export function lastVisitForPlayer(state: MatchState, playerId: string): Visit | undefined {
  const visits = state.currentLeg.visits;
  for (let i = visits.length - 1; i >= 0; i--) {
    if (visits[i]!.playerId === playerId) return visits[i];
  }
  return undefined;
}

/** Current visit-round of the leg (1-based). Shanghai uses the number being thrown. */
export function currentLegRound(state: MatchState): number {
  if (state.config.gameType === "shanghai") {
    return Math.max(1, state.currentLeg.shanghaiRound || 1);
  }
  const n = Math.max(1, state.config.players.length);
  return Math.floor((state.currentLeg.visits?.length ?? 0) / n) + 1;
}

export { cricketNumbers };
