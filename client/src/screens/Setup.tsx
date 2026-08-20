import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { GameType, MatchConfig } from "@shared/index";
import { STANDARD_CRICKET_NUMBERS, X01_PRESETS, randomCricketSet, toMatchPlayer } from "@shared/index";
import JoinQr from "../components/JoinQr";
import { createPlayer, fetchPlayers, fetchTeams, type RegisteredPlayer, type TeamTree } from "../lib/statsApi";

const GAMES: { id: GameType; title: string; blurb: string }[] = [
  { id: "x01", title: "x01", blurb: "301 / 501 / 701 / 901" },
  { id: "cricket", title: "Cricket", blurb: "15–20 + Bull, oder eigene Zahlen" },
  { id: "elimination", title: "Elimination", blurb: "Aufzählen bis x01 – gleicher Score setzt Gegner auf 0" },
  { id: "clock", title: "Around the Clock", blurb: "1 → 20 → Bull" },
  { id: "shanghai", title: "Shanghai", blurb: "Immer die nächste Zahl; S+D+T gewinnt" },
];

interface Props {
  config: MatchConfig;
  code: string;
  offline?: boolean;
  lanUrls: string[];
  joinUrl?: string | null;
  onChange: (config: MatchConfig) => void;
  onStart: () => void;
  onHome?: () => void;
  onChangeMode?: () => void;
  apiBase?: string;
  origin?: string | null;
}

function Chip({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`min-h-touch rounded-2xl px-4 text-sm font-bold ${
        active ? "bg-amber-glow text-ink-950" : "bg-ink-700 text-slate-200"
      }`}
    >
      {children}
    </button>
  );
}

function selectedTeamIds(playingTeams: { id: string }[] | undefined | null): Set<string> {
  return new Set((playingTeams ?? []).map((t) => t.id).filter(Boolean));
}

/** Local/unassigned when no team is picked; otherwise only members of the selected teams. */
function playerFitsTeamSelection(
  player: { teamId?: string | null },
  teamIds: ReadonlySet<string>,
): boolean {
  if (teamIds.size === 0) return !player.teamId;
  return Boolean(player.teamId && teamIds.has(player.teamId));
}

function pickerGroups(
  registry: RegisteredPlayer[],
  teams: TeamTree[] | undefined | null,
  playingTeams: { id: string; name: string }[],
  used: Set<string>,
  currentId: string,
): { label: string; players: RegisteredPlayer[] }[] {
  const available = (list: RegisteredPlayer[]) =>
    list.filter((pl) => !used.has(pl.id) || pl.id === currentId);
  const teamList = teams ?? [];

  if (!playingTeams.length) {
    return [{ label: "", players: available(registry.filter((pl) => !pl.teamId)) }];
  }

  const selected = teamList.filter((team) => playingTeams.some((t) => t.id === team.id));
  if (selected.length > 0) {
    return selected.map((team) => ({
      label: team.name,
      players: available(team.players ?? []),
    }));
  }

  // Teams failed to load or list is empty — still offer registry members of the chosen ids.
  return playingTeams.map((team) => ({
    label: team.name,
    players: available(registry.filter((pl) => pl.teamId === team.id)),
  }));
}

