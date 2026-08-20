import { describe, expect, it } from "vitest";
import { isMonitorPath, apiOriginFromPage, joinUrlForSession, onlineJoinUrl, parseRoomCodeFromHref, preferLanUrl } from "./joinLink";
import { isLiveMonitorMatch, monitorBoardLabel } from "./protocol";

describe("join links", () => {
  it("recognizes the hosted monitor path", () => {
    expect(isMonitorPath("/monitor")).toBe(true);
    expect(isMonitorPath("/monitor/")).toBe(true);
    expect(isMonitorPath("/monitor/foo")).toBe(false);
    expect(isMonitorPath("/")).toBe(false);
  });

  it("labels monitor boards by Anlagen-Name only, never a room code", () => {
    expect(monitorBoardLabel("Scheibe 1")).toBe("Scheibe 1");
    expect(monitorBoardLabel("  Haupthalle  ")).toBe("Haupthalle");
    expect(monitorBoardLabel(null)).toBe("Scheibe");
    expect(monitorBoardLabel("")).toBe("Scheibe");
    expect(monitorBoardLabel("   ")).toBe("Scheibe");
  });

  it("treats only in-progress match statuses as live monitor games", () => {
    expect(isLiveMonitorMatch(null)).toBe(false);
    expect(isLiveMonitorMatch({ status: "playing" } as never)).toBe(true);
    expect(isLiveMonitorMatch({ status: "legOver" } as never)).toBe(true);
    expect(isLiveMonitorMatch({ status: "setOver" } as never)).toBe(true);
    expect(isLiveMonitorMatch({ status: "bullUp" } as never)).toBe(true);
    expect(isLiveMonitorMatch({ status: "matchOver" } as never)).toBe(false);
  });

  it("parses raum query and /join path", () => {
    expect(parseRoomCodeFromHref("?raum=ab12", "/")).toBe("AB12");
    expect(parseRoomCodeFromHref("room=k7rp", "/foo")).toBe("K7RP");
    expect(parseRoomCodeFromHref("", "/join/xyz9")).toBe("XYZ9");
    expect(parseRoomCodeFromHref("", "/")).toBeNull();
  });

  it("prefers typical LAN IPv4 over link-local", () => {
    expect(
      preferLanUrl(["http://169.254.1.1:3000", "http://192.168.1.20:3000", "http://10.0.0.5:3000"]),
    ).toBe("http://192.168.1.20:3000");
  });

  it("builds online join URL with room id", () => {
    expect(onlineJoinUrl("https://dart.example.com/", "ab12")).toBe("https://dart.example.com/?raum=AB12");
    expect(
      joinUrlForSession({
        offline: false,
        lanUrls: [],
        origin: "https://dart.example.com",
        code: "K7RP",
      }),
    ).toBe("https://dart.example.com/?raum=K7RP");
  });

  it("points Vite (5173) and file:// at the real API port after fallback", () => {
    expect(
      apiOriginFromPage(
        { protocol: "http:", hostname: "127.0.0.1", port: "5173", origin: "http://127.0.0.1:5173" },
        3001,
      ),
    ).toBe("http://127.0.0.1:3001");
    expect(
      apiOriginFromPage(
        { protocol: "http:", hostname: "192.168.1.20", port: "3001", origin: "http://192.168.1.20:3001" },
        3001,
      ),
    ).toBe("http://192.168.1.20:3001");
    expect(apiOriginFromPage({ protocol: "file:", hostname: "", port: "", origin: "file://" }, 3001)).toBe(
      "http://127.0.0.1:3001",
    );
  });
});
