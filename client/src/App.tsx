import {
  createDefaultConfig,
  isMonitorPath,
  joinUrlForSession,
  parseRoomCodeFromHref,
  type ClientAction,
  type DeployMode,
  type MatchConfig,
  type RoomSnapshot,
} from "@shared/index";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TabBar, { type AppTab } from "./components/TabBar";
import { loadAdminToken, saveAdminToken } from "./lib/adminSession";
import { discoverServerInfo } from "./lib/statsApi";
import Admin from "./screens/Admin";
import DesktopGate from "./screens/DesktopGate";
import Home from "./screens/Home";
import Match from "./screens/Match";
import Monitor from "./screens/Monitor";
import Setup from "./screens/Setup";
import Stats from "./screens/Stats";
import { playClick, playWin } from "./sound";
import { RoomSocket } from "./ws";

type Layout = "phone" | "tablet" | "kiosk";

function isFullscreenWindow(): boolean {
  return (
    window.matchMedia("(display-mode: fullscreen)").matches ||
    (screen.height > 0 && window.innerHeight >= screen.height - 32)
  );
}

function detectLayout(): Layout {
  const w = window.innerWidth;
  const h = window.innerHeight;
  const portrait = h >= w;
  if (portrait && (h >= 1600 || isFullscreenWindow() || Boolean(window.steeldartDesktop))) {
    return "kiosk";
  }
  if (!portrait && w >= 900) return "tablet";
  return "phone";
}

