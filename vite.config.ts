import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = path.dirname(fileURLToPath(import.meta.url));
const STEELDART_APP = "steeldart-counter";
const preferredPort = Number(process.env.PORT ?? 3000);
let apiOrigin = `http://127.0.0.1:${preferredPort}`;

async function discoverApiOrigin(): Promise<string> {
  const ports = [preferredPort, ...Array.from({ length: 10 }, (_, i) => preferredPort + i + 1)];
  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/info`, {
        signal: AbortSignal.timeout(400),
      });
      if (!res.ok) continue;
      const data = (await res.json()) as { app?: string };
      if (data.app === STEELDART_APP) return `http://127.0.0.1:${port}`;
    } catch {
      /* try next */
    }
  }
  return `http://127.0.0.1:${preferredPort}`;
}

export default defineConfig({
  root: path.join(rootDir, "client"),
  publicDir: path.join(rootDir, "client/public"),
  base: "./",
  plugins: [
    react(),
    {
      name: "steeldart-api-port",
      configureServer(server) {
        const tick = () => {
          void discoverApiOrigin().then((origin) => {
            apiOrigin = origin;
          });
        };
        tick();
        const id = setInterval(tick, 1500);
        server.httpServer?.once("close", () => clearInterval(id));
      },
    },
  ],
  resolve: {
    alias: {
      "@shared": path.join(rootDir, "shared"),
    },
  },
  build: {
    outDir: path.join(rootDir, "dist/client"),
    emptyOutDir: true,
    sourcemap: true,
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
        router: () => apiOrigin,
      },
      "/ws": {
        target: "ws://127.0.0.1:3000",
        ws: true,
        router: () => apiOrigin.replace(/^http/, "ws"),
      },
    },
  },
});
