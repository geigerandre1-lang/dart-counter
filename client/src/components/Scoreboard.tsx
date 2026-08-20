import {
  cricketNumbers,
  currentLegRound,
  formatVisit,
  lastVisitForPlayer,
  type MatchState,
  type PlayerLegState,
} from "@shared/index";
import { marksGlyph } from "../lib/labels";
import LivePlayerName from "./LivePlayerName";

interface Props {
  state: MatchState;
}

function PlayerCard({
  state,
  index,
  compact,
}: {
  state: MatchState;
  index: number;
  compact?: boolean;
}) {
  const player = state.config.players[index];
  const leg = state.currentLeg?.players[index];
  if (!player || !leg) return null;
  const active = state.currentLeg?.currentPlayerIndex === index && state.status === "playing";
  const last = lastVisitForPlayer(state, player.id);
  const game = state.config.gameType;
  const knocked = (state.currentLeg?.knockedPlayerIds ?? []).includes(player.id);

  return (
    <article
      className={`relative overflow-hidden rounded-3xl border px-4 py-3 transition ${
        knocked
          ? "border-crimson bg-crimson/15"
          : active
            ? "border-amber-glow bg-amber-glow/10 shadow-glow"
            : "border-white/10 bg-ink-800/80"
      } ${leg.eliminated ? "opacity-45" : ""}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <LivePlayerName
            player={player}
            nameClassName="text-xs font-bold uppercase tracking-[0.2em] text-white/50"
            teamClassName="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-glow/80"
          />
          <Headline game={game} leg={leg} compact={compact} knocked={knocked} />
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Stand</p>
          <StandingsFigures state={state} index={index} compact />
        </div>
      </div>
      {knocked && (
        <p className="mt-2 text-xs font-black uppercase tracking-[0.2em] text-crimson">Auf 0!</p>
      )}
      {game === "cricket" && <CricketMarks state={state} player={leg} />}
      <p className="mt-2 min-h-[1.25rem] text-sm text-white/45">
        {last
          ? `Letzte Aufnahme: ${last.bust ? "Bust" : last.kind === "total" ? last.total : formatVisit(last.darts)}${
              last.shanghai ? " · Shanghai!" : ""
            }`
          : " "}
      </p>
    </article>
  );
}

function Headline({
  game,
  leg,
  compact,
  knocked,
}: {
  game: MatchState["config"]["gameType"];
  leg: PlayerLegState;
  compact?: boolean;
  knocked?: boolean;
}) {
  if (game === "x01") {
    return (
      <p className={`num-display text-amber-glow ${compact ? "text-5xl" : "kiosk-score"}`}>
        {leg.remaining}
      </p>
    );
  }
  if (game === "cricket") {
    return <p className="num-display text-5xl text-amber-glow sm:text-7xl">{leg.cricketScore}</p>;
  }
  if (game === "elimination") {
    return (
      <p className={`num-display ${knocked ? "text-crimson" : "text-amber-glow"} ${compact ? "text-5xl" : "text-5xl sm:text-7xl"}`}>
        {leg.remaining}
      </p>
    );
  }
  if (game === "clock") {
    const t = leg.clockFinished ? "Fertig" : leg.nextTarget === 25 ? "Bull" : String(leg.nextTarget);
    return <p className="num-display text-5xl text-amber-glow sm:text-7xl">{t}</p>;
  }
  return (
    <div>
      <p className="num-display text-5xl text-amber-glow sm:text-7xl">{leg.shanghaiScore}</p>
      <p className="mt-1 text-sm font-bold uppercase tracking-widest text-slate-400">Ziel {leg.nextTarget}</p>
    </div>
  );
}

function CricketMarks({ state, player }: { state: MatchState; player: PlayerLegState }) {
  const targets = cricketNumbers(state.config.cricket);
  return (
    <div className="mt-3 grid grid-cols-7 gap-1 sm:grid-cols-7">
      {targets.map((n) => {
        const marks = player.marks[String(n)] ?? 0;
        return (
          <div
            key={n}
            className={`rounded-xl px-1 py-2 text-center ${
              marks >= 3 ? "bg-amber-glow/20 text-amber-glow" : "bg-black/30 text-white/70"
            }`}
          >
            <div className="text-[10px] font-bold uppercase">{n === 25 ? "Bull" : n}</div>
            <div className="num-display text-lg">{marksGlyph(marks)}</div>
          </div>
        );
      })}
    </div>
  );
}

function StandingsFigures({
  state,
  index,
  compact,
}: {
  state: MatchState;
  index: number;
  compact?: boolean;
}) {
  const showSets = state.config.setsToWin > 1;
  const sets = state.setsWon[index] ?? 0;
  const legs = state.legsWon[index] ?? 0;
  const num = compact ? "text-2xl sm:text-3xl" : "standings-num";
  if (showSets) {
    return (
      <p className="leading-none">
        <span className={`num-display text-white ${num}`}>{sets}</span>
        <span className="ml-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Sätze</span>
        <span className="mx-1.5 text-slate-600">·</span>
        <span className={`num-display text-amber-glow ${num}`}>{legs}</span>
        <span className="ml-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Legs</span>
      </p>
    );
  }
  return (
    <p className="leading-none">
      <span className={`num-display text-amber-glow ${num}`}>{legs}</span>
      <span className="ml-1 text-[10px] font-bold uppercase tracking-widest text-slate-500">Legs</span>
    </p>
  );
}

/** Always-visible match score: legs (and sets) for every player. */
export function StandingsStrip({ state, className = "" }: Props & { className?: string }) {
  const players = state.config.players ?? [];
  const n = Math.max(1, players.length);
  return (
    <div className={`border-b border-white/10 bg-black/25 px-3 py-2 sm:px-4 landscape:lg:col-span-2 ${className}`}>
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: `repeat(${Math.min(n, 4)}, minmax(0, 1fr))` }}
      >
        {players.map((player, index) => (
          <div key={player.id || index} className="min-w-0 rounded-2xl bg-ink-800 px-3 py-2 text-center">
            <LivePlayerName
              player={player}
              nameClassName="truncate text-[11px] font-bold uppercase tracking-[0.18em] text-slate-400"
              teamClassName="truncate text-[10px] font-bold uppercase tracking-[0.16em] text-amber-glow/80"
            />
            <div className="mt-1">
              <StandingsFigures state={state} index={index} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Scoreboard({ state }: Props) {
  const round = currentLegRound(state);
  return (
    <div className="scroll-thin flex min-h-0 flex-col gap-3 overflow-auto p-3 sm:p-4">
      <div className="flex items-baseline justify-center gap-3 rounded-2xl bg-ink-800 px-4 py-3">
        <span className="text-xs font-black uppercase tracking-[0.35em] text-slate-400">Runde</span>
        <span className="font-display text-5xl leading-none text-amber-glow sm:text-6xl">{round}</span>
      </div>
      {(state.config.players ?? []).map((_, i) => (
        <PlayerCard key={state.config.players[i]?.id ?? i} state={state} index={i} />
      ))}
    </div>
  );
}