export default function App() {
  const desktop = window.steeldartDesktop;
  const socket = useMemo(() => new RoomSocket(), []);
  const [snap, setSnap] = useState<RoomSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lanUrls, setLanUrls] = useState<string[]>([]);
  const [mode, setMode] = useState<DeployMode | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [sound, setSound] = useState(() => localStorage.getItem("steeldart-sound") !== "off");
  const [layout, setLayout] = useState<Layout>("phone");
  const [gate, setGate] = useState(() => Boolean(desktop?.getState));
  const [gateReady, setGateReady] = useState(() => !desktop?.getState);
  const [savedRemoteUrl, setSavedRemoteUrl] = useState("");
  const [offlinePort, setOfflinePort] = useState(3000);
  const [boardId, setBoardId] = useState("");
  const [boardName, setBoardName] = useState("Scheibe 1");
  const [onlineConfigured, setOnlineConfigured] = useState(false);
  const [lastMode, setLastMode] = useState<"offline" | "online">("offline");
  const [busy, setBusy] = useState(false);
  const [offlinePrompt, setOfflinePrompt] = useState(false);
  const [resumingOnline, setResumingOnline] = useState(false);
  const [tab, setTab] = useState<AppTab>("play");
  const [adminToken, setAdminToken] = useState<string | null>(() => loadAdminToken());
  const originRef = useRef<string | null>(null);
  const prevStatus = useRef<string>("playing");
  const soundRef = useRef(sound);
  soundRef.current = sound;
  const offline = mode === "offline";
  originRef.current = origin;
  const [deepJoin, setDeepJoin] = useState(() =>
    desktop?.getState ? null : parseRoomCodeFromHref(location.search, location.pathname),
  );
  const [showMonitor] = useState(() => isMonitorPath(location.pathname));

  const applyAdminToken = (token: string | null) => {
    saveAdminToken(token);
    setAdminToken(token);
    if (!token) setTab((current) => (current === "admin" ? "play" : current));
  };

  useEffect(() => {
    const apply = () => setLayout(detectLayout());
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  const bindSocket = useCallback(() => {
    socket.onStatus = (s) => setConnected(s === "open");
    socket.onError = (message) => {
      setError(message);
      if (message.includes("nicht gefunden") || message.includes("geschlossen")) {
        socket.remember(null);
        socket.pendingJoin = null;
        setDeepJoin(null);
        setResumingOnline(false);
        void desktop?.clearOnlineResume?.();
      }
      window.setTimeout(() => setError(null), 3200);
    };
    socket.onSnapshot = (next) => {
      setSnap(next);
      if (next.lanUrls?.length) setLanUrls(next.lanUrls);
      const host = originRef.current;
      if (desktop?.rememberOnline && next.mode === "online" && host) {
        void desktop.rememberOnline(host, next.code);
      }
    };
  }, [desktop, socket]);

  const applySession = useCallback(
    (session: { mode: DeployMode; origin: string; lanUrls: string[]; resumeCode?: string }) => {
      bindSocket();
      setMode(session.mode);
      setOrigin(session.origin);
      setLanUrls(session.lanUrls);
      setSnap(null);
      socket.offline = session.mode === "offline";
      socket.pendingJoin = session.resumeCode ?? null;
      if (session.resumeCode) socket.remember(session.resumeCode);
      else socket.remember(null);
      setResumingOnline(Boolean(session.resumeCode));
      socket.disconnect();
      socket.connect(session.origin);
      setGate(false);
      setTab("play");
    },
    [bindSocket, socket],
  );

  useEffect(() => {
    if (!showMonitor) return;
    if (location.pathname !== "/monitor") {
      history.replaceState(null, "", "/monitor");
    }
  }, [showMonitor]);

  useEffect(() => {
    if (showMonitor) return;

    let cancelled = false;
    bindSocket();

    if (desktop?.getState) {
      void desktop.getState().then((state) => {
        if (cancelled) return;
        setSavedRemoteUrl(state.savedRemoteUrl);
        if (typeof state.offlinePort === "number") setOfflinePort(state.offlinePort);
        if (state.boardId) setBoardId(state.boardId);
        if (state.boardName) setBoardName(state.boardName);
        setOnlineConfigured(Boolean(state.onlineConfigured ?? state.savedRemoteUrl.trim()));
        if (state.lastMode) setLastMode(state.lastMode);
        if (state.adminToken) applyAdminToken(state.adminToken);
        if (state.session) applySession(state.session);
        else setGate(true);
        setGateReady(true);
      });
      return () => {
        cancelled = true;
        socket.disconnect();
      };
    }

    void discoverServerInfo()
      .then(({ info, origin: apiOrigin }) => {
        if (cancelled) return;
        const nextMode: DeployMode = info.mode === "online" ? "online" : "offline";
        setMode(nextMode);
        setOrigin(apiOrigin);
        socket.offline = nextMode === "offline";
        socket.pendingJoin = nextMode === "online" ? deepJoin : null;
        if (info.lanUrls?.length) setLanUrls(info.lanUrls);
        socket.connect(apiOrigin);
      })
      .catch(() => {
        if (cancelled) return;
        setMode("offline");
        setOrigin(null);
        socket.offline = true;
        socket.connect();
      });

    return () => {
      cancelled = true;
      socket.disconnect();
    };
  }, [applySession, bindSocket, desktop, showMonitor, socket]);

  useEffect(() => {
    const status = snap?.match?.status ?? "playing";
    if (status !== "playing" && prevStatus.current === "playing") playWin(soundRef.current);
    prevStatus.current = status;
  }, [snap]);

  const toggleSound = (on: boolean) => {
    setSound(on);
    localStorage.setItem("steeldart-sound", on ? "on" : "off");
  };

  const leaveOnline = () => {
    socket.remember(null);
    setSnap(null);
  };

  const changeMode = async () => {
    socket.disconnect();
    socket.remember(null);
    setSnap(null);
    setMode(null);
    setOrigin(null);
    setLanUrls([]);
    if (desktop?.disconnect) await desktop.disconnect();
    const state = desktop?.getState ? await desktop.getState() : null;
    if (state) {
      setSavedRemoteUrl(state.savedRemoteUrl);
      if (typeof state.offlinePort === "number") setOfflinePort(state.offlinePort);
      if (state.boardId) setBoardId(state.boardId);
      if (state.boardName) setBoardName(state.boardName);
      setOnlineConfigured(Boolean(state.onlineConfigured ?? state.savedRemoteUrl.trim()));
      if (state.lastMode) setLastMode(state.lastMode);
    }
    setGate(true);
    setTab("play");
    setError(null);
  };

  const startOffline = async (resume: boolean) => {
    if (!desktop?.startOffline) return;
    setOfflinePrompt(false);
    setBusy(true);
    setError(null);
    const result = await desktop.startOffline({ resume });
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    applySession(result.session);
  };

  const requestOffline = async () => {
    if (!desktop?.startOffline) return;
    const status = desktop.offlineStatus ? await desktop.offlineStatus() : { resume: false };
    if (status.resume) {
      setOfflinePrompt(true);
      return;
    }
    await startOffline(false);
  };

  const startOnline = async () => {
    if (!desktop?.connectOnline) return;
    if (!savedRemoteUrl.trim()) {
      setError("Keine Webserver-URL konfiguriert. Bitte im Admin-Menü setzen.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await desktop.connectOnline(savedRemoteUrl);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSavedRemoteUrl(result.session.origin);
    setOnlineConfigured(true);
    applySession(result.session);
  };

  const toSetup = () => socket.send({ type: "toSetup" });

  const sendAction = (action: ClientAction) => {
    if (action.type === "THROW_DART" || action.type === "SET_VISIT_TOTAL") playClick(sound);
    socket.send({ type: "action", action });
  };

  const updateConfig = (config: MatchConfig) => {
    setSnap((cur) => (cur ? { ...cur, config } : cur));
    socket.send({ type: "updateConfig", config });
  };

  const connecting = Boolean(
    gateReady &&
      !gate &&
      (mode === null || (offline && !snap) || Boolean(deepJoin && !snap) || (resumingOnline && !snap)),
  );
  const showGate = Boolean(desktop?.getState && gate && gateReady);
  const showJoinQr = Boolean(desktop?.getState);
  const showHome = mode === "online" && !snap && !gate && !deepJoin && !resumingOnline;
  const showMatch = Boolean(snap?.match && snap.phase === "match" && !gate);
  const showSetup = Boolean(snap && !showMatch && !gate);
  const showChrome = (showGate || showHome || showSetup) && !connecting;
  const apiBase = origin ?? "";
  const snapLan = snap?.lanUrls?.length ? snap.lanUrls : lanUrls;
  const joinUrl = snap
    ? joinUrlForSession({
        offline: offline || snap.mode === "local",
        lanUrls: snapLan,
        origin,
        code: snap.code,
      })
    : null;

  if (showMonitor) {
    return <Monitor />;
  }

  return (
    <div className="app-root min-h-[100dvh]" data-layout={layout}>
      {showChrome && (
        <TabBar tab={tab} admin={Boolean(adminToken)} onTab={setTab} />
      )}

      {showChrome && tab === "stats" && <Stats apiBase={apiBase} origin={origin} />}

      {showChrome && tab === "admin" && adminToken && (
        <Admin
          apiBase={apiBase}
          origin={origin}
          token={adminToken}
          showRooms={mode === "online"}
          savedRemoteUrl={savedRemoteUrl}
          offlinePort={offlinePort}
          boardId={boardId}
          boardName={boardName}
          desktopSettings={Boolean(desktop)}
          onSettingsSaved={(state) => {
            setSavedRemoteUrl(state.savedRemoteUrl);
            setOfflinePort(state.offlinePort);
            setOnlineConfigured(Boolean(state.onlineConfigured ?? state.savedRemoteUrl.trim()));
            if (state.boardId) setBoardId(state.boardId);
            if (state.boardName) setBoardName(state.boardName);
          }}
          onLogout={() => applyAdminToken(null)}
        />
      )}

      {showChrome && tab === "play" && showGate && (
        <DesktopGate
          savedRemoteUrl={savedRemoteUrl}
          lastMode={lastMode}
          busy={busy}
          error={error}
          onlineConfigured={onlineConfigured}
          onOffline={() => void requestOffline()}
          onOnline={() => void startOnline()}
          onAdminToken={applyAdminToken}
        />
      )}

      {offlinePrompt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-6">
          <div className="w-full max-w-md rounded-3xl border border-white/10 bg-ink-800 p-6">
            <h2 className="font-display text-3xl">Laufendes Spiel fortsetzen?</h2>
            <p className="mt-3 text-sm text-slate-400">
              Es gibt ein gespeichertes lokales Match von den letzten 2 Stunden. Handys können erst
              wieder beitreten, wenn die App läuft.
            </p>
            <button
              className="mt-6 min-h-touch w-full rounded-2xl bg-amber-glow font-bold text-ink-950"
              onClick={() => void startOffline(true)}
              disabled={busy}
            >
              Fortsetzen
            </button>
            <button
              className="mt-3 min-h-touch w-full rounded-2xl bg-ink-700 font-bold text-white"
              onClick={() => void startOffline(false)}
              disabled={busy}
            >
              Neuen Raum erstellen
            </button>
          </div>
        </div>
      )}

      {connecting && (
        <div className="safe-pad flex min-h-[100dvh] flex-col items-center justify-center px-6 text-center">
          <div className="text-xs uppercase tracking-[0.45em] text-amber-glow">Steeldart</div>
          <h1 className="mt-2 font-display text-5xl">Verbinde…</h1>
          <p className="mt-3 text-slate-400">
            {offline ? "Lokales Spiel — alle Geräte sehen denselben Stand" : "Einen Moment"}
          </p>
        </div>
      )}

      {showChrome && tab === "play" && showHome && (
        <Home
          error={error}
          serverUrl={origin ?? undefined}
          apiBase={origin ?? ""}
          onChangeMode={desktop?.disconnect ? () => void changeMode() : undefined}
          onAdminToken={applyAdminToken}
          onCreate={(auth) =>
            socket.send({
              type: "createRoom",
              mode: "online",
              config: createDefaultConfig(),
              password: auth.password,
              adminToken: auth.adminToken,
              boardId: boardId || undefined,
              boardName: boardName || undefined,
            })
          }
          onJoin={(code) => socket.send({ type: "joinRoom", code })}
        />
      )}

      {showChrome && tab === "play" && showSetup && snap && (
        <Setup
          config={snap.config}
          code={snap.code}
          offline={offline || snap.mode === "local"}
          lanUrls={snapLan}
          joinUrl={showJoinQr ? joinUrl : null}
          apiBase={apiBase}
          origin={origin}
          onChange={updateConfig}
          onStart={() =>
            socket.send({ type: "startMatch", boardId: boardId || undefined, boardName: boardName || undefined })
          }
          onHome={offline || snap.mode === "local" ? undefined : leaveOnline}
          onChangeMode={desktop?.disconnect ? () => void changeMode() : undefined}
        />
      )}

      {showMatch && snap?.match && (
        <Match
          match={snap.match}
          code={snap.code}
          offline={offline || snap.mode === "local"}
          lanUrls={snapLan}
          joinUrl={showJoinQr ? joinUrl : null}
          connected={connected}
          sound={sound}
          error={error}
          isHost={Boolean(desktop) || Boolean(snap.isHost)}
          onAction={sendAction}
          onSound={toggleSound}
          onHome={offline || snap.mode === "local" ? toSetup : leaveOnline}
          onSetup={toSetup}
        />
      )}
    </div>
  );
}
