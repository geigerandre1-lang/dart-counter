export type GameType = "x01" | "cricket" | "elimination" | "clock" | "shanghai";

export type InputMode = "single" | "total";

export type InMode = "straight" | "double";
export type OutMode = "straight" | "double" | "master";
export type ClockRequire = "any" | "double" | "triple";

export interface DartThrow {
  segment: number;
  multiplier: 1 | 2 | 3;
}

export interface Player {
  id: string;
  name: string;
  teamId?: string | null;
  teamName?: string | null;
  /** @deprecated flattened; kept for old persisted matches/reports */
  clubId?: string | null;
  /** @deprecated flattened; kept for old persisted matches/reports */
  clubName?: string | null;
  /** Registry / Spielbericht only — never copied onto the live match snapshot. */
  passNr?: string | null;
}

export interface TeamRef {
  id: string;
  name: string;
}

/** @deprecated use TeamRef */
export type ClubRef = TeamRef;

export interface X01Options {
  startScore: number;
  inMode: InMode;
  outMode: OutMode;
}

export interface CricketOptions {
  numbers: number[];
  includeBull: boolean;
}

export interface EliminationOptions {
  target: number;
  inMode: InMode;
  outMode: OutMode;
  extreme: boolean;
}

export interface ClockOptions {
  requireMode: ClockRequire;
}

export interface ShanghaiOptions {
  endNumber: number;
  shanghaiWins: boolean;
}

export interface MatchConfig {
  gameType: GameType;
  players: Player[];
  firstThrowerIndex: number;
  legsToWinSet: number;
  setsToWin: number;
  inputMode: InputMode;
  x01: X01Options;
  cricket: CricketOptions;
  elimination: EliminationOptions;
  clock: ClockOptions;
  shanghai: ShanghaiOptions;
  /** 0–2 Teams for a casual or Wettkampf match. */
  teams: TeamRef[];
  /** Pause before the deciding last leg so the beginner can be chosen (ausbullen). Default on. */
  bullUpLastLeg: boolean;
}

export interface Visit {
  playerId: string;
  darts: DartThrow[];
  total: number;
  kind: "darts" | "total";
  bust?: boolean;
  checkout?: boolean;
  shanghai?: boolean;
  lifeLost?: boolean;
  knocked?: boolean;
  /** 1-based leg sequence across the match (for First-3 / First-9). */
  legSeq?: number;
  checkoutAttempt?: boolean;
  /** Checkout value when this visit finished a leg (x01 / elimination). */
  finishScore?: number;
}

export interface PlayerLegState {
  remaining: number;
  opened: boolean;
  marks: Record<string, number>;
  cricketScore: number;
  lives: number;
  eliminated: boolean;
  nextTarget: number;
  shanghaiScore: number;
  clockFinished: boolean;
}

export type MatchStatus = "playing" | "legOver" | "setOver" | "matchOver" | "bullUp";

export interface LegState {
  firstThrowerIndex: number;
  currentPlayerIndex: number;
  players: PlayerLegState[];
  currentVisit: DartThrow[];
  visitStartSnapshot: PlayerLegState[];
  visits: Visit[];
  winnerIndex: number | null;
  bustMessage: string | null;
  eliminationTarget: number | null;
  /** Player ids reset to 0 by the latest elimination dart. */
  knockedPlayerIds: string[];
  shanghaiRound: number;
  roundVisits: number;
}

export interface LegReport {
  legNumber: number;
  setNumber: number;
  winnerId: string;
  winnerName: string;
  starterId: string;
  starterName: string;
  /** x01 remaining of the (first) opponent; null when not applicable. */
  opponentRemaining: number | null;
  opponentRemainingLabel: string;
  winnerDarts: number;
  playerDarts: Record<string, number>;
  playerAverages: Record<string, number>;
  checkout: number | null;
  winnerAverage: number;
}

export interface MatchState {
  /** Server-generated id; used to persist match analysis exactly once. */
  id: string;
  config: MatchConfig;
  status: MatchStatus;
  currentLeg: LegState;
  /** Completed visits across all legs (for Spielanalyse / Average). */
  matchVisits: Visit[];
  legsWon: number[];
  setsWon: number[];
  currentSet: number;
  currentLegInSet: number;
  lastWinnerIndex: number | null;
  lastEvent: string | null;
  canUndo: boolean;
  /** Legs won across the whole match (not reset between sets). */
  matchLegsWon: number[];
  /** Increments with each new leg. */
  legSeq: number;
  /** Snapshot of each completed leg (written on LEG_WIN / set / match win). */
  legReports: LegReport[];
}

export type ClientAction =
  | { type: "THROW_DART"; playerId: string; dart: DartThrow }
  | { type: "SET_VISIT_TOTAL"; playerId: string; total: number }
  | { type: "CONFIRM_VISIT"; playerId: string }
  | { type: "UNDO" }
  | { type: "ACKNOWLEDGE" }
  | { type: "REMATCH" }
  | { type: "SET_INPUT_MODE"; mode: InputMode }
  | { type: "SET_LEG_STARTER"; playerIndex: number }
  | { type: "REOPEN_BULL_UP" };

export type ActionResult =
  | { ok: true; state: MatchState }
  | { ok: false; error: string; state: MatchState };

export const STANDARD_CRICKET_NUMBERS = [20, 19, 18, 17, 16, 15] as const;

export const X01_PRESETS = [301, 501, 701, 901] as const;
