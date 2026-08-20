import type { DartThrow } from "./types.js";

export function pointsOf(dart: DartThrow): number {
  if (dart.segment === 0) return 0;
  return dart.segment * dart.multiplier;
}

export function isInnerBull(dart: DartThrow): boolean {
  return dart.segment === 25 && dart.multiplier === 2;
}

export function isOuterBull(dart: DartThrow): boolean {
  return dart.segment === 25 && dart.multiplier === 1;
}

export function isDouble(dart: DartThrow): boolean {
  return dart.multiplier === 2 && dart.segment > 0;
}

export function isTriple(dart: DartThrow): boolean {
  return dart.multiplier === 3 && dart.segment > 0 && dart.segment <= 20;
}

export function isValidDart(dart: DartThrow): boolean {
  if (dart.segment === 0) return dart.multiplier === 1;
  if (dart.segment === 25) return dart.multiplier === 1 || dart.multiplier === 2;
  if (dart.segment >= 1 && dart.segment <= 20) {
    return dart.multiplier === 1 || dart.multiplier === 2 || dart.multiplier === 3;
  }
  return false;
}

export function formatDart(dart: DartThrow): string {
  if (dart.segment === 0) return "Daneben";
  if (dart.segment === 25) return dart.multiplier === 2 ? "DBull" : "Bull";
  if (dart.multiplier === 2) return `D${dart.segment}`;
  if (dart.multiplier === 3) return `T${dart.segment}`;
  return `S${dart.segment}`;
}

export function formatVisit(darts: DartThrow[]): string {
  return darts.map(formatDart).join("  ");
}

export const ALL_DARTS: DartThrow[] = (() => {
  const darts: DartThrow[] = [{ segment: 0, multiplier: 1 }];
  for (let s = 1; s <= 20; s++) {
    darts.push({ segment: s, multiplier: 1 });
    darts.push({ segment: s, multiplier: 2 });
    darts.push({ segment: s, multiplier: 3 });
  }
  darts.push({ segment: 25, multiplier: 1 });
  darts.push({ segment: 25, multiplier: 2 });
  return darts;
})();

export const SCORING_DARTS: DartThrow[] = ALL_DARTS.filter((d) => d.segment !== 0);

function uniquePoints(): number[] {
  const set = new Set<number>();
  for (const d of ALL_DARTS) set.add(pointsOf(d));
  return [...set].sort((a, b) => a - b);
}

const DART_POINTS = uniquePoints();

export const POSSIBLE_VISIT_TOTALS: ReadonlySet<number> = (() => {
  const totals = new Set<number>();
  for (const a of DART_POINTS) {
    for (const b of DART_POINTS) {
      for (const c of DART_POINTS) {
        totals.add(a + b + c);
      }
    }
  }
  return totals;
})();

export const IMPOSSIBLE_HIGH_TOTALS = [163, 166, 169, 172, 173, 175, 176, 178, 179] as const;

export function isPossibleVisitTotal(total: number): boolean {
  if (!Number.isInteger(total) || total < 0 || total > 180) return false;
  return POSSIBLE_VISIT_TOTALS.has(total);
}

export function dartsForTotal(total: number): DartThrow[] | null {
  if (!isPossibleVisitTotal(total)) return null;
  const scoring = ALL_DARTS.slice().sort((a, b) => pointsOf(b) - pointsOf(a));
  for (const a of scoring) {
    const pa = pointsOf(a);
    if (pa > total) continue;
    for (const b of scoring) {
      const pb = pointsOf(b);
      if (pa + pb > total) continue;
      const rest = total - pa - pb;
      const c = scoring.find((d) => pointsOf(d) === rest);
      if (c) return [a, b, c];
    }
  }
  return null;
}

export function cricketTargets(numbers: number[], includeBull: boolean): number[] {
  const targets = [...numbers].filter((n) => n >= 1 && n <= 20);
  const unique = [...new Set(targets)].sort((a, b) => b - a);
  if (includeBull) unique.push(25);
  return unique;
}

export function randomCricketSet(includeBull = Math.random() < 0.7): {
  numbers: number[];
  includeBull: boolean;
} {
  const pool = Array.from({ length: 20 }, (_, i) => i + 1);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const a = pool[i]!;
    pool[i] = pool[j]!;
    pool[j] = a;
  }
  return { numbers: pool.slice(0, 6).sort((a, b) => b - a), includeBull };
}

export function defaultConfigPlayers(count: number): { id: string; name: string }[] {
  const n = Math.min(8, Math.max(1, count));
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    name: `Spieler ${i + 1}`,
  }));
}
