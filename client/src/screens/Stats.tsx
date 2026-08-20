import { AVERAGE_RULE_DE, formatAverage, formatPlayerPassLabel } from "@shared/index";
import { useEffect, useState } from "react";
import MatchReportTable from "../components/MatchReportTable";
import StatGrid from "../components/StatGrid";
import { GAME_LABELS } from "../lib/labels";
import {
  createPlayer,
  downloadText,
  fetchSpieltag,
  fetchSpieltage,
  fetchStats,
  spieltagCsv,
  spieltagLabel,
  type PlayerStatsView,
  type SpieltagDetail,
  type SpieltagListItem,
} from "../lib/statsApi";

interface Props {
  apiBase: string;
  origin: string | null;
}

export default function Stats({ apiBase, origin }: Props) {
  const desktop = window.steeldartDesktop;
  const [rows, setRows] = useState<PlayerStatsView[]>([]);
  const [rule, setRule] = useState(AVERAGE_RULE_DE);
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [spieltage, setSpieltage] = useState<SpieltagListItem[]>([]);
  const [openDay, setOpenDay] = useState<SpieltagDetail | null>(null);

  const load = async () => {
    try {
      const data = await fetchStats(apiBase, desktop, origin);
      setRows(data.players ?? []);
      if (data.rule) setRule(data.rule);
      const days = data.spieltage ?? (await fetchSpieltage(apiBase, desktop, origin));
      setSpieltage(days);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Statistiken konnten nicht geladen werden.");
    }
  };

  useEffect(() => {
    void load();
  }, [apiBase, origin]);

  const addPlayer = async () => {
    setBusy(true);
    const result = await createPlayer(name, apiBase, desktop, origin);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    await load();
  };

  return (
    <div className="safe-pad mx-auto min-h-[70dvh] max-w-4xl px-4 py-6">
      <h1 className="font-display text-4xl">Statistiken</h1>
      <p className="mt-2 text-sm text-slate-400">{rule}</p>

      <form
        className="mt-5 flex gap-2"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) void addPlayer();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Neuen Spieler anlegen"
          className="min-h-touch flex-1 rounded-2xl bg-ink-800 px-4 outline-none ring-amber-glow/30 focus:ring"
        />
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="min-h-touch rounded-2xl bg-amber-glow px-5 font-bold text-ink-950 disabled:opacity-50"
        >
          Anlegen
        </button>
      </form>

      {error && <div className="mt-4 rounded-2xl bg-crimson/20 px-4 py-3 text-crimson">{error}</div>}

      <section className="mt-8">
        <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Spieltage</h2>
        <p className="mt-2 text-sm text-slate-400">Vergangene Tage bleiben gespeichert und können jederzeit geöffnet werden.</p>
        <div className="mt-3 grid gap-2">
          {spieltage.length === 0 && !error && <p className="text-sm text-slate-500">Noch keine Spieltage.</p>}
          {spieltage.map((day) => (
            <button
              key={day.id}
              type="button"
              className="rounded-2xl bg-ink-800 px-4 py-3 text-left"
              onClick={() =>
                void fetchSpieltag(day.id, apiBase, desktop, origin)
                  .then(setOpenDay)
                  .catch((err) =>
                    setError(err instanceof Error ? err.message : "Spielbericht konnte nicht geladen werden."),
                  )
              }
            >
              <div className="font-bold">{spieltagLabel(day)}</div>
              <div className="text-sm text-slate-400">
                {day.matchCount} Spiele · {day.roomCount} Räume
              </div>
              <div className="mt-1 text-sm text-slate-300">{day.summary}</div>
            </button>
          ))}
        </div>
        {openDay && (
          <div className="mt-4 rounded-2xl bg-ink-800 p-4">
            <div className="font-display text-2xl">Spieltag {spieltagLabel(openDay)}</div>
            <div className="mt-2 grid gap-2">
              {openDay.reports.map((report) => {
                const endstand = report.payload.endstand || report.payload.scoreline;
                const headline =
                  report.payload.headline ||
                  `Spiel ${report.payload.matchNumber ?? 1} — ${report.payload.players.map((p) => formatPlayerPassLabel(p)).join(" vs ")}`;
                const meta = [
                  new Date(report.playedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
                  report.boardName ?? "Scheibe",
                ]
                  .filter(Boolean)
                  .join(" · ");
                return (
                  <div key={report.id} className="rounded-xl bg-ink-950 p-3 text-sm">
                    <MatchReportTable
                      headline={headline}
                      endstand={endstand || "–"}
                      players={report.payload.players}
                      legs={report.payload.legs ?? []}
                      meta={meta}
                    />
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="min-h-touch flex-1 rounded-2xl bg-ink-700 font-bold"
                onClick={() => downloadText(`spieltag-${openDay.dateKey}.html`, openDay.html, "text/html")}
              >
                HTML
              </button>
              <button
                type="button"
                className="min-h-touch flex-1 rounded-2xl bg-ink-700 font-bold"
                onClick={() =>
                  downloadText(`spieltag-${openDay.dateKey}.json`, JSON.stringify(openDay, null, 2), "application/json")
                }
              >
                JSON
              </button>
              <button
                type="button"
                className="min-h-touch flex-1 rounded-2xl bg-ink-700 font-bold"
                onClick={() =>
                  downloadText(`spieltag-${openDay.dateKey}.csv`, spieltagCsv(openDay), "text/csv;charset=utf-8")
                }
              >
                CSV
              </button>
              <button type="button" className="min-h-touch rounded-2xl bg-ink-950 px-4" onClick={() => setOpenDay(null)}>
                Schließen
              </button>
            </div>
          </div>
        )}
      </section>

      <div className="mt-6 grid gap-3">
        {rows.length === 0 && !error && <p className="text-slate-400">Noch keine Spieler in der Statistik.</p>}
        {rows.map((row) => {
          const expanded = open === row.player.id;
          return (
            <div key={row.player.id} className="rounded-3xl bg-ink-800 p-4">
              <button type="button" className="w-full text-left" onClick={() => setOpen(expanded ? null : row.player.id)}>
                <div className="flex items-center justify-between gap-3">
                  <div className="font-display text-2xl">
                    {row.player.name}
                    {row.player.teamName ? (
                      <span className="ml-2 text-sm font-normal text-slate-400">{row.player.teamName}</span>
                    ) : null}
                  </div>
                  <div className="text-sm text-amber-glow">{formatAverage(row.lifetime.average)} Avg</div>
                </div>
                <StatGrid stats={row.lifetime} />
                <div className="mt-1 text-xs text-slate-500">
                  {row.lifetime.matches} Matches · {row.analyses.length} Analysen
                </div>
              </button>
              {expanded && (
                <div className="mt-4 grid gap-3 border-t border-white/10 pt-4">
                  {row.analyses.length === 0 && <p className="text-sm text-slate-400">Keine gespeicherten Match-Analysen.</p>}
                  {row.analyses.map((analysis) => (
                    <div key={analysis.id} className="rounded-2xl bg-ink-950 p-3">
                      <div className="text-xs uppercase tracking-widest text-slate-500">
                        {GAME_LABELS[analysis.gameType]} · {analysis.mode} ·{" "}
                        {new Date(analysis.playedAt).toLocaleString("de-DE")}
                      </div>
                      <div className="mt-1 text-sm text-slate-300">
                        {analysis.opponents.map((p) => p.name).join(" · ")}
                      </div>
                      {analysis.playerStats[row.player.id] && (
                        <div className="mt-2">
                          <StatGrid stats={analysis.playerStats[row.player.id]} />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
