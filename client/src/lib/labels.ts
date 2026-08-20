import type { GameType, InMode, OutMode } from "@shared/index";

export const GAME_LABELS: Record<GameType, string> = {
  x01: "x01",
  cricket: "Cricket",
  elimination: "Elimination",
  clock: "Around the Clock",
  shanghai: "Shanghai",
};

export const GAME_BLURBS: Record<GameType, string> = {
  x01: "Klassiker: 301 bis 901, Double-In/Out, Master-Out.",
  cricket: "15–20 + Bull, oder eigene / zufällige Zahlen.",
  elimination: "Von 0 hochzählen bis x01. Gleicher Score setzt den Gegner auf 0.",
  clock: "1 bis 20, dann Bull. Optional nur Doppel oder Triple.",
  shanghai: "Immer die nächste Zahl. S+D+T in einer Aufnahme gewinnt sofort.",
};

export const IN_LABELS: Record<InMode, string> = {
  straight: "Straight In",
  double: "Double In",
};

export const OUT_LABELS: Record<OutMode, string> = {
  straight: "Straight Out",
  double: "Double Out",
  master: "Master Out",
};

export function marksGlyph(count: number): string {
  if (count <= 0) return "···";
  if (count === 1) return "/··";
  if (count === 2) return "X·";
  return "⊗";
}
