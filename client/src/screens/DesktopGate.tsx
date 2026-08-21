import { useEffect, useState } from "react";
import { saveAdminToken } from "../lib/adminSession";

interface Props {
  savedRemoteUrl: string;
  savedAdminPassword?: string;
  lastMode?: "offline" | "online";
  busy?: boolean;
  error?: string | null;
  onlineConfigured: boolean;
  adminPasswordSet?: boolean;
  onOffline: () => void;
  onOnline: (url?: string) => void;
  onAdminToken?: (token: string | null) => void;
  onSettingsSaved?: (state: {
    savedRemoteUrl: string;
    offlinePort: number;
    onlineConfigured?: boolean;
    adminPasswordSet?: boolean;
    adminPassword?: string;
  }) => void;
}

export default function DesktopGate({
  savedRemoteUrl,
  savedAdminPassword = "",
  lastMode = "offline",
  busy,
  error,
  onlineConfigured,
  adminPasswordSet = false,
  onOffline,
  onOnline,
  onAdminToken,
  onSettingsSaved,
}: Props) {
  const [adminOpen, setAdminOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [url, setUrl] = useState(savedRemoteUrl);
  const [onlinePassword, setOnlinePassword] = useState(savedAdminPassword);
  const [savingOnline, setSavingOnline] = useState(false);
  const [onlineReachable, setOnlineReachable] = useState(false);
  const [onlineProbeDone, setOnlineProbeDone] = useState(!url.trim());
  const [offlineConfirm, setOfflineConfirm] = useState(false);
  const showOnline = onlineConfigured || url.trim().length > 0;
  const showOffline = !url.trim() || (onlineProbeDone && !onlineReachable);

  useEffect(() => {
    setUrl(savedRemoteUrl);
  }, [savedRemoteUrl]);

  useEffect(() => {
    if (savedAdminPassword) setOnlinePassword(savedAdminPassword);
  }, [savedAdminPassword]);

  useEffect(() => {
    const target = url.trim();
    if (!target) {
      setOnlineReachable(false);
      setOnlineProbeDone(true);
      return;
    }
    const desktop = window.steeldartDesktop;
    let cancelled = false;
    let interval = 0;
    setOnlineProbeDone(false);
    const probe = async () => {
      try {
        const result = desktop?.probeOnline
          ? await desktop.probeOnline(target)
          : { reachable: false };
        if (!cancelled) {
          setOnlineReachable(Boolean(result.reachable));
          setOnlineProbeDone(true);
        }
      } catch {
        if (!cancelled) {
          setOnlineReachable(false);
          setOnlineProbeDone(true);
        }
      }
    };
    const delay = window.setTimeout(() => {
      void probe();
      interval = window.setInterval(() => void probe(), 8000);
    }, 500);
    return () => {
      cancelled = true;
      window.clearTimeout(delay);
      window.clearInterval(interval);
    };
  }, [url]);

  const persistOnlineSettings = async (): Promise<boolean> => {
    const desktop = window.steeldartDesktop;
    if (!desktop?.saveSettings) return true;
    const nextUrl = url.trim();
    const nextPassword = onlinePassword.trim();
    if (!nextUrl && !savedRemoteUrl) return true;
    if (nextUrl === savedRemoteUrl.trim() && (!nextPassword || nextPassword === savedAdminPassword)) {
      return true;
    }
    setSavingOnline(true);
    const result = await desktop.saveSettings({
      remoteUrl: nextUrl,
      adminPassword: nextPassword || undefined,
    });
    setSavingOnline(false);
    if (!result.ok) {
      setAdminError(result.error);
      return false;
    }
    onSettingsSaved?.({
      savedRemoteUrl: result.state.savedRemoteUrl,
      offlinePort: result.state.offlinePort,
      onlineConfigured: result.state.onlineConfigured,
      adminPasswordSet: result.state.adminPasswordSet,
      adminPassword: result.state.adminPassword,
    });
    return true;
  };

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

  const startOnline = async () => {
    setAdminError(null);
    const saved = await persistOnlineSettings();
    if (!saved) return;
    onOnline(url.trim() || savedRemoteUrl);
  };

  return (
    <div className="relative mx-auto flex min-h-[70dvh] max-w-3xl flex-col justify-center gap-8 px-4 py-6">
      <header className="text-center">
        <div className="text-xs uppercase tracking-[0.45em] text-amber-glow">Steeldart</div>
        <h1 className="mt-2 font-display text-6xl text-white sm:text-7xl">Dart-Counter</h1>
        <p className="mt-3 text-slate-400">Spielstand lebt auf dem Server — diese App ist der Client.</p>
      </header>

      <div className="grid gap-4">
        {showOffline ? (
        <button
          className="rounded-3xl bg-crimson px-6 py-7 text-left text-white disabled:opacity-60"
          disabled={busy}
          onClick={onOffline}
        >
          <div className="text-xs font-bold uppercase tracking-[0.25em]">Offline</div>
          <div className="mt-1 font-display text-4xl">Lokaler Server</div>
          <p className="mt-2 text-sm text-white/80">
            {url.trim()
              ? "Webserver nicht erreichbar. Startet den Server auf diesem Gerät."
              : "Startet den Server auf diesem Gerät. Handys öffnen die LAN-IP — gleiches Spiel, ohne Raum-ID."}
          </p>
        </button>
        ) : (
          <p className="rounded-2xl border border-amber-glow/20 bg-ink-800 px-4 py-3 text-sm text-slate-400">
            Online-Server erreichbar — Offline-Modus ist ausgeblendet.
          </p>
        )}

        <div className="rounded-3xl border border-white/10 bg-ink-800 p-6 text-left">
          <div className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Online</div>
          <div className="mt-1 font-display text-3xl text-white">Webserver</div>
          <p className="mt-2 text-sm text-slate-400">
            Webserver-URL und Online-Passwort (Hostinger) einmal speichern — dasselbe Passwort öffnet den Raum.
            {lastMode === "online" ? " Zuletzt Online genutzt." : ""}
          </p>
          <label className="mt-4 block text-sm text-slate-400">Webserver-URL</label>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://dart-counter.turniertool.eu"
            autoComplete="url"
            className="mt-1 min-h-touch w-full rounded-2xl bg-ink-950 px-4 outline-none ring-amber-glow/40 focus:ring"
          />
          <label className="mt-3 block text-sm text-slate-400">Online-Passwort</label>
          <input
            type="password"
            value={onlinePassword}
            onChange={(e) => setOnlinePassword(e.target.value)}
            placeholder={adminPasswordSet || savedAdminPassword ? "gespeichert — ändern zum Überschreiben" : "STEELDART_ADMIN_PASSWORD"}
            autoComplete="current-password"
            className="mt-1 min-h-touch w-full rounded-2xl bg-ink-950 px-4 outline-none ring-amber-glow/40 focus:ring"
          />
          <button
            type="button"
            className="mt-4 min-h-touch w-full rounded-2xl bg-amber-glow font-bold text-ink-950 disabled:opacity-60"
            disabled={busy || savingOnline || !url.trim()}
            onClick={() => void startOnline()}
          >
            {showOnline ? "Online starten" : "Speichern und Online starten"}
          </button>
        </div>
      </div>

      {(error || adminError) && (
        <div className="rounded-2xl bg-crimson/20 px-4 py-3 text-center text-crimson">{adminError || error}</div>
      )}

      <div className="absolute bottom-4 right-4 flex flex-col items-end gap-1 text-right">
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
            <p className="mt-1 text-[11px] text-slate-500">Online-Passwort oder lokales Admin-Passwort.</p>
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
        {!showOffline && (
          <button
            type="button"
            className="text-[11px] tracking-wide text-slate-600 underline decoration-slate-700 underline-offset-4 hover:text-slate-400 disabled:opacity-40"
            disabled={busy}
            onClick={() => setOfflineConfirm(true)}
          >
            Offline
          </button>
        )}
      </div>

      {offlineConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-ink-800 p-6 text-left">
            <h2 className="font-display text-3xl text-white">Offline starten?</h2>
            <p className="mt-3 text-sm text-slate-400">
              Der Online-Server ist erreichbar. Offline startet einen lokalen Server auf diesem Gerät —
              Handys sehen dann nicht den Webserver-Raum.
            </p>
            <button
              type="button"
              className="mt-6 min-h-touch w-full rounded-2xl bg-crimson font-bold text-white disabled:opacity-60"
              disabled={busy}
              onClick={() => {
                setOfflineConfirm(false);
                onOffline();
              }}
            >
              Trotzdem Offline starten
            </button>
            <button
              type="button"
              className="mt-3 min-h-touch w-full rounded-2xl bg-ink-700 font-bold text-white"
              onClick={() => setOfflineConfirm(false)}
            >
              Abbrechen
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
