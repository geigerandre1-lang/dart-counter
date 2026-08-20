import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultDbPath, hostingerDataDir, openMiniDb } from "./sqlite.js";

const dirs: string[] = [];
const prevDb = process.env.STEELDART_DB;

afterEach(() => {
  delete process.env.STEELDART_SQLJS;
  if (prevDb == null) delete process.env.STEELDART_DB;
  else process.env.STEELDART_DB = prevDb;
  while (dirs.length) {
    const dir = dirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("sql.js fallback", () => {
  it("works when STEELDART_SQLJS=1 (no native addon)", async () => {
    process.env.STEELDART_SQLJS = "1";
    const db = await openMiniDb(":memory:");
    db.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT)");
    const inserted = db.run("INSERT INTO t (name) VALUES (?)", "hostinger");
    expect(inserted.changes).toBe(1);
    expect(db.get<{ name: string }>("SELECT name FROM t")?.name).toBe("hostinger");
    expect(db.all<{ name: string }>("SELECT name FROM t")).toHaveLength(1);
    db.close();
  });

  it("does not dump a better-sqlite3 Require stack when sql.js is forced", async () => {
    process.env.STEELDART_SQLJS = "1";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const db = await openMiniDb(":memory:");
      db.close();
      expect(warn.mock.calls.flat().join(" ")).not.toMatch(/Cannot find module/);
      expect(error.mock.calls.flat().join(" ")).not.toMatch(/Cannot find module/);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("persists a sql.js database to disk and reopens it", async () => {
    process.env.STEELDART_SQLJS = "1";
    const dir = mkdtempSync(path.join(tmpdir(), "steeldart-sqljs-"));
    dirs.push(dir);
    const file = path.join(dir, "web.sqlite");
    const db = await openMiniDb(file);
    db.exec("CREATE TABLE t (id INTEGER)");
    db.run("INSERT INTO t (id) VALUES (?)", 3);
    db.close();

    const reopened = await openMiniDb(file);
    expect(reopened.get<{ id: number }>("SELECT id FROM t")?.id).toBe(3);
    reopened.close();
  });
});

describe("default sqlite path", () => {
  it("honors STEELDART_DB over cwd", () => {
    process.env.STEELDART_DB = "/abs/outside/versions/steeldart.sqlite";
    const cwd = path.join(tmpdir(), "domains", "site", "hbuilds", "versions", "abc", "nodejs");
    expect(defaultDbPath(cwd)).toBe("/abs/outside/versions/steeldart.sqlite");
  });

  it("stores next to the domain when cwd is under hbuilds/versions", () => {
    delete process.env.STEELDART_DB;
    const domainRoot = path.join(tmpdir(), "domains", "dart-counter.turniertool.eu");
    const cwd = path.join(domainRoot, "hbuilds", "versions", "uuid-here", "nodejs");
    expect(hostingerDataDir(cwd)).toBe(path.join(domainRoot, "data"));
    expect(defaultDbPath(cwd)).toBe(path.join(domainRoot, "data", "steeldart.sqlite"));
  });

  it("uses cwd/data when not on Hostinger", () => {
    delete process.env.STEELDART_DB;
    const cwd = path.join(tmpdir(), "opt", "steeldart");
    expect(defaultDbPath(cwd)).toBe(path.join(cwd, "data", "steeldart.sqlite"));
    expect(hostingerDataDir(cwd)).toBeNull();
  });
});
