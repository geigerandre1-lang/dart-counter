/**
 * Hostinger Node.js: Application startup file = app.js
 * (Panel erwartet eine JS-Datei, nicht `npm start` als Dateiname.)
 * package.json "main" bleibt dist/electron.cjs für die Desktop-App — nicht als Web-Start nutzen.
 */
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);

const serverJs = path.join(root, "dist", "server.js");
const wasmDest = path.join(root, "dist", "sql-wasm.wasm");
const copyWasm = path.join(root, "scripts", "copy-sql-wasm.mjs");

console.log("Hostinger-Start: app.js -> dist/server.js");

if (!existsSync(serverJs)) {
  console.error(
    "dist/server.js fehlt. In hPanel Build-Befehl `npm run build` setzen, Redeploy, dann diese Datei als Startdatei.",
  );
  process.exit(1);
}

if (!existsSync(wasmDest)) {
  const copy = spawnSync(process.execPath, [copyWasm], { cwd: root, stdio: "inherit" });
  if (copy.status !== 0) process.exit(copy.status ?? 1);
}

await import(pathToFileURL(serverJs).href);
