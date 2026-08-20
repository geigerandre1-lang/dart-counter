import { describe, expect, it } from "vitest";
import {
  MAX_ONLINE_ROOMS,
  authorizeRoomCreate,
  getAdminPassword,
  issueAdminToken,
  passwordsMatch,
  revokeAdminToken,
  roomCapError,
} from "./admin";

describe("admin auth", () => {
  it("accepts the default admin password", () => {
    expect(passwordsMatch("Admin17", getAdminPassword())).toBe(true);
    expect(passwordsMatch("wrong", getAdminPassword())).toBe(false);
    expect(passwordsMatch(undefined, getAdminPassword())).toBe(false);
  });

  it("accepts a short-lived admin token", () => {
    const token = issueAdminToken();
    expect(authorizeRoomCreate({ adminToken: token }).ok).toBe(true);
    expect(authorizeRoomCreate({ adminToken: "nope" }).ok).toBe(false);
    revokeAdminToken(token);
    expect(authorizeRoomCreate({ adminToken: token }).ok).toBe(false);
  });

  it("caps concurrent rooms at 4", () => {
    expect(MAX_ONLINE_ROOMS).toBe(4);
    expect(roomCapError(3)).toBeNull();
    expect(roomCapError(4)).toMatch(/bereits 4 Räume/);
  });

  it("trims STEELDART_ADMIN_PASSWORD from the environment", () => {
    const prev = process.env.STEELDART_ADMIN_PASSWORD;
    process.env.STEELDART_ADMIN_PASSWORD = "  HostingerSecret  ";
    try {
      expect(getAdminPassword()).toBe("HostingerSecret");
      expect(passwordsMatch("HostingerSecret", getAdminPassword())).toBe(true);
      expect(passwordsMatch("  HostingerSecret  ", getAdminPassword())).toBe(true);
    } finally {
      if (prev == null) delete process.env.STEELDART_ADMIN_PASSWORD;
      else process.env.STEELDART_ADMIN_PASSWORD = prev;
    }
  });

  it("strips wrapping quotes Hostinger puts around env values", () => {
    const prev = process.env.STEELDART_ADMIN_PASSWORD;
    process.env.STEELDART_ADMIN_PASSWORD = '"QuotedSecret"';
    try {
      expect(getAdminPassword()).toBe("QuotedSecret");
      expect(passwordsMatch("QuotedSecret", getAdminPassword())).toBe(true);
    } finally {
      if (prev == null) delete process.env.STEELDART_ADMIN_PASSWORD;
      else process.env.STEELDART_ADMIN_PASSWORD = prev;
    }
  });
});
