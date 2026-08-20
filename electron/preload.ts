import { contextBridge, ipcRenderer } from "electron";

export interface DesktopSession {
  mode: "offline" | "online";
  origin: string;
  lanUrls: string[];
  resumeCode?: string;
}

contextBridge.exposeInMainWorld("steeldartDesktop", {
  kiosk: true,
  getState: () => ipcRenderer.invoke("desktop:getState"),
  offlineStatus: () => ipcRenderer.invoke("desktop:offlineStatus"),
  startOffline: (opts?: { resume?: boolean }) => ipcRenderer.invoke("desktop:startOffline", opts),
  connectOnline: (url?: string) => ipcRenderer.invoke("desktop:connectOnline", url),
  rememberOnline: (origin: string, code: string) =>
    ipcRenderer.invoke("desktop:rememberOnline", { origin, code }),
  clearOnlineResume: () => ipcRenderer.invoke("desktop:clearOnlineResume"),
  disconnect: () => ipcRenderer.invoke("desktop:disconnect"),
  adminLogin: (password: string) => ipcRenderer.invoke("desktop:adminLogin", password),
  saveSettings: (patch: {
    remoteUrl?: string;
    offlinePort?: number;
    boardName?: string;
    resetBoard?: boolean;
  }) => ipcRenderer.invoke("desktop:saveSettings", patch),
  listPlayers: () => ipcRenderer.invoke("desktop:listPlayers"),
  createPlayer: (name: string, passNr?: string | null) => ipcRenderer.invoke("desktop:createPlayer", name, passNr),
  listTeams: () => ipcRenderer.invoke("desktop:listTeams"),
  mutateTeam: (action: "create" | "rename" | "delete", payload: { id?: string; name?: string }) =>
    ipcRenderer.invoke("desktop:mutateTeam", action, payload),
  setPlayerTeam: (playerId: string, teamId: string | null) =>
    ipcRenderer.invoke("desktop:setPlayerTeam", playerId, teamId),
  createTeamPlayer: (teamId: string, name: string, passNr?: string | null) =>
    ipcRenderer.invoke("desktop:createTeamPlayer", teamId, name, passNr),
  removePlayerFromTeam: (playerId: string, teamId: string, keepRecord?: boolean) =>
    ipcRenderer.invoke("desktop:removePlayerFromTeam", playerId, teamId, keepRecord),
  importRoster: (csv: string) => ipcRenderer.invoke("desktop:importRoster", csv),
  listSpieltage: () => ipcRenderer.invoke("desktop:listSpieltage"),
  getSpieltag: (id: string) => ipcRenderer.invoke("desktop:getSpieltag", id),
  rebuildTodaySpieltag: () => ipcRenderer.invoke("desktop:rebuildTodaySpieltag"),
  startNewSpieltag: () => ipcRenderer.invoke("desktop:startNewSpieltag"),
  headToHead: () => ipcRenderer.invoke("desktop:headToHead"),
  listStats: () => ipcRenderer.invoke("desktop:listStats"),
  playerStats: (playerId: string) => ipcRenderer.invoke("desktop:playerStats", playerId),
  deletePlayer: (playerId: string) => ipcRenderer.invoke("desktop:deletePlayer", playerId),
  resetStats: (playerId?: string) => ipcRenderer.invoke("desktop:resetStats", playerId),
  exportStats: (format?: string) => ipcRenderer.invoke("desktop:exportStats", format),
});
