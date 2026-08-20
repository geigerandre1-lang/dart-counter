import {
  cricketNumbers,
  currentLegRound,
  formatDart,
  inGamePlayerName,
  monitorBoardLabel,
  type MatchState,
  type MonitorGameSnapshot,
  type PlayerLegState,
} from "@shared/index";
import { useEffect, useState } from "react";
import LivePlayerName from "../components/LivePlayerName";
import { GAME_LABELS, marksGlyph } from "../lib/labels";
import { discoverServerInfo } from "../lib/statsApi";

type View =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "ready"; games: MonitorGameSnapshot[] };

export default function Monitor() {
  const [view, setView] = useState<View>({ kind: "loading" });

  useEffect(() => {
    if (window.steeldartDesktop?.getState) {
      setView({ kind: "unavailable" });
      return;
    }

    let cancelled = false;
    let origin = "";

    const tick = async () => {
      try {
        if (!origin) {
          const discovered = await discoverServerInfo();
          if (cancelled) return;
          if (discovered.info.mode !== "online") {
            setView({ kind: "unavailable" });
            return;
          }
          origin = discovered.origin;
        }
        const res = await fetch(`${origin.replace(/\/+$/, "")}/api/monitor`);
        if (cancelled) return;
        if (res.status === 404) {
          setView({ kind: "unavailable" });
          return;
        }
        if (!res.ok) return;
        const data = (await res.json()) as { games?: MonitorGameSnapshot[] };
        setView({ kind: "ready", games: Array.isArray(data.games) ? data.games : [] });
      } catch {
        /* retry on the next interval */
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  if (view.kind === "unavailable") {
    return (
      <div className="pdc-wall flex min-h-[100dvh] items-center justify-center px-6 text-center">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.45em] text-[#c9a227]">Monitor</p>
          <h1 className="mt-4 font-display text-4xl text-white sm:text-6xl">Nur auf dem Webserver</h1>
          <p className="mt-4 max-w-lg text-lg text-white/55">
            Die TV-Ansicht gibt es nur auf dem gehosteten Online-Server, nicht lokal oder offline.
          </p>
        </div>
      </div>
    );
  }

  if (view.kind === "loading") {
    return <div className="pdc-wall min-h-[100dvh]" />;
  }

  if (view.games.length === 0) {
    return (
      <div className="pdc-wall flex min-h-[100dvh] items-center justify-center px-6 text-center">
        <h1 className="font-display text-5xl text-white sm:text-7xl md:text-8xl">„Kein Spiel läuft“</h1>
      </div>
    );
  }

  const n = view.games.length;
  const wallClass =
    n <= 1 ? "grid-cols-1" : n === 2 ? "grid-cols-1 md:grid-cols-2" : "grid-cols-2";

  return (
    <div className={`pdc-wall grid min-h-[100dvh] gap-2 p-2 sm:gap-3 sm:p-3 ${wallClass}`} data-count={n}>
      {view.games.map((game) => (
        <MatchTile key={game.match.id} game={game} />
      ))}
    </div>
  );
}

function MatchTile({ game }: { game: MonitorGameSnapshot }) {
  const match = game.match;
  const players = match.config.players ?? [];
  const duel = players.length === 2;
  const round = currentLegRound(match);
  const thrower = players[match.currentLeg?.currentPlayerIndex ?? 0];
  const banner = statusBanner(match);

  return (
    <section className="pdc-tile flex min-h-0 flex-col overflow-hidden">
      <header className="pdc-board-bar">
        <h2 className="pdc-board">{monitorBoardLabel(game.boardName)}</h2>
        <p className="pdc-meta">
          {gameCaption(match)}
          <span className="pdc-dot">·</span>
          Runde {round}
          {thrower ? (
            <>
              <span className="pdc-dot">·</span>
              {inGamePlayerName(thrower.name)}
            </>
          ) : null}
        </p>
      </header>

      <div className={`min-h-0 flex-1 p-2 sm:p-3 ${duel ? "pdc-duel" : "pdc-field"}`}>
        {players.map((player, index) => (
          <PlayerPlate key={player.id || index} state={match} index={index} />
        ))}
      </div>

      {banner ? <div className="pdc-banner">{banner}</div> : null}
    </section>
  );
}

function PlayerPlate({ state, index }: { state: MatchState; index: number }) {
  const player = state.config.players[index];
  const leg = state.currentLeg?.players[index];
  if (!player || !leg) return null;
  const throwing = state.currentLeg?.currentPlayerIndex === index && state.status === "playing";
  const knocked = (state.currentLeg?.knockedPlayerIds ?? []).includes(player.id);
  const visit = throwing ? (state.currentLeg?.currentVisit ?? []) : [];
  const showSets = state.config.setsToWin > 1;

  return (
    <article
      className={`pdc-plate flex min-h-0 flex-col ${throwing ? "is-throwing" : ""} ${knocked ? "is-knocked" : ""} ${
        leg.eliminated ? "is-out" : ""
      }`}
    >
      <div className="pdc-namebar">
        <LivePlayerName
          player={player}
          nameClassName={`truncate font-display text-xl leading-none sm:text-2xl lg:text-3xl ${
            throwing ? "text-ink-950" : "text-white"
          }`}
          teamClassName={`truncate text-[10px] font-bold uppercase tracking-[0.22em] sm:text-[11px] ${
            throwing ? "text-ink-950/70" : "text-[#e1b53a]/85"
          }`}
        />
        {throwing ? <span className="pdc-throwing-tag">Wirft</span> : null}
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-3 py-2">
        <p className={`pdc-score ${knocked ? "text-crimson" : "text-white"}`}>{heroValue(state, leg)}</p>
        {state.config.gameType === "shanghai" ? (
          <p className="mt-1 text-xs font-bold uppercase tracking-[0.22em] text-white/45">Ziel {leg.nextTarget}</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end justify-between gap-2 px-3 pb-3">
        <div className="flex flex-col gap-1.5">
          {showSets ? (
            <Pips won={state.setsWon[index] ?? 0} toWin={state.config.setsToWin} label="Satz" />
          ) : null}
          <Pips won={state.legsWon[index] ?? 0} toWin={state.config.legsToWinSet} label="Leg" />
        </div>
        {throwing ? (
          <div className="flex gap-1">
            {[0, 1, 2].map((slot) => (
              <span key={slot} className="pdc-dart">
                {visit[slot] ? formatDart(visit[slot]!) : "·"}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {state.config.gameType === "cricket" ? <CricketStrip state={state} player={leg} /> : null}
    </article>
  );
}

function Pips({ won, toWin, label }: { won: number; toWin: number; label: string }) {
  if (toWin > 7) {
    return (
      <div className="pdc-stand">
        <span className="pdc-stand-label">{label}</span>
        <span className="num-display text-xl text-white sm:text-2xl">{won}</span>
      </div>
    );
  }
  return (
    <div className="pdc-stand">
      <span className="pdc-stand-label">{label}</span>
      <span className="pdc-pips">
        {Array.from({ length: Math.max(1, toWin) }, (_, i) => (
          <i key={i} className={i < won ? "pdc-pip on" : "pdc-pip"} />
        ))}
      </span>
    </div>
  );
}

function CricketStrip({ state, player }: { state: MatchState; player: PlayerLegState }) {
  const targets = cricketNumbers(state.config.cricket);
  return (
    <div className="grid grid-cols-7 gap-px border-t border-white/10 bg-black/30 px-1 py-1">
      {targets.map((n) => {
        const marks = player.marks[String(n)] ?? 0;
        return (
          <div key={n} className={`text-center ${marks >= 3 ? "text-[#e1b53a]" : "text-white/55"}`}>
            <div className="text-[9px] font-bold uppercase">{n === 25 ? "Bull" : n}</div>
            <div className="num-display text-sm">{marksGlyph(marks)}</div>
          </div>
        );
      })}
    </div>
  );
}

function heroValue(state: MatchState, leg: PlayerLegState): string {
  const game = state.config.gameType;
  if (game === "x01" || game === "elimination") return String(leg.remaining);
  if (game === "cricket") return String(leg.cricketScore);
  if (game === "clock") {
    if (leg.clockFinished) return "Fertig";
    return leg.nextTarget === 25 ? "Bull" : String(leg.nextTarget);
  }
  return String(leg.shanghaiScore);
}

function gameCaption(state: MatchState): string {
  if (state.config.gameType === "x01") return String(state.config.x01.startScore);
  return GAME_LABELS[state.config.gameType];
}

function statusBanner(match: MatchState): string | null {
  if (match.status === "playing") return null;
  const name = match.lastWinnerIndex != null ? match.config.players[match.lastWinnerIndex]?.name : "";
  if (match.status === "bullUp") return "Ausbullen";
  if (match.status === "setOver") return name ? `Satz gewonnen — ${name}` : "Satz gewonnen";
  if (match.status === "legOver") return name ? `Leg gewonnen — ${name}` : "Leg gewonnen";
  return null;
}
