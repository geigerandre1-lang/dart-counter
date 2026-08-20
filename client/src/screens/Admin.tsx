import { formatPlayerPassLabel, isTrainingTeam } from "@shared/index";
import { useEffect, useState } from "react";
import MatchReportTable from "../components/MatchReportTable";
import {
  assignPlayerTeamApi,
  createPlayer,
  createTeamPlayerApi,
  deletePlayerApi,
  deleteRoomApi,
  downloadText,
  exportStatsApi,
  fetchHeadToHead,
  fetchPlayers,
  fetchRooms,
  fetchSpieltag,
  fetchSpieltage,
  fetchTeams,
  importRosterApi,
  mutateTeam,
  rebuildTodaySpieltag,
  removePlayerFromTeamApi,
  resetStatsApi,
  spieltagCsv,
  spieltagLabel,
  startNewSpieltag,
  type HeadToHeadRow,
  type RegisteredPlayer,
  type RoomInfo,
  type SpieltagDetail,
  type SpieltagListItem,
  type TeamTree,
} from "../lib/statsApi";

function MatchReportCard({ report }: { report: SpieltagDetail["reports"][number] }) {
  const teams = [...new Set(report.payload.players.map((p) => p.teamName).filter(Boolean))];
  const endstand = report.payload.endstand || report.payload.scoreline;
  const headline =
    report.payload.headline ||
    `Spiel ${report.payload.matchNumber ?? 1} — ${report.payload.players.map((p) => formatPlayerPassLabel(p)).join(" vs ")}`;
  const meta = [
    new Date(report.playedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }),
    report.boardName ?? "Scheibe",
    teams.join(" vs "),
    report.payload.dartsThrown ? `${report.payload.dartsThrown} Darts` : "",
    report.payload.checkout != null ? `Checkout ${report.payload.checkout}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="rounded-xl bg-ink-800 p-3 text-sm">
      <MatchReportTable
        headline={headline}
        endstand={endstand || "–"}
        players={report.payload.players}
        legs={report.payload.legs ?? []}
        meta={meta}
      />
    </div>
  );
}

function TeamAdminBlock({
  team,
  apiBase,
  token,
  origin,
  onChanged,
  onError,
}: {
  team: TeamTree;
  apiBase: string;
  token: string | null;
  origin: string | null;
  onChanged: () => void;
  onError: (message: string | null) => void;
}) {
  const desktop = window.steeldartDesktop;
  const [playerName, setPlayerName] = useState("");
  const [playerPassNr, setPlayerPassNr] = useState("");

  const removePlayer = (playerId: string) => {
    void removePlayerFromTeamApi(playerId, team.id, apiBase, token, desktop, origin).then((result) => {
      if (!result.ok) {
        onError(result.error || "Spieler konnte nicht entfernt werden.");
        return;
      }
      if (result.warning) onError(result.warning);
      else onError(null);
      onChanged();
    });
  };

  return (
    <div className="rounded-2xl bg-ink-950 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1 font-display text-2xl">{team.name}</div>
        <button
          type="button"
          className="text-xs font-bold text-slate-400"
          onClick={() => {
            const next = prompt("Team umbenennen", team.name);
            if (!next) return;
            void mutateTeam("rename", apiBase, token, { id: team.id, name: next }, desktop, origin).then(() =>
              onChanged(),
            );
          }}
        >
          Umbenennen
        </button>
        {!(team.builtIn || isTrainingTeam(team)) && (
          <button
            type="button"
            className="text-xs font-bold text-crimson"
            onClick={() => {
              if (!confirm(`${team.name} löschen? Spieler bleiben erhalten.`)) return;
              void mutateTeam("delete", apiBase, token, { id: team.id }, desktop, origin).then(() => onChanged());
            }}
          >
            Löschen
          </button>
        )}
      </div>

      <div className="mt-3 grid gap-1">
        {team.players.length === 0 && <div className="text-sm text-slate-400">Keine Spieler</div>}
        {team.players.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1 text-slate-200">{formatPlayerPassLabel(p)}</span>
            <button type="button" className="text-xs font-bold text-crimson" onClick={() => removePlayer(p.id)}>
              Entfernen
            </button>
          </div>
        ))}
      </div>

      <form
        className="mt-3 grid gap-2 sm:grid-cols-[1fr_11rem_auto]"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!playerName.trim()) return;
          void createTeamPlayerApi(
            team.id,
            playerName,
            apiBase,
            token,
            desktop,
            origin,
            playerPassNr.trim() || null,
          ).then((result) => {
            if (!result.ok) {
              onError(result.error);
              return;
            }
            setPlayerName("");
            setPlayerPassNr("");
            onError(null);
            onChanged();
          });
        }}
      >
        <input
          value={playerName}
          onChange={(e) => setPlayerName(e.target.value)}
          placeholder="Spieler hinzufügen"
          className="min-h-touch rounded-2xl bg-ink-800 px-3 text-sm"
          autoComplete="off"
          required={false}
        />
        <input
          value={playerPassNr}
          onChange={(e) => setPlayerPassNr(e.target.value)}
          placeholder="Spielernummer/PassNr (optional)"
          className="min-h-touch rounded-2xl bg-ink-800 px-3 text-sm"
          autoComplete="off"
          required={false}
        />
        <button
          type="submit"
          disabled={!playerName.trim()}
          className="min-h-touch rounded-2xl bg-ink-800 px-3 text-sm font-bold disabled:opacity-50"
        >
          Hinzufügen
        </button>
      </form>
    </div>
  );
}

interface Props {
  apiBase: string;
  origin: string | null;
  token: string | null;
  showRooms: boolean;
  savedRemoteUrl: string;
  offlinePort: number;
  boardId?: string;
  boardName?: string;
  desktopSettings: boolean;
  adminPasswordSet?: boolean;
  onSettingsSaved?: (state: {
    savedRemoteUrl: string;
    offlinePort: number;
    onlineConfigured?: boolean;
    boardId?: string;
    boardName?: string;
    adminPasswordSet?: boolean;
  }) => void;
  onLogout: () => void;
}

export default function Admin({
  apiBase,
  origin,
  token,
  showRooms,
  savedRemoteUrl,
  offlinePort,
  boardId = "",
  boardName = "Scheibe 1",
  desktopSettings,
  adminPasswordSet = false,
  onSettingsSaved,
  onLogout,
}: Props) {
  const desktop = window.steeldartDesktop;
  const [players, setPlayers] = useState<RegisteredPlayer[]>([]);
  const [rooms, setRooms] = useState<RoomInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [passNr, setPassNr] = useState("");
  const [csvText, setCsvText] = useState("");
  const [csvSummary, setCsvSummary] = useState<string | null>(null);
  const [url, setUrl] = useState(savedRemoteUrl);
  const [adminPassword, setAdminPassword] = useState("");
  const [passwordSaved, setPasswordSaved] = useState(adminPasswordSet);
  const [port, setPort] = useState(String(offlinePort || 3000));
  const [boardLabel, setBoardLabel] = useState(boardName);
  const [busy, setBusy] = useState(false);
  const [teams, setTeams] = useState<TeamTree[]>([]);
  const [teamName, setTeamName] = useState("");
  const [spieltage, setSpieltage] = useState<SpieltagListItem[]>([]);
  const [openDay, setOpenDay] = useState<SpieltagDetail | null>(null);
  const [headToHead, setHeadToHead] = useState<HeadToHeadRow[]>([]);

  const load = async () => {
    try {
      setPlayers(await fetchPlayers(apiBase, desktop, origin));
      setTeams(await fetchTeams(apiBase, desktop, origin));
      setSpieltage(await fetchSpieltage(apiBase, desktop, origin));
      setHeadToHead(await fetchHeadToHead(apiBase, token, desktop, origin));
      if (showRooms && token) setRooms(await fetchRooms(apiBase, token));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Admin-Daten konnten nicht geladen werden.");
    }
  };

  useEffect(() => {
    void load();
  }, [apiBase, origin, showRooms, token]);

  useEffect(() => {
    setUrl(savedRemoteUrl);
    setPort(String(offlinePort || 3000));
    setBoardLabel(boardName);
    setPasswordSaved(adminPasswordSet);
  }, [savedRemoteUrl, offlinePort, boardName, adminPasswordSet]);

  const saveDesktop = async () => {
    if (!desktop?.saveSettings) return;
    setBusy(true);
    const result = await desktop.saveSettings({
      remoteUrl: url.trim(),
      offlinePort: Number(port) || 3000,
      boardName: boardLabel.trim() || "Scheibe 1",
      adminPassword: adminPassword.trim() || undefined,
    });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (adminPassword.trim()) setAdminPassword("");
    setPasswordSaved(Boolean((result.state.adminPasswordSet ?? passwordSaved) || adminPassword.trim()));
    onSettingsSaved?.({
      savedRemoteUrl: result.state.savedRemoteUrl,
      offlinePort: result.state.offlinePort,
      onlineConfigured: result.state.onlineConfigured,
      boardId: result.state.boardId,
      boardName: result.state.boardName,
      adminPasswordSet: result.state.adminPasswordSet,
    });
  };

  const addPlayer = async () => {
    const result = await createPlayer(name, apiBase, desktop, origin, passNr.trim() || null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setName("");
    setPassNr("");
    await load();
  };

  return (
    <div className="safe-pad mx-auto min-h-[70dvh] max-w-4xl px-4 py-6">
      <div className="flex items-start justify-between gap-3">
        <h1 className="font-display text-4xl">Admin</h1>
        <button type="button" className="text-sm text-slate-400 underline" onClick={onLogout}>
          Abmelden
        </button>
      </div>

      {error && <div className="mt-4 rounded-2xl bg-crimson/20 px-4 py-3 text-crimson">{error}</div>}

      {desktopSettings && (
        <section className="mt-6 rounded-3xl bg-ink-800 p-5">
          <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Desktop-Einstellungen</h2>
          <label className="mt-4 block text-sm text-slate-400">Online-Server-URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://dart.example.com"
            className="mt-1 min-h-touch w-full rounded-2xl bg-ink-950 px-4 outline-none ring-amber-glow/40 focus:ring"
          />
          <p className="mt-2 text-xs text-slate-500">
            Ohne URL bleibt Online auf dem Startbildschirm verborgen. Leeres Feld löscht die URL.
          </p>
          <label className="mt-4 block text-sm text-slate-400">Admin-Passwort (Webserver)</label>
          <input
            type="password"
            value={adminPassword}
            onChange={(e) => setAdminPassword(e.target.value)}
            placeholder={passwordSaved ? "gespeichert — neu eingeben zum Ändern" : "wie STEELDART_ADMIN_PASSWORD"}
            autoComplete="new-password"
            className="mt-1 min-h-touch w-full rounded-2xl bg-ink-950 px-4 outline-none ring-amber-glow/40 focus:ring"
          />
          <p className="mt-2 text-xs text-slate-500">
            Dasselbe Passwort wie auf Hostinger. Die Desktop-App eröffnet damit automatisch einen Raum.
          </p>
          <label className="mt-4 block text-sm text-slate-400">Offline-Port</label>
          <input
            type="number"
            min={1}
            max={65535}
            value={port}
            onChange={(e) => setPort(e.target.value)}
            className="mt-1 min-h-touch w-full rounded-2xl bg-ink-950 px-4"
          />
          <p className="mt-2 text-xs text-slate-500">
            Standard 3000. Gilt beim nächsten Offline-Start.
            {origin ? ` Aktueller Server: ${origin}` : ""}
          </p>
          <label className="mt-4 block text-sm text-slate-400">Anlagen-Name</label>
          <input
            value={boardLabel}
            onChange={(e) => setBoardLabel(e.target.value)}
            className="mt-1 min-h-touch w-full rounded-2xl bg-ink-950 px-4"
          />
          <div className="mt-3 rounded-2xl bg-ink-950 px-4 py-3 text-sm">
            <div className="text-xs uppercase tracking-widest text-slate-500">Eindeutige ID</div>
            <div className="mt-1 break-all font-mono text-amber-glow">{boardId || "wird erzeugt"}</div>
            <button
              type="button"
              className="mt-2 text-xs font-bold text-slate-400"
              onClick={() => {
                void navigator.clipboard?.writeText(boardId);
              }}
            >
              Kopieren
            </button>
            <button
              type="button"
              className="ml-3 text-xs font-bold text-crimson"
              onClick={() => {
                if (!confirm("Neue Anlagen-ID erzeugen? Alte Berichte bleiben der bisherigen ID zugeordnet.")) return;
                void desktop?.saveSettings?.({ resetBoard: true, boardName: boardLabel }).then((result) => {
                  if (result && "ok" in result && result.ok) {
                    onSettingsSaved?.({
                      savedRemoteUrl: result.state.savedRemoteUrl,
                      offlinePort: result.state.offlinePort,
                      onlineConfigured: result.state.onlineConfigured,
                      boardId: result.state.boardId,
                      boardName: result.state.boardName,
                    });
                  }
                });
              }}
            >
              ID zurücksetzen
            </button>
          </div>
          <button
            type="button"
            disabled={busy}
            className="mt-4 min-h-touch w-full rounded-2xl bg-amber-glow font-bold text-ink-950"
            onClick={() => void saveDesktop()}
          >
            Speichern
          </button>
        </section>
      )}

      <section className="mt-6 rounded-3xl bg-ink-800 p-5">
        <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Teams → Spieler</h2>
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!teamName.trim()) return;
            void mutateTeam("create", apiBase, token, { name: teamName }, desktop, origin).then(() => {
              setTeamName("");
              void load();
            });
          }}
        >
          <input
            value={teamName}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="Team anlegen (z. B. 1. Mannschaft)"
            className="min-h-touch flex-1 rounded-2xl bg-ink-950 px-4"
          />
          <button type="submit" className="min-h-touch rounded-2xl bg-amber-glow px-4 font-bold text-ink-950">
            Anlegen
          </button>
        </form>
        <div className="mt-4 grid gap-3">
          {teams.length === 0 && !error && (
            <p className="text-sm text-slate-500">Noch keine Teams. Ein leeres Team kann trotzdem Spieler aufnehmen.</p>
          )}
          {teams.map((team) => (
            <TeamAdminBlock
              key={team.id}
              team={team}
              apiBase={apiBase}
              token={token}
              origin={origin}
              onChanged={() => void load()}
              onError={setError}
            />
          ))}
        </div>
        <div className="mt-5 rounded-2xl bg-ink-950 p-4">
          <div className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">CSV-Import</div>
          <p className="mt-2 text-sm text-slate-400">
            Semikolon, UTF-8. Kopfzeile <span className="font-mono text-slate-300">TEAM;PassNr;Name</span>. PassNr darf
            leer bleiben. Leere Zeilen werden übersprungen.
          </p>
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="mt-3 block w-full text-sm text-slate-400 file:mr-3 file:rounded-xl file:border-0 file:bg-ink-800 file:px-3 file:py-2 file:font-bold file:text-white"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void file.text().then((text) => setCsvText(text));
            }}
          />
          <textarea
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            placeholder={"TEAM;PassNr;Name\nTraining;;Max\n1. Mannschaft;12345;Andre"}
            rows={5}
            className="mt-3 w-full rounded-2xl bg-ink-800 px-4 py-3 font-mono text-sm"
          />
          <button
            type="button"
            className="mt-3 min-h-touch rounded-2xl bg-amber-glow px-4 font-bold text-ink-950"
            onClick={() => {
              if (!csvText.trim()) return;
              void importRosterApi(csvText, apiBase, token, desktop, origin).then((result) => {
                setCsvSummary(result.summary);
                if (result.errors.length) setError(result.errors.join(" "));
                else setError(null);
                void load();
              });
            }}
          >
            CSV importieren
          </button>
          {csvSummary && <p className="mt-2 text-sm text-slate-300">{csvSummary}</p>}
        </div>
      </section>

      <section className="mt-6 rounded-3xl bg-ink-800 p-5">
        <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Spieltage</h2>
        <p className="mt-2 text-sm text-slate-400">
          Ein Tagesbericht entsteht automatisch, wenn mindestens ein Spieler einer anderen Mannschaft als Training
          mitspielt. Rein lokale Spiele und Training (gegen Training oder ohne andere Mannschaft) kommen nicht in den
          Tagesbericht. Über „Tagesbericht erstellen“ kannst du einen Spieltag für Vereinstage manuell anlegen. Alte
          Tage bleiben erhalten. Ein Reset schließt den aktuellen Spieltag und startet einen neuen – auch am selben
          Kalendertag.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="min-h-touch rounded-2xl bg-amber-glow px-4 font-bold text-ink-950"
            onClick={() => {
              void rebuildTodaySpieltag(apiBase, token, desktop, origin)
                .then((day) => {
                  if (day) setOpenDay(day);
                  void load();
                })
                .catch((err) => setError(err instanceof Error ? err.message : "Tagesbericht konnte nicht erstellt werden."));
            }}
          >
            Tagesbericht erstellen / aktualisieren
          </button>
          <button
            type="button"
            className="min-h-touch rounded-2xl bg-ink-700 px-4 font-bold"
            onClick={() => {
              if (
                !confirm(
                  "Aktuellen Tagesbericht schließen und einen neuen Spieltag jetzt beginnen? Der bisherige bleibt in der Historie.",
                )
              ) {
                return;
              }
              void startNewSpieltag(apiBase, token, desktop, origin)
                .then((day) => {
                  if (day) setOpenDay(day);
                  void load();
                })
                .catch((err) => setError(err instanceof Error ? err.message : "Spieltag konnte nicht zurückgesetzt werden."));
            }}
          >
            Tagesbericht zurücksetzen / neuen Spieltag beginnen
          </button>
        </div>
        <div className="mt-4 grid gap-2">
          {spieltage.length === 0 && !error && <p className="text-sm text-slate-500">Noch keine Spieltage.</p>}
          {spieltage.map((day) => (
            <button
              key={day.id}
              type="button"
              className="rounded-2xl bg-ink-950 px-4 py-3 text-left"
              onClick={() =>
                void fetchSpieltag(day.id, apiBase, desktop, origin)
                  .then(setOpenDay)
                  .catch((err) => setError(err instanceof Error ? err.message : "Spielbericht konnte nicht geladen werden."))
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
          <div className="mt-4 rounded-2xl bg-ink-950 p-4">
            <div className="font-display text-2xl">Spieltag {spieltagLabel(openDay)}</div>
            <div className="mt-2 grid gap-2">
              {openDay.reports.map((report) => (
                <MatchReportCard key={report.id} report={report} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="min-h-touch flex-1 rounded-2xl bg-ink-700 font-bold"
                onClick={() =>
                  downloadText(`spieltag-${openDay.dateKey}-${openDay.startedAt}.html`, openDay.html, "text/html")
                }
              >
                HTML
              </button>
              <button
                type="button"
                className="min-h-touch flex-1 rounded-2xl bg-ink-700 font-bold"
                onClick={() =>
                  downloadText(
                    `spieltag-${openDay.dateKey}-${openDay.startedAt}.json`,
                    JSON.stringify(openDay, null, 2),
                    "application/json",
                  )
                }
              >
                JSON
              </button>
              <button
                type="button"
                className="min-h-touch flex-1 rounded-2xl bg-ink-700 font-bold"
                onClick={() =>
                  downloadText(
                    `spieltag-${openDay.dateKey}-${openDay.startedAt}.csv`,
                    spieltagCsv(openDay),
                    "text/csv;charset=utf-8",
                  )
                }
              >
                CSV
              </button>
              <button type="button" className="min-h-touch rounded-2xl bg-ink-800 px-4" onClick={() => setOpenDay(null)}>
                Schließen
              </button>
            </div>
          </div>
        )}
      </section>

      {headToHead.length > 0 && (
        <section className="mt-6 rounded-3xl bg-ink-800 p-5">
          <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Wer gegen wen</h2>
          <div className="mt-3 grid gap-2">
            {headToHead.map((row) => (
              <div key={`${row.winnerId}-${row.loserId}`} className="rounded-2xl bg-ink-950 px-4 py-2 text-sm">
                <span className="font-bold text-amber-glow">{row.winnerName}</span> hat gegen {row.loserName}{" "}
                <span className="font-bold">{row.wins}×</span> gewonnen
              </div>
            ))}
          </div>
        </section>
      )}

      {showRooms && (
        <section className="mt-6 rounded-3xl bg-ink-800 p-5">
          <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Semi-Offline-Räume</h2>
          <p className="mt-2 text-sm text-slate-400">Maximal 4 Räume. Löschen gibt einen Platz frei.</p>
          <div className="mt-4 grid gap-2">
            {rooms.length === 0 && <p className="text-sm text-slate-500">Keine Räume aktiv.</p>}
            {rooms.map((room) => (
              <div key={room.code} className="flex min-h-touch items-center gap-3 rounded-2xl bg-ink-950 px-4">
                <div className="flex-1">
                  <div className="font-mono text-xl text-amber-glow">{room.code}</div>
                  <div className="text-xs text-slate-400">
                    {room.phase} · {room.occupancy} verbunden
                    {room.status ? ` · ${room.status}` : ""}
                  </div>
                </div>
                <button
                  type="button"
                  className="text-sm font-bold text-crimson"
                  onClick={() => {
                    if (!confirm(`Raum ${room.code} löschen?`)) return;
                    void deleteRoomApi(room.code, apiBase, token).then(() => load());
                  }}
                >
                  Löschen
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="mt-6 rounded-3xl bg-ink-800 p-5">
        <h2 className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Spieler &amp; Statistik</h2>
        <form
          className="mt-4 flex flex-wrap gap-2"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) void addPlayer();
          }}
        >
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Spieler anlegen"
            className="min-h-touch min-w-[10rem] flex-1 rounded-2xl bg-ink-950 px-4"
            autoComplete="off"
            required={false}
          />
          <input
            value={passNr}
            onChange={(e) => setPassNr(e.target.value)}
            placeholder="Spielernummer/PassNr (optional)"
            className="min-h-touch w-44 rounded-2xl bg-ink-950 px-4"
            autoComplete="off"
            required={false}
          />
          <button
            type="submit"
            disabled={!name.trim()}
            className="min-h-touch rounded-2xl bg-amber-glow px-4 font-bold text-ink-950 disabled:opacity-50"
          >
            Anlegen
          </button>
        </form>
        <div className="mt-4 grid gap-2">
          {players.map((player) => (
            <div key={player.id} className="flex flex-wrap items-center gap-2 rounded-2xl bg-ink-950 px-4 py-3">
              <div className="min-w-0 flex-1 font-bold">
                {formatPlayerPassLabel(player)}
                {player.teamName ? (
                  <span className="ml-2 text-xs font-normal text-slate-400">{player.teamName}</span>
                ) : null}
              </div>
              <button
                type="button"
                className="text-xs font-bold text-slate-500"
                onClick={() => {
                  if (!player.teamId) return;
                  void assignPlayerTeamApi(player.id, null, apiBase, token, desktop, origin).then(() => load());
                }}
              >
                Team lösen
              </button>
              <button
                type="button"
                className="text-xs font-bold text-slate-400"
                onClick={() => {
                  if (!confirm(`Statistik von ${player.name} zurücksetzen? Spieler bleibt erhalten.`)) return;
                  void resetStatsApi(player.id, apiBase, token, desktop, origin).then(() => load());
                }}
              >
                Stats reset
              </button>
              <button
                type="button"
                className="text-xs font-bold text-crimson"
                onClick={() => {
                  if (!confirm(`${player.name} löschen? Statistik wird mitgelöscht.`)) return;
                  void deletePlayerApi(player.id, apiBase, token, desktop, origin).then(() => load());
                }}
              >
                Löschen
              </button>
            </div>
          ))}
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            className="min-h-touch rounded-2xl bg-ink-700 font-bold"
            onClick={async () => {
              const result = await exportStatsApi("json", apiBase, token, desktop, origin);
              if (result.format === "json") {
                downloadText("steeldart-statistik.json", JSON.stringify(result.data, null, 2), "application/json");
              }
            }}
          >
            Export JSON
          </button>
          <button
            type="button"
            className="min-h-touch rounded-2xl bg-ink-700 font-bold"
            onClick={async () => {
              const result = await exportStatsApi("csv", apiBase, token, desktop, origin);
              if (result.format === "csv") {
                downloadText("steeldart-statistik.csv", result.csv, "text/csv;charset=utf-8");
              }
            }}
          >
            Export CSV
          </button>
          <button
            type="button"
            className="min-h-touch rounded-2xl bg-crimson font-bold text-white"
            onClick={() => {
              if (!confirm("Alle Statistiken und Match-Analysen löschen? Spieler und Spieltage bleiben erhalten.")) return;
              void resetStatsApi(undefined, apiBase, token, desktop, origin).then(() => load());
            }}
          >
            Alle Stats reset
          </button>
        </div>
      </section>
    </div>
  );
}
