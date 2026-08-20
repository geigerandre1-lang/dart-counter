import { describe, expect, it } from "vitest";
import { parseTeamRosterCsv } from "./rosterCsv.js";

describe("parseTeamRosterCsv", () => {
  it("allows empty PassNr", () => {
    const parsed = parseTeamRosterCsv("TEAM;PassNr;Name\nTraining;;Max\n1. Mannschaft;12345;Andre\n");
    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      { team: "Training", passNr: "", name: "Max", line: 2 },
      { team: "1. Mannschaft", passNr: "12345", name: "Andre", line: 3 },
    ]);
  });

  it("still requires TEAM and Name", () => {
    const parsed = parseTeamRosterCsv("TEAM;PassNr;Name\n;99;Ohne Team\nTraining;;\n");
    expect(parsed.rows).toEqual([]);
    expect(parsed.errors.some((err) => err.includes("TEAM fehlt"))).toBe(true);
    expect(parsed.errors.some((err) => err.includes("Name fehlt"))).toBe(true);
    expect(parsed.errors.some((err) => /PassNr fehlt/.test(err))).toBe(false);
  });
});
