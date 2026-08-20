import { ALL_DARTS, formatDart, pointsOf, SCORING_DARTS } from "./darts.js";
import type { DartThrow, OutMode } from "./types.js";

const DOUBLES: DartThrow[] = [
  ...Array.from({ length: 20 }, (_, i) => ({
    segment: i + 1,
    multiplier: 2 as const,
  })),
  { segment: 25, multiplier: 2 },
];

const MASTERS: DartThrow[] = [
  ...DOUBLES,
  ...Array.from({ length: 20 }, (_, i) => ({
    segment: i + 1,
    multiplier: 3 as const,
  })),
];

const PREFERRED = SCORING_DARTS.slice().sort((a, b) => {
  const pa = pointsOf(a);
  const pb = pointsOf(b);
  if (pb !== pa) return pb - pa;
  return b.multiplier - a.multiplier;
});

function lastDarts(outMode: OutMode): DartThrow[] {
  if (outMode === "straight") return SCORING_DARTS;
  if (outMode === "double") return DOUBLES;
  return MASTERS;
}

export function findCheckout(
  remaining: number,
  outMode: OutMode,
  maxDarts = 3,
): DartThrow[] | null {
  if (remaining <= 0 || remaining > 170) return null;
  if (outMode !== "straight" && remaining === 1) return null;

  const finishers = lastDarts(outMode);

  if (maxDarts >= 1) {
    for (const d of finishers) {
      if (pointsOf(d) === remaining) return [d];
    }
  }

  if (maxDarts >= 2) {
    for (const a of PREFERRED) {
      const rest = remaining - pointsOf(a);
      if (rest <= 0) continue;
      for (const d of finishers) {
        if (pointsOf(d) === rest) return [a, d];
      }
    }
  }

  if (maxDarts >= 3) {
    for (const a of PREFERRED) {
      for (const b of PREFERRED) {
        const rest = remaining - pointsOf(a) - pointsOf(b);
        if (rest <= 0) continue;
        for (const d of finishers) {
          if (pointsOf(d) === rest) return [a, b, d];
        }
      }
    }
  }

  return null;
}

export function canCheckout(remaining: number, outMode: OutMode, maxDarts = 3): boolean {
  if (outMode === "straight") {
    if (remaining <= 0 || remaining > 180) return false;
    if (maxDarts >= 3) {
      return ALL_DARTS.some((a) =>
        ALL_DARTS.some((b) =>
          ALL_DARTS.some((c) => pointsOf(a) + pointsOf(b) + pointsOf(c) === remaining),
        ),
      );
    }
  }
  return findCheckout(remaining, outMode, maxDarts) !== null;
}

export function checkoutHint(
  remaining: number,
  outMode: OutMode,
  dartsLeft: number,
): string | null {
  if (outMode === "straight") return null;
  if (remaining > 170 || remaining <= 1) return null;
  const path = findCheckout(remaining, outMode, dartsLeft);
  if (!path) return remaining > 40 ? null : "Kein Checkout";
  return path.map(formatDart).join("  ");
}

export function isValidFinishDart(dart: DartThrow, outMode: OutMode): boolean {
  if (outMode === "straight") return dart.segment > 0;
  if (outMode === "double") return dart.multiplier === 2 && dart.segment > 0;
  return (dart.multiplier === 2 || dart.multiplier === 3) && dart.segment > 0;
}
