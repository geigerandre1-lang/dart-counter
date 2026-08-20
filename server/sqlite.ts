import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(path.join(process.cwd(), "package.json"));

export interface MiniDb {
  exec(sql: string): void;
  run(sql: string, ...params: unknown[]): { changes: number };
  get<T>(sql: string, ...params: unknown[]): T | undefined;
  all<T>(sql: string, ...params: unknown[]): T[];
  close(): void;
}

class BetterSqliteDb implements MiniDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private readonly db: any) {}

  exec(sql: string): void {
    this.db.exec(sql);
  }

  run(sql: string, ...params: unknown[]): { changes: number } {
    const info = this.db.prepare(sql).run(...params);
    return { changes: Number(info.changes ?? 0) };
  }

  get<T>(sql: string, ...params: unknown[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  all<T>(sql: string, ...params: unknown[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  close(): void {
    this.db.close();
  }
}

class SqlJsDb implements MiniDb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    private db: any,
    private readonly filePath: string,
    private persist: () => void,
  ) {}

  exec(sql: string): void {
    this.db.exec(sql);
    this.persist();
  }

  run(sql: string, ...params: unknown[]): { changes: number } {
    this.db.run(sql, params.length ? params : undefined);
    this.persist();
    return { changes: this.db.getRowsModified() };
  }

  get<T>(sql: string, ...params: unknown[]): T | undefined {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      if (!stmt.step()) return undefined;
      return stmt.getAsObject() as T;
    } finally {
      stmt.free();
    }
  }

  all<T>(sql: string, ...params: unknown[]): T[] {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const rows: T[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject() as T);
      return rows;
    } finally {
      stmt.free();
    }
  }

  close(): void {
    this.persist();
    this.db.close();
  }
}

export function defaultDbPath(): string {
  const fromEnv = process.env.STEELDART_DB;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return path.join(process.cwd(), "data", "steeldart.sqlite");
}

function bundledWasmPath(): string {
  try {
    return path.join(path.dirname(fileURLToPath(import.meta.url)), "sql-wasm.wasm");
  } catch {
    return "";
  }
}

function resolveSqlJsWasm(): string {
  const resourcesPath =
    typeof process !== "undefined" && typeof process.resourcesPath === "string"
      ? process.resourcesPath
      : "";
  const candidates = [
    resourcesPath ? path.join(resourcesPath, "sql-wasm.wasm") : "",
    bundledWasmPath(),
    path.join(process.cwd(), "dist", "sql-wasm.wasm"),
    (() => {
      try {
        return path.join(path.dirname(require.resolve("sql.js")), "sql-wasm.wasm");
      } catch {
        return "";
      }
    })(),
    path.join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  ].filter(Boolean);
  for (const file of candidates) {
    if (fs.existsSync(file)) return file;
  }
  return candidates[candidates.length - 1] ?? path.join(process.cwd(), "dist", "sql-wasm.wasm");
}

function sqlJsLocateFile(file: string, wasmFile: string): string {
  const candidates = [
    path.join(process.cwd(), "dist", file),
    path.join(process.cwd(), "node_modules", "sql.js", "dist", file),
    path.join(path.dirname(wasmFile), file),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return candidates[0] ?? file;
}

function ensureDistWasm(wasmFile: string): string {
  const distFile = path.join(process.cwd(), "dist", "sql-wasm.wasm");
  if (fs.existsSync(distFile)) return distFile;
  if (wasmFile && fs.existsSync(wasmFile) && path.resolve(wasmFile) !== path.resolve(distFile)) {
    try {
      fs.mkdirSync(path.dirname(distFile), { recursive: true });
      fs.copyFileSync(wasmFile, distFile);
      console.log("sql.js WASM copied to", distFile);
      return distFile;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn("sql.js WASM copy failed:", message);
    }
  }
  return wasmFile;
}

function preferSqlJs(): boolean {
  const value = process.env.STEELDART_SQLJS?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

let sqliteEngineLogged = false;

function logSqlJsOnce(): void {
  if (sqliteEngineLogged) return;
  sqliteEngineLogged = true;
  console.log("sqlite: sql.js (better-sqlite3 optional — erwartet auf Hostinger)");
}

function tryOpenBetterSqlite(filePath: string): MiniDb | null {
  if (preferSqlJs()) return null;
  try {
    const Database = require("better-sqlite3");
    const db = new Database(filePath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    return new BetterSqliteDb(db);
  } catch {
    // Missing native addon is normal on Hostinger — never dump Require stack.
    return null;
  }
}

function ensureWritableDbPath(filePath: string): string {
  if (filePath === ":memory:") return filePath;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    return filePath;
  } catch (err) {
    const fallback = path.join(os.tmpdir(), "steeldart.sqlite");
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`DB-Pfad nicht schreibbar (${filePath}), nutze ${fallback}:`, message);
    fs.mkdirSync(path.dirname(fallback), { recursive: true });
    return fallback;
  }
}

export async function openMiniDb(filePath: string): Promise<MiniDb> {
  filePath = ensureWritableDbPath(filePath);

  const native = tryOpenBetterSqlite(filePath);
  if (native) return native;

  let initSqlJs;
  try {
    initSqlJs = (await import("sql.js")).default;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`sql.js konnte nicht geladen werden: ${message}`);
  }
  const wasmFile = ensureDistWasm(resolveSqlJsWasm());
  if (!fs.existsSync(wasmFile)) {
    throw new Error(
      `sql.js WASM fehlt (${wasmFile}). Start kopiert nach dist/sql-wasm.wasm aus node_modules/sql.js.`,
    );
  }
  logSqlJsOnce();
  const locateFile = (file: string) => sqlJsLocateFile(file, wasmFile);
  let SQL;
  try {
    SQL = await initSqlJs({
      wasmBinary: fs.readFileSync(wasmFile),
      locateFile,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("sql.js wasmBinary fehlgeschlagen, locateFile retry:", message);
    SQL = await initSqlJs({ locateFile });
  }

  let db;
  if (filePath !== ":memory:" && fs.existsSync(filePath)) {
    db = new SQL.Database(fs.readFileSync(filePath));
  } else {
    db = new SQL.Database();
  }

  const persist = () => {
    if (filePath === ":memory:") return;
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(db.export()));
  };

  const wrapped = new SqlJsDb(db, filePath, persist);
  wrapped.exec("PRAGMA foreign_keys = ON;");
  return wrapped;
}
