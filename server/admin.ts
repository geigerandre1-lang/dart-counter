import { randomBytes, timingSafeEqual } from "node:crypto";

export const MAX_ONLINE_ROOMS = 4;
export const DEFAULT_ADMIN_PASSWORD = "Admin17";
const TOKEN_TTL_MS = 1000 * 60 * 60 * 12;

const tokens = new Map<string, number>();

export function getAdminPassword(): string {
  const fromEnv = process.env.STEELDART_ADMIN_PASSWORD;
  return fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_ADMIN_PASSWORD;
}

export function passwordsMatch(given: string | undefined, expected: string): boolean {
  const a = Buffer.from(String(given ?? ""), "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    timingSafeEqual(b, b);
    return false;
  }
  return timingSafeEqual(a, b);
}

function pruneTokens(now = Date.now()): void {
  for (const [token, exp] of tokens) {
    if (exp <= now) tokens.delete(token);
  }
}

export function issueAdminToken(): string {
  pruneTokens();
  const token = randomBytes(24).toString("hex");
  tokens.set(token, Date.now() + TOKEN_TTL_MS);
  return token;
}

export function adminTokenValid(token: string | undefined): boolean {
  if (!token) return false;
  pruneTokens();
  const exp = tokens.get(token);
  return exp != null && exp > Date.now();
}

export function revokeAdminToken(token: string | undefined): void {
  if (token) tokens.delete(token);
}

export function authorizeRoomCreate(auth: {
  password?: string;
  adminToken?: string;
}): { ok: true } | { ok: false; error: string } {
  if (adminTokenValid(auth.adminToken) || passwordsMatch(auth.password, getAdminPassword())) {
    return { ok: true };
  }
  return { ok: false, error: "Falsches Passwort." };
}

export function roomCapError(count: number, max = MAX_ONLINE_ROOMS): string | null {
  if (count >= max) {
    return `Es sind bereits ${max} Räume aktiv. Bitte einem bestehenden Raum beitreten oder warten, bis ein Raum frei wird.`;
  }
  return null;
}
