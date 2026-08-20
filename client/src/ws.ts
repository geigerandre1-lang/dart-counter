import type { RoomSnapshot, WsClientMessage, WsServerMessage } from "@shared/index";

const ROOM_KEY = "dart-counter-room";

export function wsUrl(origin?: string): string {
  if (origin) {
    const url = new URL(origin);
    const proto = url.protocol === "https:" ? "wss:" : "ws:";
    return `${proto}//${url.host}/ws`;
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}/ws`;
}

export type ConnStatus = "connecting" | "open" | "closed";

export class RoomSocket {
  private ws: WebSocket | null = null;
  private retries = 0;
  private timer: number | null = null;
  private queue: WsClientMessage[] = [];
  private stopped = false;
  private origin: string | undefined;
  /** When true (Pi/offline), never rejoin a stored room code — the server auto-joins LOCAL. */
  offline = false;
  pendingJoin: string | null = null;
  onSnapshot: (snap: RoomSnapshot) => void = () => undefined;
  onError: (message: string) => void = () => undefined;
  onStatus: (status: ConnStatus) => void = () => undefined;

  connect(origin?: string): void {
    if (origin) this.origin = origin.replace(/\/$/, "");
    this.stopped = false;
    this.clearTimer();
    this.onStatus("connecting");
    const socket = new WebSocket(wsUrl(this.origin));
    this.ws = socket;

    socket.onopen = () => {
      this.retries = 0;
      this.onStatus("open");
      if (this.queue.length > 0) {
        const pending = this.queue.splice(0);
        for (const msg of pending) socket.send(JSON.stringify(msg));
        return;
      }
      if (this.offline) return;
      if (this.pendingJoin) {
        socket.send(JSON.stringify({ type: "joinRoom", code: this.pendingJoin }));
        return;
      }
      const code = localStorage.getItem(ROOM_KEY);
      if (code && code !== "LOCAL") socket.send(JSON.stringify({ type: "joinRoom", code }));
    };

    socket.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data)) as WsServerMessage;
      if (msg.type === "snapshot") {
        if (msg.snapshot.mode === "online") localStorage.setItem(ROOM_KEY, msg.snapshot.code);
        else localStorage.removeItem(ROOM_KEY);
        this.onSnapshot(msg.snapshot);
      } else if (msg.type === "error") {
        this.onError(msg.message);
      }
    };

    socket.onclose = () => {
      this.onStatus("closed");
      if (this.stopped) return;
      const wait = Math.min(8000, 400 * 2 ** this.retries);
      this.retries += 1;
      this.timer = window.setTimeout(() => this.connect(), wait);
    };
  }

  send(msg: WsClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      this.queue.push(msg);
    }
  }

  remember(code: string | null): void {
    if (code) localStorage.setItem(ROOM_KEY, code);
    else localStorage.removeItem(ROOM_KEY);
  }

  disconnect(): void {
    this.stopped = true;
    this.clearTimer();
    this.ws?.close();
    this.ws = null;
    this.queue = [];
  }

  private clearTimer(): void {
    if (this.timer != null) window.clearTimeout(this.timer);
    this.timer = null;
  }
}
