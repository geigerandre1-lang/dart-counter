import {
  formatAverage,
  formatCheckoutCell,
  formatLegDartsCell,
  formatLegNumberCell,
  LEG_REPORT_TABLE_HEADERS,
  reportPlayerLabel,
  runningEndstand,
  type LegReportView,
  type Player,
} from "@shared/index";

export interface MatchReportTableProps {
  headline: string;
  endstand: string;
  players: Player[];
  legs: LegReportView[];
  meta?: string;
  compact?: boolean;
}

export default function MatchReportTable({
  headline,
  endstand,
  players,
  legs,
  meta,
  compact,
}: MatchReportTableProps) {
  const scores = runningEndstand(legs, players);

  return (
    <div className={compact ? "" : "mt-3"}>
      <div className="font-display text-xl leading-tight text-white sm:text-2xl">{headline}</div>
      <div className="mt-1 font-bold text-amber-glow">Endstand {endstand || "–"}</div>
      {meta ? <div className="mt-1 text-xs text-slate-400">{meta}</div> : null}

      <div className="mt-3 -mx-1 overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
          <thead>
            <tr className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500">
              {LEG_REPORT_TABLE_HEADERS.map((label) => (
                <th
                  key={label}
                  className={`whitespace-nowrap border-b border-white/10 px-2 py-2 ${
                    label === "Beginner des Legs" ? "text-white" : ""
                  }`}
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {legs.length === 0 && (
              <tr>
                <td colSpan={LEG_REPORT_TABLE_HEADERS.length} className="px-2 py-3 text-slate-500">
                  Keine Leg-Daten.
                </td>
              </tr>
            )}
            {legs.map((leg, i) => (
              <tr key={`${leg.legNumber}-${i}`} className="text-slate-200">
                <td className="whitespace-nowrap border-b border-white/10 px-2 py-2 tabular-nums">
                  {formatLegNumberCell(leg)}
                </td>
                <td className="border-b border-white/10 px-2 py-2">{leg.winnerName}</td>
                <td className="border-b border-white/10 px-2 py-2 font-bold text-white">
                  {reportPlayerLabel(players, leg.starterId ?? "", leg.starterName)}
                </td>
                <td className="whitespace-nowrap border-b border-white/10 px-2 py-2">
                  {leg.opponentRemainingLabel || "–"}
                </td>
                <td className="border-b border-white/10 px-2 py-2">{formatLegDartsCell(leg, players)}</td>
                <td className="whitespace-nowrap border-b border-white/10 px-2 py-2">
                  {formatCheckoutCell(leg.checkout)}
                </td>
                <td className="whitespace-nowrap border-b border-white/10 px-2 py-2 tabular-nums">
                  {formatAverage(leg.winnerAverage)}
                </td>
                <td className="whitespace-nowrap border-b border-white/10 px-2 py-2 font-semibold tabular-nums text-amber-glow">
                  {scores[i] || "–"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
