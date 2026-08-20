export interface RosterCsvRow {
  team: string;
  passNr: string;
  name: string;
  line: number;
}

export interface RosterCsvParseResult {
  rows: RosterCsvRow[];
  errors: string[];
}

function stripCell(value: string): string {
  return value.trim().replace(/^["']|["']$/g, "").trim();
}

function headerKey(value: string): string {
  return stripCell(value)
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
}

export function parseTeamRosterCsv(text: string): RosterCsvParseResult {
  const raw = String(text ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  const lines = raw.split("\n");
  const rows: RosterCsvRow[] = [];
  const errors: string[] = [];
  let headerFound = false;
  let teamIdx = -1;
  let passIdx = -1;
  let nameIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const cells = line.split(";").map(stripCell);
    if (!headerFound) {
      const keys = cells.map(headerKey);
      teamIdx = keys.findIndex((k) => k === "team");
      passIdx = keys.findIndex((k) => k === "passnr" || k === "pass");
      nameIdx = keys.findIndex((k) => k === "name");
      if (teamIdx < 0 || passIdx < 0 || nameIdx < 0) {
        errors.push(`Zeile ${i + 1}: Kopfzeile muss TEAM;PassNr;Name enthalten.`);
        return { rows, errors };
      }
      headerFound = true;
      continue;
    }
    const team = cells[teamIdx] ?? "";
    const passNr = cells[passIdx] ?? "";
    const name = cells[nameIdx] ?? "";
    if (!team && !passNr && !name) continue;
    const missing = [!team ? "TEAM" : null, !name ? "Name" : null].filter(
      (part): part is string => Boolean(part),
    );
    if (missing.length) {
      errors.push(`Zeile ${i + 1}: ${missing.join(", ")} fehlt.`);
      continue;
    }
    rows.push({ team, passNr, name, line: i + 1 });
  }

  if (!headerFound) {
    errors.push("Keine Kopfzeile gefunden. Erwartet: TEAM;PassNr;Name.");
  }
  return { rows, errors };
}
