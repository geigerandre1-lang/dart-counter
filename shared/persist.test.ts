import { describe, expect, it } from "vitest";
import { ROOM_IDLE_MS, isFresh, pickBoardResume, storeBoardResume } from "./persist";

describe("2h persistence window", () => {
  it("treats a save from 1h ago as fresh and 2h+ as stale", () => {
    const now = 1_700_000_000_000;
    expect(isFresh(now - 60 * 60 * 1000, now)).toBe(true);
    expect(isFresh(now - ROOM_IDLE_MS, now)).toBe(true);
    expect(isFresh(now - ROOM_IDLE_MS - 1, now)).toBe(false);
    expect(isFresh(0, now)).toBe(false);
  });
});

describe("per-board online resume", () => {
  const now = 1_700_000_000_000;
  const server = "https://dart-counter.turniertool.eu";

  it("resumes only the same board's room on the same server", () => {
    const resumes = storeBoardResume(undefined, `${server}/`, "K7RP", "board-1", now);
    expect(pickBoardResume(resumes, null, server, "board-1", now)?.roomCode).toBe("K7RP");
    expect(pickBoardResume(resumes, null, server, "board-2", now)).toBeNull();
    expect(pickBoardResume(resumes, null, "https://other.example", "board-1", now)).toBeNull();
    expect(pickBoardResume(resumes, null, server, "board-1", now + ROOM_IDLE_MS + 1)).toBeNull();
  });

  it("never uses another board's legacy global last-room", () => {
    const legacy = {
      serverUrl: server,
      roomCode: "AAAAA",
      boardId: "board-1",
      savedAt: now,
    };
    expect(pickBoardResume(undefined, legacy, server, "board-2", now)).toBeNull();
    expect(pickBoardResume(undefined, { ...legacy, boardId: "" }, server, "board-2", now)).toBeNull();
  });
});
