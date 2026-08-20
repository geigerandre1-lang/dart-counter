import os from "node:os";
import { applyAction, createMatch, normalizeConfig } from "../shared/index.js";
import type { ClientAction, MatchConfig, MatchState } from "../shared/types.js";
import type { WebSocket } from "ws";

const CODE_CHARS = "ABCDEFGHJKLMNPQRTUVWXYZ23456789";

export function lanIPv4(): string[] {
  const ips: string[] = [];
  for (const nets of Object.values(os.networkInterfaces())) {
    if (!nets) continue;
    for (const net of nets) {
      if (net.family === "IPv4" && !net.internal) ips.push(net.address);
    }
  }
  return ips;
}

export function generateRoomCode(existing: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = "";
    for (let i = 0; i < 4; i++) {
      code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    }
    if (!existing.has(code)) return code;
  }
  return `R${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

export interface Room {
  code: string;
  state: MatchState;
  clients: Map<WebSocket, string>;
  createdAt: number;
}

export class RoomHub {
  readonly rooms = new Map<string, Room>();

  create(config: MatchConfig): Room {
    this.gc();
    const code = generateRoomCode(new Set(this.rooms.keys()));
    const state = createMatch(normalizeConfig(config));
    const room: Room = { code, state, clients: new Map(), createdAt: Date.now() };
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code.trim().toUpperCase());
  }

  join(code: string, ws: WebSocket, clientId: string): Room | undefined {
    const room = this.get(code);
    if (!room) return undefined;
    room.clients.set(ws, clientId);
    return room;
  }

  leave(ws: WebSocket): void {
    for (const room of this.rooms.values()) {
      room.clients.delete(ws);
    }
  }

  apply(room: Room, action: ClientAction): { ok: true; state: MatchState } | { ok: false; error: string } {
    const result = applyAction(room.state, action);
    if (!result.ok) return { ok: false, error: result.error };
    room.state = result.state;
    return { ok: true, state: room.state };
  }

  broadcast(room: Room, payload: unknown): void {
    const data = JSON.stringify(payload);
    for (const client of room.clients.keys()) {
      if (client.readyState === 1) client.send(data);
    }
  }

  gc(): void {
    const maxAge = 1000 * 60 * 60 * 12;
    const now = Date.now();
    for (const [code, room] of this.rooms) {
      if (now - room.createdAt > maxAge && room.clients.size === 0) {
        this.rooms.delete(code);
      }
    }
  }
}
