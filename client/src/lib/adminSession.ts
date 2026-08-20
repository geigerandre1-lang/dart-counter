export const TOKEN_KEY = "steeldart-admin-token";

export function loadAdminToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function saveAdminToken(token: string | null): void {
  if (token) sessionStorage.setItem(TOKEN_KEY, token);
  else sessionStorage.removeItem(TOKEN_KEY);
}
