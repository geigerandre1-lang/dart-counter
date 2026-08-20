import { emptyVisitStats, formatAverage, formatPercent, type PlayerVisitStats } from "@shared/index";

export default function StatGrid({ stats }: { stats: Partial<PlayerVisitStats> | undefined }) {
  const s = { ...emptyVisitStats(), ...stats };
  return (
    <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-sm sm:grid-cols-4">
      <div>
        Average <span className="font-bold text-amber-glow">{formatAverage(s.average)}</span>
      </div>
      <div>
        First-3 <span className="font-bold">{formatAverage(s.first3Average)}</span>
      </div>
      <div>
        First-9 <span className="font-bold">{formatAverage(s.first9Average)}</span>
      </div>
      <div>
        Darts <span className="font-bold">{s.dartsThrown}</span>
      </div>
      <div>
        Spiele <span className="font-bold">{s.matchesWon}:{s.matchesLost}</span>
      </div>
      <div>
        Legs <span className="font-bold">{s.legsWon}:{s.legsLost}</span>
      </div>
      <div>
        Höchste Aufnahme <span className="font-bold">{s.highestVisit || "–"}</span>
      </div>
      <div>
        Höchstes Finish <span className="font-bold">{s.highestFinish || "–"}</span>
      </div>
      <div>
        Checkout % <span className="font-bold">{formatPercent(s.checkoutPercent)}</span>
      </div>
      <div>
        26er <span className="font-bold">{s.score26}</span>
      </div>
      <div>
        180 <span className="font-bold text-amber-glow">{s.score180}</span>
      </div>
      <div>
        Daneben <span className="font-bold">{s.misses}</span>
      </div>
    </div>
  );
}
