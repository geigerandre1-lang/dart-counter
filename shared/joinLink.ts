export function isMonitorPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "") === "/monitor";
}

export function parseRoomCodeFromHref(search: string, pathname: string): string | null {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const fromQuery = params.get("raum") ?? params.get("room") ?? params.get("code");
  if (fromQuery?.trim()) return fromQuery.trim().toUpperCase();
  const path = pathname.replace(/\/+$/, "");
  const match = path.match(/\/join\/([A-Za-z0-9]+)$/i);
  return match?.[1] ? match[1].toUpperCase() : null;
}

export function onlineJoinUrl(origin: string, code: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}/?raum=${encodeURIComponent(code.toUpperCase())}`;
}

function lanScore(url: string): number {
  try {
    const host = new URL(url).hostname;
    if (host.startsWith("192.168.")) return 40;
    if (host.startsWith("10.")) return 30;
    if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return 25;
    if (host.startsWith("169.254.")) return 0;
    if (host === "127.0.0.1" || host === "localhost") return 1;
    return 10;
  } catch {
    return 0;
  }
}

export function preferLanUrl(urls: string[]): string | null {
  if (!urls.length) return null;
  return [...urls].sort((a, b) => lanScore(b) - lanScore(a) || a.localeCompare(b))[0] ?? null;
}

export function joinUrlForSession(opts: {
  offline: boolean;
  lanUrls: string[];
  origin?: string | null;
  code: string;
}): string | null {
  if (opts.offline) return preferLanUrl(opts.lanUrls);
  if (opts.origin && opts.code && opts.code !== "LOCAL") return onlineJoinUrl(opts.origin, opts.code);
  return preferLanUrl(opts.lanUrls);
}

function pageListenPort(page: { protocol: string; port: string }): number {
  if (page.port) return Number(page.port);
  return page.protocol === "https:" ? 443 : 80;
}

/** True when the page is the public reverse-proxy URL (Hostinger :443), not Vite. */
function isPublicHttpOrigin(page: { protocol: string; port: string }): boolean {
  const port = pageListenPort(page);
  if (page.protocol === "https:") return port === 443;
  if (page.protocol === "http:") return port === 80;
  return false;
}

/** HTTP origin the UI should call for REST/WS — follows /api/info.port after fallback. */
export function apiOriginFromPage(
  page: { protocol: string; hostname: string; port: string; origin: string },
  infoPort: number | undefined,
): string {
  if (page.protocol === "file:") {
    return typeof infoPort === "number" && infoPort > 0 ? `http://127.0.0.1:${infoPort}` : "";
  }
  // Hosted HTTPS (dart-counter.turniertool.eu) reports Node's bind PORT (3000).
  // Retargeting to :3000 breaks Admin login and WebSocket on the public domain.
  if (isPublicHttpOrigin(page)) return page.origin;
  if (typeof infoPort === "number" && infoPort > 0) {
    const pagePort = pageListenPort(page);
    if (Number.isFinite(pagePort) && pagePort !== infoPort) {
      return `${page.protocol}//${page.hostname}:${infoPort}`;
    }
  }
  return page.origin;
}
