import { describe, expect, it } from "vitest";
import { ROOM_IDLE_MS, isFresh } from "./persist";

describe("2h persistence window", () => {
  it("treats a save from 1h ago as fresh and 2h+ as stale", () => {
    const now = 1_700_000_000_000;
    expect(isFresh(now - 60 * 60 * 1000, now)).toBe(true);
    expect(isFresh(now - ROOM_IDLE_MS, now)).toBe(true);
    expect(isFresh(now - ROOM_IDLE_MS - 1, now)).toBe(false);
    expect(isFresh(0, now)).toBe(false);
  });
});
