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

export function isLocalMysqlHost(host: string): boolean {
  const value = host.trim().toLowerCase();
  return value === "localhost" || value === "127.0.0.1" || value === "::1";
}

function stripPasswordWrapper(raw: string): string {
  let value = raw;
  if (
    (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
    (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
  ) {
    value = value.slice(1, -1);
  }
  return value;
}

function passwordEncodedFromEnv(): boolean {
  const value = env("STEELDART_MYSQL_PASSWORD_ENCODED").toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/**
 * Sonderzeichen (@ # % &) gehen unverändert an den Treiber — nie in eine URL.
 * Prozent-Kodierung nur wenn STEELDART_MYSQL_PASSWORD_ENCODED=1 (sonst bleibt %40 ein %40).
 */
export function decodeMysqlPassword(raw: string): string {
  const value = stripPasswordWrapper(raw);
  if (!passwordEncodedFromEnv()) return value;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Rohwert plus optional dekodierte Variante — Access-Denied retried ohne das Passwort zu loggen. */
export function mysqlPasswordCandidates(raw: string): string[] {
  const asIs = stripPasswordWrapper(raw);
  const out = [asIs];
  if (passwordEncodedFromEnv() || /%[0-9A-Fa-f]{2}/.test(asIs)) {
    try {
      const decoded = decodeURIComponent(asIs);
      if (decoded && decoded !== asIs) out.push(decoded);
    } catch {
      /* keep as-is */
    }
  }
  return out;
}

export function maskSecret(value: string): string {
  if (!value) return "(leer)";
  return "*".repeat(Math.min(12, Math.max(8, value.length)));
}

export function mysqlConfigFromEnv(): MysqlEnvConfig | null {
  const requestedHost = env("STEELDART_MYSQL_HOST", "MYSQL_HOST");
  const user = env("STEELDART_MYSQL_USER", "MYSQL_USER");
  const database = env("STEELDART_MYSQL_DATABASE", "MYSQL_DATABASE");
  if (!requestedHost || !user || !database) return null;
  const portRaw = env("STEELDART_MYSQL_PORT", "MYSQL_PORT");
  const port = portRaw ? Number(portRaw) : 3306;
  const sslRaw = env("STEELDART_MYSQL_SSL", "MYSQL_SSL").toLowerCase();
  const sslForced = sslRaw === "force";
  const sslRequested = sslForced || sslRaw === "1" || sslRaw === "true" || sslRaw === "yes";
  const local = isLocalMysqlHost(requestedHost);
  const host = requestedHost === "127.0.0.1" || requestedHost === "::1" ? "localhost" : requestedHost;
  return {
    host,
    port: Number.isInteger(port) && port > 0 ? port : 3306,
    user,
    password: decodeMysqlPassword(process.env.STEELDART_MYSQL_PASSWORD ?? process.env.MYSQL_PASSWORD ?? ""),
    database,
    ssl: local && !sslForced ? false : sslRequested,
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
      if (pool) {
        try { await pool.end(); } catch (_err) { /* replace pool */ }
        pool = null;
      }
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

function workerHandshake(
  worker: Worker,
  config: { host: string; port: number; user: string; password: string; database: string; ssl: boolean },
): { ok: boolean; error?: string } {
  const { port1, port2 } = new MessageChannel();
  const lock = new Int32Array(new SharedArrayBuffer(4));
  Atomics.store(lock, 0, 0);
  worker.postMessage(
    { type: "init", reply: port2, lock, config },
    [port2 as unknown as TransferListItem],
  );
  const wait = Atomics.wait(lock, 0, 0, 20_000);
  if (wait === "timed-out") {
    port1.close();
    return { ok: false, error: "MySQL-Timeout beim Verbinden." };
  }
  const received = receiveMessageOnPort(port1);
  port1.close();
  const payload = (received?.message ?? {}) as { ok?: boolean; error?: string };
  if (!payload.ok) return { ok: false, error: payload.error || "unbekannt" };
  return { ok: true };
}

export async function openMysqlDb(config = mysqlConfigFromEnv()): Promise<MiniDb> {
  if (!config) {
    throw new Error(
      "MySQL ist nicht konfiguriert. STEELDART_MYSQL_HOST, STEELDART_MYSQL_USER, STEELDART_MYSQL_DATABASE setzen.",
    );
  }
  const requestedHost = env("STEELDART_MYSQL_HOST", "MYSQL_HOST") || config.host;
  const hosts = [...new Set([config.host, requestedHost].filter(Boolean))];
  const passwords = mysqlPasswordCandidates(
    process.env.STEELDART_MYSQL_PASSWORD ?? process.env.MYSQL_PASSWORD ?? "",
  );
  const sslForced = env("STEELDART_MYSQL_SSL", "MYSQL_SSL").toLowerCase() === "force";
  const ssls = isLocalMysqlHost(config.host) && !sslForced ? [false] : [...new Set([config.ssl, false])];

  const worker = new Worker(WORKER_SOURCE, { eval: true });
  let lastError = "unbekannt";
  for (const host of hosts) {
    for (const ssl of ssls) {
      for (const password of passwords) {
        const attempt = { host, port: config.port, user: config.user, password, database: config.database, ssl };
        if (!mysqlLogged) {
          logMysqlOnce({ ...config, host, ssl, password });
        } else {
          console.warn(`mysql: neuer Versuch host=${host} ssl=${ssl ? "on" : "off"} password=${maskSecret(password)}`);
        }
        const result = workerHandshake(worker, attempt);
        if (result.ok) return new MysqlDb(worker);
        lastError = result.error || lastError;
      }
    }
  }
  void worker.terminate();
  throw new Error(`MySQL-Verbindung fehlgeschlagen: ${lastError}`);
}
