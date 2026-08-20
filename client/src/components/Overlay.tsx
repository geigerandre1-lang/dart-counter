import { AVERAGE_RULE_DE, computeMatchAnalysis, type MatchState } from "@shared/index";
import LivePlayerName from "./LivePlayerName";
import StatGrid from "./StatGrid";

interface Props {
  match: MatchState;
  isHost?: boolean;
  onContinue: () => void;
  onSetStarter?: (playerIndex: number) => void;
  onRematch: () => void;
  onSetup: () => void;
  onUndo: () => void;
}

export default function Overlay({
  match,
  isHost = false,
  onContinue,
  onSetStarter,
  onRematch,
  onSetup,
  onUndo,
}: Props) {
  if (match.status === "playing") return null;

  if (match.status === "bullUp") {
    const roster = match.config.players ?? [];
    return (
      <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm">
        <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl border border-amber-glow/30 bg-ink-800 p-8 text-center shadow-glow">
          <div className="text-xs uppercase tracking-[0.35em] text-amber-glow">Ausbullen</div>
          <div className="mt-4 font-display text-5xl text-white">Letztes Leg</div>
          {isHost ? (
            <>
              <p className="mt-3 text-lg text-slate-300">Wer hat das Bull? Beginner wählen.</p>
              <div className="mt-8 flex flex-col gap-3">
                {roster.map((player, index) => (
                  <button
                    key={player.id || index}
                    className="pad-btn bg-amber-glow text-ink-950"
                    onClick={() => onSetStarter?.(index)}
                  >
                    {player.name || `Spieler ${index + 1}`}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="mt-3 text-lg text-slate-300">Ausbullen — Beginner wird festgelegt…</p>
          )}
        </div>
      </div>
    );
  }

  const name = match.lastWinnerIndex != null ? match.config.players[match.lastWinnerIndex]?.name : "";
  const title =
    match.status === "matchOver"
      ? "Match gewonnen"
      : match.status === "setOver"
        ? "Satz gewonnen"
        : "Leg gewonnen";
  const analysis = match.status === "matchOver" ? computeMatchAnalysis(match) : null;

  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/75 p-6 backdrop-blur-sm">
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-3xl border border-amber-glow/30 bg-ink-800 p-8 text-center shadow-glow">
        <div className="text-xs uppercase tracking-[0.35em] text-amber-glow">{title}</div>
        <div className="mt-4 font-display text-5xl text-white">{name}</div>
        <p className="mt-3 text-lg text-slate-300">{match.lastEvent}</p>

        {analysis && (
          <div className="mt-6 text-left">
            <div className="text-xs font-bold uppercase tracking-[0.3em] text-amber-glow">Spielanalyse</div>
            <p className="mt-2 text-xs text-slate-500">{AVERAGE_RULE_DE}</p>
            <p className="mt-1 text-sm text-slate-300">{analysis.scoreline}</p>
            <div className="mt-3 grid gap-3">
              {(match.config.players ?? []).map((player) => {
                const stats = analysis.playerStats[player.id];
                if (!stats) return null;
                return (
                  <div key={player.id} className="rounded-2xl bg-ink-950 p-3">
                    <div className="font-display text-xl">
                      <LivePlayerName player={player} nameClassName="font-display text-xl" />
                    </div>
                    <StatGrid stats={stats} />
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="mt-8 flex flex-col gap-3">
          {match.status !== "matchOver" && (
            <button className="pad-btn bg-amber-glow text-ink-950" onClick={onContinue}>
              Weiter
            </button>
          )}
          {match.canUndo && (
            <button className="pad-btn bg-ink-600 text-white" onClick={onUndo}>
              Rückgängig
            </button>
          )}
          <button className="pad-btn bg-ink-600 text-white" onClick={onRematch}>
            Neues Match (gleiche Einstellungen)
          </button>
          <button className="pad-btn bg-ink-900 text-slate-200" onClick={onSetup}>
            Abbruch
          </button>
        </div>
      </div>
    </div>
  );
}
