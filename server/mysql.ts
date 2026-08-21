import { MessageChannel, Worker, receiveMessageOnPort, type TransferListItem } from "node:worker_threads";
import type { MiniDb } from "./sqlite.js";

export interface MysqlEnvConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
}

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? (fallback ? process.env[fallback] : undefined) ?? "";
  return value.trim();
}

/** Decode a Hostinger/env password so Sonderzeichen stay intact; never log the result. */
export function decodeMysqlPassword(raw: string): string {
  let value = raw;
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }
  if (/%[0-9A-Fa-f]{2}/.test(value)) {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return value;
}

export function maskSecret(value: string): string {
  if (!value) return "(leer)";
  return "*".repeat(Math.min(12, Math.max(8, value.length)));
}

export function mysqlConfigFromEnv(): MysqlEnvConfig | null {
  const host = env("STEELDART_MYSQL_HOST", "MYSQL_HOST");
  const user = env("STEELDART_MYSQL_USER", "MYSQL_USER");
  const database = env("STEELDART_MYSQL_DATABASE", "MYSQL_DATABASE");
  if (!host || !user || !database) return null;
  const portRaw = env("STEELDART_MYSQL_PORT", "MYSQL_PORT");
  const port = portRaw ? Number(portRaw) : 3306;
  const sslRaw = env("STEELDART_MYSQL_SSL", "MYSQL_SSL").toLowerCase();
  return {
    host,
    port: Number.isInteger(port) && port > 0 ? port : 3306,
    user,
    password: decodeMysqlPassword(process.env.STEELDART_MYSQL_PASSWORD ?? process.env.MYSQL_PASSWORD ?? ""),
    database,
    ssl: sslRaw === "1" || sslRaw === "true" || sslRaw === "yes",
  };
}

export function mysqlConfigured(): boolean {
  return mysqlConfigFromEnv() != null;
}

