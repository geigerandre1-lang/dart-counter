import { useState } from "react";
import { saveAdminToken } from "../lib/adminSession";

interface Props {
  savedRemoteUrl: string;
  lastMode?: "offline" | "online";
  busy?: boolean;
  error?: string | null;
  onlineConfigured: boolean;
  onOffline: () => void;
  onOnline: () => void;
  onAdminToken?: (token: string | null) => void;
}

export default function DesktopGate({
  lastMode = "offline",
  busy,
  error,
  onlineConfigured,
  onOffline,
  onOnline,
  onAdminToken,
}: Props) {
  const [adminOpen, setAdminOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const showOnline = onlineConfigured;

  const login = async () => {
    const desktop = window.steeldartDesktop;
    if (!desktop?.adminLogin) {
      setAdminError("Admin-Login nur in der Desktop-App.");
      return;
    }
    setAdminBusy(true);
    setAdminError(null);
    const result = await desktop.adminLogin(password);
    setAdminBusy(false);
    if (!result.ok) {
      setAdminError(result.error);
      return;
    }
    saveAdminToken(result.token);
    onAdminToken?.(result.token);
    setPassword("");
    setAdminOpen(false);
  };

  return (
    <div className="relative mx-auto flex min-h-[70dvh] max-w-3xl flex-col justify-center gap-8 px-4 py-6">
      <header className="text-center">
        <div className="text-xs uppercase tracking-[0.45em] text-amber-glow">Steeldart</div>
        <h1 className="mt-2 font-display text-6xl text-white sm:text-7xl">Dart-Counter</h1>
        <p className="mt-3 text-slate-400">Spielstand lebt auf dem Server — diese App ist der Client.</p>
      </header>

      <div className="grid gap-4">
        <button
          className="rounded-3xl bg-crimson px-6 py-7 text-left text-white disabled:opacity-60"
          disabled={busy}
          onClick={onOffline}
        >
          <div className="text-xs font-bold uppercase tracking-[0.25em]">Offline</div>
          <div className="mt-1 font-display text-4xl">Lokaler Server</div>
          <p className="mt-2 text-sm text-white/80">
            Startet den Server auf diesem Gerät. Handys öffnen die LAN-IP — gleiches Spiel, ohne Raum-ID.
          </p>
        </button>

        {showOnline && (
          <button
            type="button"
            className="rounded-3xl border border-white/10 bg-ink-800 p-6 text-left disabled:opacity-60"
            disabled={busy}
            onClick={onOnline}
          >
            <div className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Online</div>
            <div className="mt-1 font-display text-3xl text-white">Webserver</div>
            <p className="mt-2 text-sm text-slate-400">
              Verbindung zum konfigurierten Webserver. Raum erstellen oder mit Raum-ID beitreten.
              {lastMode === "online" ? " Zuletzt Online genutzt." : ""}
            </p>
          </button>
        )}
      </div>

      {(error || adminError) && (
        <div className="rounded-2xl bg-crimson/20 px-4 py-3 text-center text-crimson">{adminError || error}</div>
      )}

      <div className="absolute bottom-4 right-4 text-right">
        {!adminOpen ? (
          <button
            type="button"
            className="text-[11px] tracking-wide text-slate-600 underline decoration-slate-700 underline-offset-4 hover:text-slate-400"
            onClick={() => {
              setAdminOpen(true);
              setAdminError(null);
            }}
          >
            Admin
          </button>
        ) : (
          <form
            className="w-56 rounded-2xl border border-white/10 bg-ink-900/95 p-3 text-left"
            onSubmit={(e) => {
              e.preventDefault();
              void login();
            }}
          >
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-slate-500">Admin-Login</div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Passwort"
              autoComplete="current-password"
              className="mt-2 min-h-touch w-full rounded-xl bg-ink-950 px-3 text-sm outline-none ring-amber-glow/40 focus:ring"
            />
            <div className="mt-2 flex gap-2">
              <button
                type="submit"
                disabled={adminBusy || !password}
                className="min-h-touch flex-1 rounded-xl bg-ink-700 text-xs font-bold disabled:opacity-50"
              >
                Login
              </button>
              <button
                type="button"
                className="min-h-touch rounded-xl px-3 text-xs text-slate-500"
                onClick={() => {
                  setAdminOpen(false);
                  setAdminError(null);
                  setPassword("");
                }}
              >
                Abbrechen
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
