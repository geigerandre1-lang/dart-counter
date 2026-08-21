import fs from "node:fs";
import { MessageChannel, Worker, receiveMessageOnPort, type TransferListItem } from "node:worker_threads";
import type { MiniDb } from "./sqlite.js";

export interface MysqlEnvConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  ssl: boolean;
  socketPath?: string;
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
  return value.replace(/\r?\n$/, "");
}

function passwordFromBase64(): string {
  const b64 = env("STEELDART_MYSQL_PASSWORD_B64", "MYSQL_PASSWORD_B64");
  if (!b64) return "";
  try {
    return Buffer.from(b64, "base64").toString("utf8").replace(/\r?\n$/, "");
  } catch {
    return "";
  }
}

function passwordEncodedFromEnv(): boolean {
  const value = env("STEELDART_MYSQL_PASSWORD_ENCODED").toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

/**
 * Sonderzeichen (@ # % &) gehen unverändert an den Treiber — nie in eine URL.
 * Prozent-Kodierung nur wenn STEELDART_MYSQL_PASSWORD_ENCODED=1 (sonst bleibt %40 ein %40).
 * Hostinger-Panel: STEELDART_MYSQL_PASSWORD_B64 (UTF-8, Base64), wenn $ # & verschluckt werden.
 */
export function decodeMysqlPassword(raw: string): string {
  const fromB64 = passwordFromBase64();
  if (fromB64) return fromB64;
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
  const out: string[] = [];
  const fromB64 = passwordFromBase64();
  if (fromB64) out.push(fromB64);
  const asIs = stripPasswordWrapper(raw);
  if (asIs && !out.includes(asIs)) out.push(asIs);
  if (passwordEncodedFromEnv() || /%[0-9A-Fa-f]{2}/.test(asIs)) {
    try {
      const decoded = decodeURIComponent(asIs);
      if (decoded && !out.includes(decoded)) out.push(decoded);
    } catch {
      /* keep as-is */
    }
  }
  return out.filter((value) => value.length > 0);
}

export function passwordLogHint(value: string): string {
  const bytes = Buffer.byteLength(value, "utf8");
  return `len=${value.length} bytes=${bytes} $=${value.includes("$") ? "yes" : "no"} #=${value.includes("#") ? "yes" : "no"} @=${value.includes("@") ? "yes" : "no"}`;
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

export function mysqlSocketCandidates(): string[] {
  const fromEnv = env("STEELDART_MYSQL_SOCKET", "MYSQL_SOCKET");
  const paths = [
    fromEnv,
    "/var/run/mysqld/mysqld.sock",
    "/run/mysqld/mysqld.sock",
    "/tmp/mysql.sock",
    "/var/lib/mysql/mysql.sock",
  ].filter(Boolean);
  return [...new Set(paths)];
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
      pool = mysql.createPool((() => {
        const opts = {
          user: config.user,
          password: config.password,
          database: config.database,
          waitForConnections: true,
          connectionLimit: 4,
          charset: "utf8mb4",
          supportBigNumbers: true,
          bigNumberStrings: false,
        };
        if (config.socketPath) {
          opts.socketPath = config.socketPath;
          return opts;
        }
        opts.host = config.host;
        opts.port = config.port;
        if (config.ssl) opts.ssl = { rejectUnauthorized: false };
        return opts;
      })());
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
  const via = config.socketPath ? `socket=${config.socketPath}` : `host=${config.host} port=${config.port}`;
  console.log(
    `mysql: ${via} user=${config.user} database=${config.database} password=${maskSecret(config.password)} ${passwordLogHint(config.password)} ssl=${config.ssl ? "on" : "off"}`,
  );
}

function workerHandshake(
  worker: Worker,
  config: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl: boolean;
    socketPath?: string;
  },
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
  const passwords = mysqlPasswordCandidates(
    process.env.STEELDART_MYSQL_PASSWORD ?? process.env.MYSQL_PASSWORD ?? "",
  );
  if (!passwords.length) {
    throw new Error(
      "MySQL-Passwort fehlt. STEELDART_MYSQL_PASSWORD oder STEELDART_MYSQL_PASSWORD_B64 in hPanel setzen.",
    );
  }
  const local = isLocalMysqlHost(config.host);
  const attempts: Array<{
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
    ssl: boolean;
    socketPath?: string;
  }> = [];

  if (local) {
    const sockets = mysqlSocketCandidates().filter((file) => {
      try {
        return fs.existsSync(file);
      } catch {
        return false;
      }
    });
    const socketList = sockets.length ? sockets : mysqlSocketCandidates();
    for (const socketPath of socketList) {
      for (const password of passwords) {
        attempts.push({
          host: "localhost",
          port: config.port,
          user: config.user,
          password,
          database: config.database,
          ssl: false,
          socketPath,
        });
      }
    }
  } else {
    const sslForced = env("STEELDART_MYSQL_SSL", "MYSQL_SSL").toLowerCase() === "force";
    const ssls = sslForced ? [true] : [...new Set([config.ssl, false])];
    for (const ssl of ssls) {
      for (const password of passwords) {
        attempts.push({
          host: config.host,
          port: config.port,
          user: config.user,
          password,
          database: config.database,
          ssl,
        });
      }
    }
  }

  const worker = new Worker(WORKER_SOURCE, { eval: true });
  let lastError = "unbekannt";
  for (const attempt of attempts) {
    if (!mysqlLogged) logMysqlOnce({ ...config, ...attempt });
    else {
      const via = attempt.socketPath ? `socket=${attempt.socketPath}` : `host=${attempt.host}`;
      console.warn(`mysql: neuer Versuch ${via} ssl=${attempt.ssl ? "on" : "off"} password=${maskSecret(attempt.password)}`);
    }
    const result = workerHandshake(worker, attempt);
    if (result.ok) return new MysqlDb(worker);
    lastError = result.error || lastError;
  }
  void worker.terminate();
  if (/access denied/i.test(lastError)) {
    throw new Error(
      "MySQL hat den User über den Socket erkannt (@localhost), aber das Passwort abgelehnt. " +
        "Bitte das Passwort des Datenbank-Users aus hPanel → Datenbanken verwenden (nicht das Hosting-Passwort). " +
        "Wenn es $ # oder & enthält: Passwort in Base64 und STEELDART_MYSQL_PASSWORD_B64 setzen, STEELDART_MYSQL_PASSWORD leer lassen. " +
        lastError,
    );
  }
  throw new Error(`MySQL-Verbindung fehlgeschlagen: ${lastError}`);
}