export default function Setup({
  config,
  code,
  offline,
  lanUrls,
  joinUrl,
  onChange,
  onStart,
  onHome,
  onChangeMode,
  apiBase = "",
  origin = null,
}: Props) {
  const players = config.players ?? [];
  const n = players.length;
  const playingTeams = config.teams ?? [];
  const desktop = window.steeldartDesktop;
  const [registry, setRegistry] = useState<RegisteredPlayer[]>([]);
  const [teams, setTeams] = useState<TeamTree[]>([]);
  const [newName, setNewName] = useState("");
  const [newPassNr, setNewPassNr] = useState("");
  const [playerError, setPlayerError] = useState<string | null>(null);
  const ready = players.every((p) => p.id && p.name.trim());
  const onChangeRef = useRef(onChange);
  const configRef = useRef(config);
  onChangeRef.current = onChange;
  configRef.current = config;

  useEffect(() => {
    void fetchPlayers(apiBase, desktop, origin)
      .then((players) => {
        setRegistry(players);
        void fetchTeams(apiBase, desktop, origin)
          .then(setTeams)
          .catch((err) => {
            setTeams([]);
            setPlayerError(err instanceof Error ? err.message : "Teams konnten nicht geladen werden.");
          });
        const cfg = configRef.current;
        const slots = cfg.players ?? [];
        const ids = new Set(players.map((p) => p.id));
        if (players.length === 0) return;
        const teamIds = selectedTeamIds(cfg.teams);
        const fits = (p: RegisteredPlayer) => playerFitsTeamSelection(p, teamIds);
        const slotOk = (slot: { id: string }) => {
          if (!slot.id || !ids.has(slot.id)) return false;
          const full = players.find((x) => x.id === slot.id);
          return Boolean(full && fits(full));
        };
        if (slots.every(slotOk)) return;
        const eligible = players.filter(fits);
        const preferred = ["Spieler 1", "Spieler 2"]
          .map((name) => eligible.find((p) => p.name === name))
          .filter((p): p is RegisteredPlayer => Boolean(p));
        const rest = eligible.filter((p) => !preferred.some((x) => x.id === p.id));
        const pool = [...preferred, ...rest];
        const used = new Set<string>();
        const nextPlayers = slots.map((slot) => {
          if (slotOk(slot) && !used.has(slot.id)) {
            used.add(slot.id);
            return slot;
          }
          const pick = pool.find((p) => !used.has(p.id));
          if (!pick) return { id: "", name: "" };
          used.add(pick.id);
          return toMatchPlayer(pick);
        });
        onChangeRef.current({ ...cfg, players: nextPlayers });
      })
      .catch((err) => {
        setRegistry([]);
        setPlayerError(err instanceof Error ? err.message : "Spieler konnten nicht geladen werden.");
      });
  }, [apiBase, origin]);

  function setPlayers(count: number) {
    const nextPlayers = Array.from({ length: count }, (_, i) => ({
      id: players[i]?.id ?? "",
      name: players[i]?.name ?? "",
    }));
    const fallbackFirst = count >= 2 ? 1 : 0;
    onChange({
      ...config,
      players: nextPlayers,
      firstThrowerIndex: Math.min(config.firstThrowerIndex ?? fallbackFirst, count - 1),
    });
  }

  function pickPlayer(i: number, id: string) {
    const selected = registry.find((p) => p.id === id);
    const nextPlayers = players.map((p, idx) =>
      idx === i ? (selected ? toMatchPlayer(selected) : { id: "", name: "" }) : p,
    );
    onChange({ ...config, players: nextPlayers });
  }

  function setTeamsPlaying(next: { id: string; name: string }[]) {
    const teamIds = selectedTeamIds(next);
    const nextPlayers = players.map((slot) => {
      const full = registry.find((p) => p.id === slot.id);
      const teamId = full?.teamId ?? slot.teamId;
      if (playerFitsTeamSelection({ teamId }, teamIds)) return slot;
      return { id: "", name: "" };
    });
    onChange({ ...config, teams: next, players: nextPlayers });
  }

  return (
    <div className="safe-pad mx-auto min-h-[100dvh] max-w-4xl px-4 py-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          {onHome && (
            <button className="text-sm text-slate-400" onClick={onHome}>
              ← Start
            </button>
          )}
          {onChangeMode && (
            <button className={`${onHome ? "ml-4" : ""} text-sm text-slate-400`} onClick={onChangeMode}>
              {onHome ? "Modus wechseln" : "← Modus wechseln"}
            </button>
          )}
          <h1 className={`${onHome || onChangeMode ? "mt-1" : ""} font-display text-4xl`}>Match einrichten</h1>
          <p className="text-slate-400">
            {offline ? (
              <>Lokales Spiel{lanUrls[0] ? ` · ${lanUrls[0]}` : ""}</>
            ) : (
              <>Raum-ID mit den Mitspielern teilen</>
            )}
          </p>
          {!offline && (
            <div className="mt-3 rounded-2xl bg-ink-800 px-4 py-3">
              <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-slate-400">Raum-ID</div>
              <div className="font-mono text-4xl tracking-[0.2em] text-amber-glow">{code}</div>
            </div>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-3">
          {joinUrl && <JoinQr url={joinUrl} />}
          <button
            className="min-h-touch rounded-2xl bg-amber-glow px-6 font-bold text-ink-950 disabled:opacity-50"
            disabled={!ready}
            onClick={onStart}
          >
            Start
          </button>
        </div>
      </div>

      <section className="mb-6">
        <h2 className="mb-3 text-xs uppercase tracking-[0.25em] text-slate-400">Spiel</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {GAMES.map((g) => (
            <button
              key={g.id}
              onClick={() => onChange({ ...config, gameType: g.id, inputMode: g.id === "x01" ? config.inputMode : "single" })}
              className={`rounded-2xl p-4 text-left ${
                config.gameType === g.id ? "bg-amber-glow text-ink-950" : "bg-ink-800"
              }`}
            >
              <div className="font-display text-2xl">{g.title}</div>
              <div className={`text-xs ${config.gameType === g.id ? "text-ink-800" : "text-slate-400"}`}>{g.blurb}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="mb-6 rounded-3xl bg-ink-800 p-5">
        <h2 className="mb-3 text-xs uppercase tracking-[0.25em] text-slate-400">Spieler ({n})</h2>
        {teams.length > 0 && (
          <div className="mb-4">
            <div className="mb-2 text-sm text-slate-400">Welche Teams spielen? (eines oder zwei)</div>
            <div className="mb-3 flex flex-wrap gap-2">
              {teams.map((team) => {
                const on = playingTeams.some((t) => t.id === team.id);
                return (
                  <Chip
                    key={team.id}
                    active={on}
                    onClick={() => {
                      const next = on
                        ? playingTeams.filter((t) => t.id !== team.id)
                        : [...playingTeams, { id: team.id, name: team.name }].slice(0, 2);
                      setTeamsPlaying(next);
                    }}
                  >
                    {team.name}
                  </Chip>
                );
              })}
            </div>
            {playingTeams.length > 0 && (
              <div className="mb-4 grid gap-3">
                {teams
                  .filter((team) => playingTeams.some((t) => t.id === team.id))
                  .map((team) => (
                    <div key={team.id} className="rounded-2xl bg-ink-950 p-3">
                      <div className="font-display text-xl">{team.name}</div>
                      <div className="mt-2 text-sm text-slate-300">
                        {(team.players ?? []).length
                          ? (team.players ?? []).map((p) => p.name).join(" · ")
                          : "Keine Spieler — in Admin hinzufügen"}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}
        <div className="mb-4 flex flex-wrap gap-2">
          {Array.from({ length: 8 }, (_, i) => i + 1).map((count) => (
            <Chip key={count} active={n === count} onClick={() => setPlayers(count)}>
              {count}
            </Chip>
          ))}
        </div>
        <div className="grid gap-2">
          {players.map((p, i) => {
            const used = new Set(players.filter((_, idx) => idx !== i).map((x) => x.id).filter(Boolean));
            const grouped = pickerGroups(registry, teams, playingTeams, used, p.id);
            return (
              <div key={p.id || `slot-${i}`} className="flex items-center gap-3">
                <select
                  value={p.id}
                  onChange={(e) => pickPlayer(i, e.target.value)}
                  className="min-h-touch flex-1 rounded-2xl bg-ink-950 px-4 outline-none ring-amber-glow/30 focus:ring"
                >
                  <option value="">Spieler wählen…</option>
                  {grouped.map((group) =>
                    group.label ? (
                      <optgroup key={group.label} label={group.label}>
                        {group.players.map((pl) => (
                          <option key={pl.id} value={pl.id}>
                            {pl.name}
                          </option>
                        ))}
                      </optgroup>
                    ) : (
                      group.players.map((pl) => (
                        <option key={pl.id} value={pl.id}>
                          {pl.name}
                          {pl.teamName ? ` · ${pl.teamName}` : ""}
                        </option>
                      ))
                    ),
                  )}
                </select>
                <Chip active={(config.firstThrowerIndex ?? 0) === i} onClick={() => onChange({ ...config, firstThrowerIndex: i })}>
                  Wirft zuerst
                </Chip>
              </div>
            );
          })}
        </div>
        <form
          className="mt-4 flex flex-wrap gap-2"
          noValidate
          onSubmit={async (e) => {
            e.preventDefault();
            setPlayerError(null);
            try {
              const result = await createPlayer(newName, apiBase, desktop, origin, newPassNr.trim() || null);
              if (!result.ok) {
                setPlayerError(result.error);
                return;
              }
              setRegistry((cur) =>
                [...cur, { ...result.player, createdAt: result.player.createdAt ?? Date.now() }].sort((a, b) =>
                  a.name.localeCompare(b.name, "de"),
                ),
              );
              const empty = players.findIndex((p) => !p.id);
              const nextPlayers = players.map((p, idx) =>
                idx === (empty >= 0 ? empty : 0) ? { id: result.player.id, name: result.player.name, teamId: result.player.teamId, teamName: result.player.teamName } : p,
              );
              onChange({ ...config, players: nextPlayers });
              setNewName("");
              setNewPassNr("");
            } catch {
              setPlayerError("Spieler konnte nicht angelegt werden.");
            }
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Neuen Spieler anlegen"
            className="min-h-touch flex-1 rounded-2xl bg-ink-950 px-4"
            autoComplete="off"
            required={false}
          />
          <input
            value={newPassNr}
            onChange={(e) => setNewPassNr(e.target.value)}
            placeholder="Spielernummer/PassNr (optional)"
            className="min-h-touch w-44 rounded-2xl bg-ink-950 px-4"
            autoComplete="off"
            required={false}
          />
          <button type="submit" className="min-h-touch rounded-2xl bg-ink-700 px-4 font-bold" disabled={!newName.trim()}>
            Anlegen
          </button>
        </form>
        {playerError && <p className="mt-2 text-sm text-crimson">{playerError}</p>}
        {!ready && <p className="mt-2 text-sm text-slate-400">Bitte für jeden Platz einen vorhandenen Spieler wählen.</p>}
      </section>

      <section className="mb-6 rounded-3xl bg-ink-800 p-5">
        <h2 className="mb-3 text-xs uppercase tracking-[0.25em] text-slate-400">Legs &amp; Sätze</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm text-slate-400">Legs zum Satzgewinn (First to)</span>
            <input
              type="number"
              min={1}
              max={21}
              value={config.legsToWinSet}
              onChange={(e) => onChange({ ...config, legsToWinSet: Number(e.target.value) || 1 })}
              className="mt-1 min-h-touch w-full rounded-2xl bg-ink-950 px-4"
            />
          </label>
          <label className="block">
            <span className="text-sm text-slate-400">Sätze zum Matchsieg (1 = nur Legs)</span>
            <input
              type="number"
              min={1}
              max={21}
              value={config.setsToWin}
              onChange={(e) => onChange({ ...config, setsToWin: Number(e.target.value) || 1 })}
              className="mt-1 min-h-touch w-full rounded-2xl bg-ink-950 px-4"
            />
          </label>
        </div>
        <label className="mt-5 flex min-h-touch items-center gap-3 rounded-2xl bg-ink-950 px-4">
          <input
            type="checkbox"
            checked={config.bullUpLastLeg !== false}
            onChange={(e) => onChange({ ...config, bullUpLastLeg: e.target.checked })}
          />
          <span>Letztes Leg ausbullen</span>
        </label>
      </section>

      {config.gameType === "x01" && (
        <section className="mb-6 rounded-3xl bg-ink-800 p-5">
          <h2 className="mb-3 text-xs uppercase tracking-[0.25em] text-slate-400">Eingabe</h2>
          <div className="flex gap-2">
            <Chip active={config.inputMode === "single"} onClick={() => onChange({ ...config, inputMode: "single" })}>
              Einzeleingabe (3 Darts)
            </Chip>
            <Chip active={config.inputMode === "total"} onClick={() => onChange({ ...config, inputMode: "total" })}>
              Gesamteingabe 3-Dart
            </Chip>
          </div>
        </section>
      )}

      {config.gameType === "x01" && (
        <section className="mb-6 rounded-3xl bg-ink-800 p-5">
          <h2 className="mb-3 text-xs uppercase tracking-[0.25em] text-slate-400">x01</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            {X01_PRESETS.map((s) => (
              <Chip
                key={s}
                active={config.x01.startScore === s}
                onClick={() => onChange({ ...config, x01: { ...config.x01, startScore: s } })}
              >
                {s}
              </Chip>
            ))}
          </div>
          <label className="mb-4 block">
            <span className="text-sm text-slate-400">Eigener Startscore</span>
            <input
              type="number"
              min={2}
              max={10001}
              value={config.x01.startScore}
              onChange={(e) => onChange({ ...config, x01: { ...config.x01, startScore: Number(e.target.value) || 501 } })}
              className="mt-1 min-h-touch w-full rounded-2xl bg-ink-950 px-4"
            />
          </label>
          <div className="mb-2 text-sm text-slate-400">In</div>
          <div className="mb-4 flex gap-2">
            <Chip active={config.x01.inMode === "straight"} onClick={() => onChange({ ...config, x01: { ...config.x01, inMode: "straight" } })}>
              Straight In
            </Chip>
            <Chip active={config.x01.inMode === "double"} onClick={() => onChange({ ...config, x01: { ...config.x01, inMode: "double" } })}>
              Double In
            </Chip>
          </div>
          <div className="mb-2 text-sm text-slate-400">Out</div>
          <div className="flex flex-wrap gap-2">
            {(["straight", "double", "master"] as const).map((mode) => (
              <Chip
                key={mode}
                active={config.x01.outMode === mode}
                onClick={() => onChange({ ...config, x01: { ...config.x01, outMode: mode } })}
              >
                {mode === "straight" ? "Straight Out" : mode === "double" ? "Double Out" : "Master Out"}
              </Chip>
            ))}
          </div>
        </section>
      )}

      {config.gameType === "cricket" && (
        <section className="mb-6 rounded-3xl bg-ink-800 p-5">
          <h2 className="mb-3 text-xs uppercase tracking-[0.25em] text-slate-400">Cricket-Zahlen</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            <Chip
              active={
                config.cricket.includeBull &&
                STANDARD_CRICKET_NUMBERS.every((n) => config.cricket.numbers.includes(n)) &&
                config.cricket.numbers.length === 6
              }
              onClick={() => onChange({ ...config, cricket: { numbers: [...STANDARD_CRICKET_NUMBERS], includeBull: true } })}
            >
              Standard 15–20 + Bull
            </Chip>
            <Chip
              active={false}
              onClick={() => {
                const set = randomCricketSet(true);
                onChange({ ...config, cricket: { numbers: set.numbers, includeBull: set.includeBull } });
              }}
            >
              Zufällig (6 Zahlen ± Bull)
            </Chip>
          </div>
          <div className="grid grid-cols-5 gap-2 sm:grid-cols-7">
            {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => {
              const on = config.cricket.numbers.includes(n);
              return (
                <button
                  key={n}
                  className={`min-h-touch rounded-2xl font-bold ${on ? "bg-amber-glow text-ink-950" : "bg-ink-700"}`}
                  onClick={() => {
                    const numbers = on
                      ? config.cricket.numbers.filter((x) => x !== n)
                      : [...config.cricket.numbers, n];
                    onChange({ ...config, cricket: { ...config.cricket, numbers } });
                  }}
                >
                  {n}
                </button>
              );
            })}
            <button
              className={`min-h-touch rounded-2xl font-bold ${config.cricket.includeBull ? "bg-crimson text-white" : "bg-ink-700"}`}
              onClick={() => onChange({ ...config, cricket: { ...config.cricket, includeBull: !config.cricket.includeBull } })}
            >
              Bull
            </button>
          </div>
        </section>
      )}

      {config.gameType === "elimination" && (
        <section className="mb-6 rounded-3xl bg-ink-800 p-5">
          <h2 className="mb-3 text-xs uppercase tracking-[0.25em] text-slate-400">Elimination</h2>
          <div className="mb-3 flex flex-wrap gap-2">
            {X01_PRESETS.map((s) => (
              <Chip
                key={s}
                active={config.elimination.target === s}
                onClick={() => onChange({ ...config, elimination: { ...config.elimination, target: s } })}
              >
                {s}
              </Chip>
            ))}
          </div>
          <label className="mb-4 block">
            <span className="text-sm text-slate-400">Eigenes Ziel</span>
            <input
              type="number"
              min={2}
              max={10001}
              value={config.elimination.target}
              onChange={(e) =>
                onChange({ ...config, elimination: { ...config.elimination, target: Number(e.target.value) || 501 } })
              }
              className="mt-1 min-h-touch w-full rounded-2xl bg-ink-950 px-4"
            />
          </label>
          <div className="mb-2 text-sm text-slate-400">In</div>
          <div className="mb-4 flex gap-2">
            <Chip
              active={config.elimination.inMode === "straight"}
              onClick={() => onChange({ ...config, elimination: { ...config.elimination, inMode: "straight" } })}
            >
              Straight In
            </Chip>
            <Chip
              active={config.elimination.inMode === "double"}
              onClick={() => onChange({ ...config, elimination: { ...config.elimination, inMode: "double" } })}
            >
              Double In
            </Chip>
          </div>
          <div className="mb-2 text-sm text-slate-400">Out</div>
          <div className="mb-4 flex flex-wrap gap-2">
            {(["straight", "double", "master"] as const).map((mode) => (
              <Chip
                key={mode}
                active={config.elimination.outMode === mode}
                onClick={() => onChange({ ...config, elimination: { ...config.elimination, outMode: mode } })}
              >
                {mode === "straight" ? "Straight Out" : mode === "double" ? "Double Out" : "Master Out"}
              </Chip>
            ))}
          </div>
          <div className="mb-2 text-sm text-slate-400">Modus</div>
          <div className="mb-3 flex flex-wrap gap-2">
            <Chip
              active={!config.elimination.extreme}
              onClick={() => onChange({ ...config, elimination: { ...config.elimination, extreme: false } })}
            >
              Normal
            </Chip>
            <Chip
              active={config.elimination.extreme}
              onClick={() => onChange({ ...config, elimination: { ...config.elimination, extreme: true } })}
            >
              Extreme
            </Chip>
          </div>
          <p className="text-sm text-slate-400">
            Alle starten bei 0 und zählen hoch bis zum Ziel. Wer nach einem Dart genau den Score eines Gegners trifft,
            setzt diesen auf 0 zurück (Score 0 setzt niemanden zurück).
          </p>
          <p className="mt-2 text-sm text-slate-400">
            {config.elimination.extreme
              ? "Extreme: Überwerfen beendet die Aufnahme. Neuer Score = Ziel − Überhang (z. B. 298 + T20 bei 301 → 244). Kein Gewinn."
              : "Normal: Überwerfen oder ungültiger Out beendet die Aufnahme – Score wie zu Beginn der Aufnahme (wie x01-Bust)."}
          </p>
          <p className="mt-2 text-sm text-slate-400">Eingabe nur Dart für Dart – damit Knock-offs sofort greifen.</p>
        </section>
      )}

      {config.gameType === "clock" && (
        <section className="mb-6 rounded-3xl bg-ink-800 p-5">
          <h2 className="mb-3 text-xs uppercase tracking-[0.25em] text-slate-400">Around the Clock</h2>
          <div className="flex flex-wrap gap-2">
            {(["any", "double", "triple"] as const).map((mode) => (
              <Chip
                key={mode}
                active={config.clock.requireMode === mode}
                onClick={() => onChange({ ...config, clock: { requireMode: mode } })}
              >
                {mode === "any" ? "Jedes Segment" : mode === "double" ? "Nur Doubles" : "Nur Triples"}
              </Chip>
            ))}
          </div>
        </section>
      )}

      {config.gameType === "shanghai" && (
        <section className="mb-8 rounded-3xl bg-ink-800 p-5">
          <h2 className="mb-3 text-xs uppercase tracking-[0.25em] text-slate-400">Shanghai</h2>
          <label className="mb-4 block">
            <span className="text-sm text-slate-400">Letzte Zahl (Standard 7)</span>
            <input
              type="number"
              min={1}
              max={20}
              value={config.shanghai.endNumber}
              onChange={(e) => onChange({ ...config, shanghai: { ...config.shanghai, endNumber: Number(e.target.value) || 7 } })}
              className="mt-1 min-h-touch w-full rounded-2xl bg-ink-950 px-4"
            />
          </label>
          <Chip
            active={config.shanghai.shanghaiWins}
            onClick={() => onChange({ ...config, shanghai: { ...config.shanghai, shanghaiWins: !config.shanghai.shanghaiWins } })}
          >
            {config.shanghai.shanghaiWins ? "Shanghai (S+D+T) gewinnt sofort" : "Shanghai zählt nur Punkte"}
          </Chip>
          <p className="mt-3 text-sm text-slate-400">
            Immer nach oben: nur die aktuelle Zahl zählt, danach die nächste (S6, T7, D8 in einer Aufnahme ist möglich).
            Single + Double + Triple in einer Aufnahme (beliebige Zahlen der Folge) gewinnt sofort. Nach 7 Runden ohne
            Shanghai entscheidet die höchste Punktzahl – bei Gleichstand wird weitergespielt, bis jemand führt.
          </p>
        </section>
      )}

      <button
        className="mb-8 min-h-kiosk w-full rounded-3xl bg-amber-glow font-display text-3xl text-ink-950 disabled:opacity-50"
        disabled={!ready}
        onClick={onStart}
      >
        Match starten
      </button>
    </div>
  );
}
