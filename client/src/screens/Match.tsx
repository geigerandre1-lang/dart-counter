import {
  currentLegRound,
  formatDart,
  hintForState,
  isBullUpDecidingLeg,
  type ClientAction,
  type MatchState,
} from "@shared/index";
import { useMemo, useState } from "react";
import DartPad from "../components/DartPad";
import JoinQr from "../components/JoinQr";
import LivePlayerName from "../components/LivePlayerName";
import Overlay from "../components/Overlay";
import { Scoreboard, StandingsStrip } from "../components/Scoreboard";
import TotalPad from "../components/TotalPad";
import { GAME_LABELS } from "../lib/labels";

interface Props {
  match: MatchState;
  code: string;
  offline?: boolean;
  lanUrls: string[];
  joinUrl?: string | null;
  connected: boolean;
  sound: boolean;
  error: string | null;
  isHost?: boolean;
  onAction: (action: ClientAction) => void;
  onSound: (on: boolean) => void;
  onHome: () => void;
  onSetup: () => void;
}

export default function Match({
  match,
  code,
  offline,
  lanUrls,
  joinUrl,
  connected,
  sound,
  error,
  isHost = false,
  onAction,
  onSound,
  onHome,
  onSetup,
}: Props) {
  const [settings, setSettings] = useState(false);
  const idx = match.currentLeg?.currentPlayerIndex ?? 0;
  const player = match.config.players[idx] ?? match.config.players[0] ?? { id: "", name: "—" };
  const visit = match.currentLeg?.currentVisit ?? [];
  const totalMode = match.config.inputMode === "total";
  const supportsTotal = match.config.gameType === "x01";
  const hint = useMemo(() => hintForState(match), [match]);
  const playing = match.status === "playing";
  const visitTotal = visit.reduce((s, d) => s + d.segment * d.multiplier, 0);
  const round = currentLegRound(match);
  const throwerLeg = match.currentLeg?.players[idx];
  const knockedIds = match.currentLeg?.knockedPlayerIds ?? [];
  const knockedNames = knockedIds
    .map((id) => match.config.players.find((p) => p.id === id)?.name)
    .filter((n): n is string => Boolean(n));

  return (
    <div className="relative grid min-h-[100dvh] grid-rows-[auto_auto_minmax(0,1fr)_auto] landscape:lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,42vw)] landscape:lg:grid-rows-[auto_auto_minmax(0,1fr)]">
      <header className="safe-pad flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 landscape:lg:col-span-2">
        <button className="text-xs font-bold uppercase tracking-widest text-slate-400" onClick={onHome}>
          {offline ? "Neues Spiel" : "Beenden"}
        </button>
        <div className="min-w-0 flex-1 text-center">
          <div className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-glow">
            {GAME_LABELS[match.config.gameType]}
            {offline ? "" : ` · ${code}`}
          </div>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
            <span className="rounded-xl bg-ink-800 px-3 py-1 text-sm font-bold text-slate-200">
              Satz {match.currentSet}
            </span>
            <span className="rounded-xl bg-ink-800 px-3 py-1 text-sm font-bold text-slate-200">
              Leg {match.currentLegInSet}
            </span>
            <span className="rounded-xl bg-amber-glow px-4 py-1 font-display text-2xl leading-none text-ink-950 sm:text-3xl">
              Runde {round}
            </span>
            {match.config.gameType === "elimination" ? (
              <span className="rounded-xl bg-ink-800 px-3 py-1 text-sm font-bold text-slate-200">
                Ziel {match.config.elimination.target}
                {match.config.elimination.extreme ? " · Extreme" : ""}
              </span>
            ) : null}
            {match.config.gameType === "shanghai" ? (
              <span className="rounded-xl bg-ink-800 px-3 py-1 text-sm font-bold text-slate-200">
                Nächste Zahl {throwerLeg?.nextTarget}
              </span>
            ) : null}
          </div>
          {connected ? null : <div className="mt-1 text-xs text-crimson">getrennt…</div>}
        </div>
        <button className="text-xs font-bold uppercase tracking-widest text-slate-400" onClick={() => setSettings(true)}>
          Menü
        </button>
      </header>

      {joinUrl && (
        <div className="pointer-events-auto absolute right-3 top-[4.6rem] z-10 landscape:lg:right-4">
          <JoinQr url={joinUrl} />
        </div>
      )}

      <StandingsStrip state={match} className={joinUrl ? "pr-[8.5rem]" : ""} />

      <div className="min-h-0">
        <Scoreboard state={match} />
      </div>

      <div className="safe-pad border-t border-white/10 bg-ink-900/90 p-3 landscape:lg:border-l landscape:lg:border-t-0">
        <div className="mb-3 rounded-2xl border border-amber-glow/35 bg-amber-glow/10 px-3 py-2">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-black uppercase tracking-[0.35em] text-amber-glow">Wirft</div>
              <LivePlayerName
                player={player}
                nameClassName="truncate font-display text-2xl leading-none text-white sm:text-3xl"
              />
            </div>
            <div className="text-right">
              <div className="text-[11px] uppercase tracking-[0.2em] text-slate-400">Aufnahme</div>
              <div className="num-display text-4xl text-white">{visitTotal}</div>
              {match.config.gameType === "x01" && (
                <div className="text-sm text-amber-glow">Rest {match.currentLeg?.players[idx]?.remaining}</div>
              )}
              {match.config.gameType === "elimination" && (
                <div className="text-sm text-amber-glow">
                  Stand {throwerLeg?.remaining} / {match.config.elimination.target}
                </div>
              )}
              {match.config.gameType === "shanghai" && (
                <div className="text-sm text-amber-glow">
                  {throwerLeg?.shanghaiScore} Pkt · Zahl {throwerLeg?.nextTarget}
                </div>
              )}
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="num-display min-w-[3.2rem] flex-1 rounded-xl bg-ink-700 px-2 py-2 text-center text-2xl">
                {visit[i] ? formatDart(visit[i]!) : "·"}
              </div>
            ))}
          </div>
          {match.currentLeg?.bustMessage && (
            <p className="mt-2 font-semibold text-crimson">{match.currentLeg.bustMessage}</p>
          )}
          {knockedNames.length > 0 && (
            <p className="mt-2 font-semibold text-crimson">
              {match.lastEvent ?? `${knockedNames.join(" und ")} zurück auf 0!`}
            </p>
          )}
          {hint && <p className="mt-1 text-sm font-semibold text-amber-glow">Checkout {hint}</p>}
        </div>
        {isHost && playing && isBullUpDecidingLeg(match) && (
          <button
            type="button"
            className="mb-3 min-h-touch w-full rounded-2xl bg-ink-800 text-xs font-bold uppercase tracking-[0.22em] text-slate-400"
            onClick={() => onAction({ type: "REOPEN_BULL_UP" })}
          >
            Ausbullen ändern
          </button>
        )}
        {supportsTotal && (
          <div className="mb-2 grid grid-cols-2 gap-2">
            <button
              className={`min-h-touch rounded-2xl text-sm font-black uppercase tracking-wide ${
                !totalMode ? "bg-amber-glow text-ink-950" : "bg-ink-700 text-slate-300"
              }`}
              onClick={() => onAction({ type: "SET_INPUT_MODE", mode: "single" })}
            >
              Einzeleingabe
            </button>
            <button
              className={`min-h-touch rounded-2xl text-sm font-black uppercase tracking-wide ${
                totalMode ? "bg-amber-glow text-ink-950" : "bg-ink-700 text-slate-300"
              }`}
              onClick={() => onAction({ type: "SET_INPUT_MODE", mode: "total" })}
            >
              Gesamteingabe
            </button>
          </div>
        )}
        {totalMode && supportsTotal ? (
          <TotalPad
            disabled={!playing}
            canUndo={match.canUndo}
            error={error}
            onUndo={() => onAction({ type: "UNDO" })}
            onSubmit={(total) => onAction({ type: "SET_VISIT_TOTAL", playerId: player.id, total })}
          />
        ) : (
          <DartPad
            disabled={!playing}
            canUndo={match.canUndo}
            canConfirm={playing && visit.length > 0 && visit.length < 3}
            onUndo={() => onAction({ type: "UNDO" })}
            onConfirm={() => onAction({ type: "CONFIRM_VISIT", playerId: player.id })}
            onDart={(dart) => onAction({ type: "THROW_DART", playerId: player.id, dart })}
          />
        )}
      </div>

      {knockedNames.length > 0 && playing && (
        <div className="pointer-events-none fixed left-1/2 top-24 z-20 -translate-x-1/2 rounded-2xl border border-crimson/50 bg-ink-950/95 px-5 py-3 text-center shadow-glow">
          <div className="text-[10px] font-black uppercase tracking-[0.3em] text-crimson">Elimination</div>
          <div className="mt-1 font-display text-2xl text-white">{knockedNames.join(" · ")}</div>
          <div className="text-sm font-semibold text-crimson">zurück auf 0</div>
        </div>
      )}

      {error && (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-full bg-crimson px-4 py-2 text-sm font-bold">
          {error}
        </div>
      )}

      <Overlay
        match={match}
        isHost={isHost}
        onContinue={() => onAction({ type: "ACKNOWLEDGE" })}
        onSetStarter={(playerIndex) => onAction({ type: "SET_LEG_STARTER", playerIndex })}
        onRematch={() => onAction({ type: "REMATCH" })}
        onSetup={onSetup}
        onUndo={() => onAction({ type: "UNDO" })}
      />

      {settings && (
        <div className="fixed inset-0 z-40 flex items-end bg-black/65 sm:items-center sm:justify-center">
          <div className="w-full max-w-md rounded-t-3xl border border-white/10 bg-ink-800 p-5 sm:rounded-3xl">
            <h3 className="font-display text-3xl uppercase">Einstellungen</h3>
            <label className="mt-4 flex min-h-touch items-center justify-between rounded-2xl bg-ink-700 px-4">
              <span>Klick-Sound</span>
              <input type="checkbox" checked={sound} onChange={(e) => onSound(e.target.checked)} />
            </label>
            {lanUrls.length > 0 && (
              <div className="mt-4 text-sm text-slate-400">
                {offline
                  ? `Andere Geräte: ${lanUrls.join(" · ")}`
                  : `Raum-ID ${code}${lanUrls[0] ? ` · ${lanUrls.join(" · ")}` : ""}`}
              </div>
            )}
            {!offline && !lanUrls.length && (
              <div className="mt-4 text-sm text-slate-400">Raum-ID {code}</div>
            )}
            <button className="pad-btn mt-5 w-full bg-ink-600" onClick={() => setSettings(false)}>
              Schließen
            </button>
            <button className="pad-btn mt-2 w-full bg-ink-900 text-slate-300" onClick={onHome}>
              {offline ? "Neues Spiel einrichten" : "Zur Startseite"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
