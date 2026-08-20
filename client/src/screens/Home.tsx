import { useEffect, useState } from "react";
import { TOKEN_KEY } from "../lib/adminSession";

interface Props {
  onCreate: (auth: { adminToken?: string; password?: string }) => void;
  onJoin: (code: string) => void;
  error?: string | null;
  serverUrl?: string;
  apiBase?: string;
  onChangeMode?: () => void;
  onAdminToken?: (token: string | null) => void;
}

export default function Home({ onCreate, onJoin, error, serverUrl, apiBase = "", onChangeMode, onAdminToken }: Props) {
  const [code, setCode] = useState("");
  const [adminOpen, setAdminOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [adminToken, setAdminToken] = useState<string | null>(() => sessionStorage.getItem(TOKEN_KEY));
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminBusy, setAdminBusy] = useState(false);
  const [roomCount, setRoomCount] = useState<number | null>(null);
  const [maxRooms, setMaxRooms] = useState(4);

  const infoUrl = `${apiBase}/api/info`;
  const loginUrl = `${apiBase}/api/admin/login`;
  const verifyUrl = `${apiBase}/api/admin/verify`;
  const logoutUrl = `${apiBase}/api/admin/logout`;
  const full = maxRooms > 0 && roomCount != null && roomCount >= maxRooms;

  useEffect(() => {
    let cancelled = false;
    const token = sessionStorage.getItem(TOKEN_KEY);
    if (!token) return;
    void fetch(verifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((r) => {
        if (cancelled) return;
        if (!r.ok) {
          sessionStorage.removeItem(TOKEN_KEY);
          setAdminToken(null);
          onAdminToken?.(null);
          return;
        }
        setAdminToken(token);
        onAdminToken?.(token);
      })
      .catch(() => {
        if (!cancelled) {
          sessionStorage.removeItem(TOKEN_KEY);
          setAdminToken(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [verifyUrl]);

  useEffect(() => {
    if (!adminToken) return;
    let cancelled = false;
    const load = () => {
      void fetch(infoUrl)
        .then((r) => r.json())
        .then((d: { roomCount?: number; maxRooms?: number }) => {
          if (cancelled) return;
          if (typeof d.roomCount === "number") setRoomCount(d.roomCount);
          if (typeof d.maxRooms === "number") setMaxRooms(d.maxRooms);
        })
        .catch(() => undefined);
    };
    load();
    const id = window.setInterval(load, 4000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [adminToken, infoUrl]);

  const login = async () => {
    setAdminBusy(true);
    setAdminError(null);
    try {
      const res = await fetch(loginUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { ok?: boolean; token?: string; error?: string };
      if (!res.ok || !data.ok || !data.token) {
        setAdminError(data.error || "Falsches Passwort.");
        setAdminToken(null);
        sessionStorage.removeItem(TOKEN_KEY);
        return;
      }
      sessionStorage.setItem(TOKEN_KEY, data.token);
      setAdminToken(data.token);
      onAdminToken?.(data.token);
      setPassword("");
      setAdminOpen(false);
    } catch {
      setAdminError("Server nicht erreichbar.");
    } finally {
      setAdminBusy(false);
    }
  };

  const logout = () => {
    const token = adminToken;
    if (token) {
      void fetch(logoutUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      }).catch(() => undefined);
    }
    sessionStorage.removeItem(TOKEN_KEY);
    setAdminToken(null);
    onAdminToken?.(null);
    setAdminOpen(false);
    setPassword("");
    setAdminError(null);
  };

  return (
    <div className="relative safe-pad mx-auto flex min-h-[100dvh] max-w-3xl flex-col justify-center gap-8 px-4 py-10">
      <header className="text-center">
        {onChangeMode && (
          <button className="text-sm text-slate-400" onClick={onChangeMode}>
            ← Modus wechseln
          </button>
        )}
        <div className={`${onChangeMode ? "mt-3" : ""} text-xs uppercase tracking-[0.45em] text-amber-glow`}>
          Steeldart
        </div>
        <h1 className="mt-2 font-display text-6xl text-white sm:text-7xl">Dart-Counter</h1>
        <p className="mt-3 text-slate-400">
          Zum Mitspielen die Raum-ID vom Gastgeber eingeben.
          {serverUrl ? (
            <>
              <br />
              <span className="font-mono text-sm text-amber-glow">{serverUrl}</span>
            </>
          ) : null}
        </p>
      </header>

      <div className="grid gap-4">
        <form
          className="rounded-3xl border border-white/10 bg-ink-800 p-6"
          onSubmit={(e) => {
            e.preventDefault();
            if (code.trim()) onJoin(code.trim().toUpperCase());
          }}
        >
          <div className="text-xs font-bold uppercase tracking-[0.25em] text-slate-400">Raum-ID eingeben</div>
          <p className="mt-2 text-sm text-slate-400">Ohne Passwort — nur die ID des laufenden Spiels.</p>
          <div className="mt-3 flex gap-3">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="RAUM-ID"
              autoCapitalize="characters"
              autoCorrect="off"
              className="min-h-touch flex-1 rounded-2xl bg-ink-950 px-4 text-center font-display text-3xl tracking-[0.3em] outline-none ring-amber-glow/40 focus:ring"
              maxLength={6}
            />
            <button className="min-h-touch rounded-2xl bg-amber-glow px-6 font-bold text-ink-950" type="submit">
              Los
            </button>
          </div>
        </form>

        {adminToken && (
          <div className="rounded-3xl bg-crimson px-6 py-7 text-white">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs font-bold uppercase tracking-[0.25em]">Semi-Offline</div>
                <div className="mt-1 font-display text-4xl">Raum eröffnen</div>
                <p className="mt-2 text-sm text-white/80">
                  Neues Match — Raum-ID danach teilen.
                  {roomCount != null ? ` ${roomCount} / ${maxRooms} Räume belegt.` : ""}
                </p>
              </div>
              <button type="button" className="text-xs text-white/70 underline" onClick={logout}>
                Abmelden
              </button>
            </div>
            <button
              className="mt-5 min-h-touch w-full rounded-2xl bg-white font-bold text-ink-950 disabled:opacity-50"
              disabled={full}
              onClick={() => onCreate({ adminToken })}
            >
              {full ? "Keine freien Räume" : "Raum eröffnen"}
            </button>
          </div>
        )}
      </div>

      {(error || adminError) && (
        <div className="rounded-2xl bg-crimson/20 px-4 py-3 text-center text-crimson">{adminError || error}</div>
      )}

      {!adminToken && (
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
      )}
    </div>
  );
}