export function rewriteMysqlSql(sql: string): string {
  return sql
    .replace(/\bINSERT OR IGNORE\b/gi, "INSERT IGNORE")
    .replace(/\bINSERT OR REPLACE\b/gi, "REPLACE")
    .replace(/\bifnull\s*\(/gi, "IFNULL(");
}

function isPragma(sql: string): boolean {
  return /^\s*PRAGMA\b/i.test(sql);
}

const WORKER_SOURCE = `
"use strict";
const { parentPort } = require("worker_threads");
const mysql = require("mysql2/promise");

let pool;

function rewrite(sql) {
  return String(sql)
    .replace(/\\bINSERT OR IGNORE\\b/gi, "INSERT IGNORE")
    .replace(/\\bINSERT OR REPLACE\\b/gi, "REPLACE")
    .replace(/\\bifnull\\s*\\(/gi, "IFNULL(");
}

parentPort.on("message", async (msg) => {
  const { reply, lock, type, sql, params, config } = msg;
  try {
    if (type === "init") {
      pool = mysql.createPool({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        waitForConnections: true,
        connectionLimit: 4,
        charset: "utf8mb4",
        supportBigNumbers: true,
        bigNumberStrings: false,
        ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      });
      await pool.query("SELECT 1");
      reply.postMessage({ ok: true });
    } else if (type === "exec") {
      const text = rewrite(sql);
      if (!/^\\s*PRAGMA\\b/i.test(text)) {
        const parts = text.split(/;\\s*(?=\\S)/).map((p) => p.trim()).filter(Boolean);
        for (const part of parts) await pool.query(part);
      }
      reply.postMessage({ ok: true });
    } else if (type === "run") {
      const [header] = await pool.query(rewrite(sql), params ?? []);
      const changes = header && typeof header.affectedRows === "number" ? header.affectedRows : 0;
      reply.postMessage({ ok: true, changes });
    } else if (type === "get") {
      const [rows] = await pool.query(rewrite(sql), params ?? []);
      reply.postMessage({ ok: true, row: Array.isArray(rows) ? rows[0] : undefined });
    } else if (type === "all") {
      const [rows] = await pool.query(rewrite(sql), params ?? []);
      reply.postMessage({ ok: true, rows: Array.isArray(rows) ? rows : [] });
    } else if (type === "close") {
      if (pool) await pool.end();
      pool = null;
      reply.postMessage({ ok: true });
    } else {
      reply.postMessage({ ok: false, error: "Unbekannter MySQL-Befehl." });
    }
  } catch (err) {
    const message = err && err.message ? String(err.message) : String(err);
    reply.postMessage({ ok: false, error: message });
  }
  Atomics.store(lock, 0, 1);
  Atomics.notify(lock, 0, 1);
});
`;

class MysqlDb implements MiniDb {
  readonly dialect = "mysql" as const;

  constructor(private readonly worker: Worker) {}

  private call(type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    const { port1, port2 } = new MessageChannel();
    const lock = new Int32Array(new SharedArrayBuffer(4));
    Atomics.store(lock, 0, 0);
    this.worker.postMessage(
      { type, reply: port2, lock, ...extra },
      [port2 as unknown as TransferListItem],
    );
    const wait = Atomics.wait(lock, 0, 0, 20_000);
    if (wait === "timed-out") {
      throw new Error("MySQL-Timeout — Hostinger-Datenbank antwortet nicht.");
    }
    const received = receiveMessageOnPort(port1);
    port1.close();
    const payload = (received?.message ?? {}) as { ok?: boolean; error?: string };
    if (!payload.ok) {
      throw new Error(payload.error || "MySQL-Fehler.");
    }
    return payload as Record<string, unknown>;
  }

  exec(sql: string): void {
    if (isPragma(sql)) return;
    this.call("exec", { sql: rewriteMysqlSql(sql) });
  }

  run(sql: string, ...params: unknown[]): { changes: number } {
    if (isPragma(sql)) return { changes: 0 };
    const payload = this.call("run", { sql: rewriteMysqlSql(sql), params });
    return { changes: Number(payload.changes ?? 0) };
  }

  get<T>(sql: string, ...params: unknown[]): T | undefined {
    if (isPragma(sql)) return undefined;
    const payload = this.call("get", { sql: rewriteMysqlSql(sql), params });
    return payload.row as T | undefined;
  }

  all<T>(sql: string, ...params: unknown[]): T[] {
    if (isPragma(sql)) return [];
    const payload = this.call("all", { sql: rewriteMysqlSql(sql), params });
    return (payload.rows as T[]) ?? [];
  }

  close(): void {
    try {
      this.call("close");
    } catch {
      /* ignore */
    }
    void this.worker.terminate();
  }
}

let mysqlLogged = false;

function logMysqlOnce(config: MysqlEnvConfig): void {
  if (mysqlLogged) return;
  mysqlLogged = true;
  console.log(
    `mysql: host=${config.host} port=${config.port} user=${config.user} database=${config.database} password=${maskSecret(config.password)} ssl=${config.ssl ? "on" : "off"}`,
  );
}

export async function openMysqlDb(config = mysqlConfigFromEnv()): Promise<MiniDb> {
  if (!config) {
    throw new Error(
      "MySQL ist nicht konfiguriert. STEELDART_MYSQL_HOST, STEELDART_MYSQL_USER, STEELDART_MYSQL_DATABASE setzen.",
    );
  }
  logMysqlOnce(config);
  const worker = new Worker(WORKER_SOURCE, { eval: true });
  const { port1, port2 } = new MessageChannel();
  const lock = new Int32Array(new SharedArrayBuffer(4));
  Atomics.store(lock, 0, 0);
  worker.postMessage(
    {
      type: "init",
      reply: port2,
      lock,
      config: {
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
        database: config.database,
        ssl: config.ssl,
      },
    },
    [port2 as unknown as TransferListItem],
  );
  const wait = Atomics.wait(lock, 0, 0, 20_000);
  if (wait === "timed-out") {
    void worker.terminate();
    throw new Error("MySQL-Timeout beim Verbinden.");
  }
  const received = receiveMessageOnPort(port1);
  port1.close();
  const payload = (received?.message ?? {}) as { ok?: boolean; error?: string };
  if (!payload.ok) {
    void worker.terminate();
    throw new Error(`MySQL-Verbindung fehlgeschlagen: ${payload.error || "unbekannt"}`);
  }
  return new MysqlDb(worker);
}
