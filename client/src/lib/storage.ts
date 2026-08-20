import { createDefaultConfig, normalizeConfig, type MatchConfig } from "@shared/index";

const KEY = "steeldart-setup";

export function loadSetupDraft(): MatchConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return createDefaultConfig();
    return normalizeConfig({ ...createDefaultConfig(), ...(JSON.parse(raw) as MatchConfig) });
  } catch {
    return createDefaultConfig();
  }
}

export function saveSetupDraft(config: MatchConfig): void {
  localStorage.setItem(KEY, JSON.stringify(config));
}

export function loadSound(): boolean {
  return localStorage.getItem("steeldart-sound") !== "off";
}

export function saveSound(on: boolean): void {
  localStorage.setItem("steeldart-sound", on ? "on" : "off");
}

export function saveRoom(code: string): void {
  localStorage.setItem("steeldart-room", code);
}

export function loadRoom(): string | null {
  return localStorage.getItem("steeldart-room");
}

export function clearRoom(): void {
  localStorage.removeItem("steeldart-room");
}
