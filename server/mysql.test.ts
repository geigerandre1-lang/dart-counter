import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeMysqlPassword, maskSecret, mysqlConfigFromEnv, rewriteMysqlSql } from "./mysql.js";

const keys = [
  "STEELDART_MYSQL_HOST",
  "STEELDART_MYSQL_USER",
  "STEELDART_MYSQL_PASSWORD",
  "STEELDART_MYSQL_DATABASE",
  "STEELDART_MYSQL_PORT",
  "MYSQL_HOST",
  "MYSQL_USER",
  "MYSQL_PASSWORD",
  "MYSQL_DATABASE",
];

const prev: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of keys) prev[key] = process.env[key];
});

afterEach(() => {
  for (const key of keys) {
    if (prev[key] === undefined) delete process.env[key];
    else process.env[key] = prev[key];
  }
});

describe("mysql password masking", () => {
  it("keeps Sonderzeichen and decodes percent-encoding", () => {
    expect(decodeMysqlPassword(`p@ss#wörd!`)).toBe(`p@ss#wörd!`);
    expect(decodeMysqlPassword(`"p@ss#"`)).toBe(`p@ss#`);
    expect(decodeMysqlPassword("p%40ss%23w%C3%B6rd%21")).toBe("p@ss#wörd!");
  });

  it("never prints the password", () => {
    const secret = "p@ss#wörd!";
    expect(maskSecret(secret)).not.toContain("@");
    expect(maskSecret(secret)).toMatch(/^\*+$/);
  });
});

describe("mysql sql rewrite", () => {
  it("maps sqlite upserts to mysql", () => {
    expect(rewriteMysqlSql("INSERT OR IGNORE INTO t (id) VALUES (?)")).toBe(
      "INSERT IGNORE INTO t (id) VALUES (?)",
    );
  });
});

describe("mysql env", () => {
  it("reads Hostinger-style variables without putting the password in a URL", () => {
    process.env.STEELDART_MYSQL_HOST = "srv123.hstgr.io";
    process.env.STEELDART_MYSQL_USER = "u123";
    process.env.STEELDART_MYSQL_DATABASE = "steeldart";
    process.env.STEELDART_MYSQL_PASSWORD = "p@ss#wörd!";
    const config = mysqlConfigFromEnv();
    expect(config).toMatchObject({
      host: "srv123.hstgr.io",
      user: "u123",
      database: "steeldart",
      password: "p@ss#wörd!",
      port: 3306,
    });
  });

  it("is inactive without host/user/database so desktop stays on sqlite", () => {
    for (const key of keys) delete process.env[key];
    expect(mysqlConfigFromEnv()).toBeNull();
  });
});
