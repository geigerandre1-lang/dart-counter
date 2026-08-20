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
});
