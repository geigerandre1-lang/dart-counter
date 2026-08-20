import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const serverJs = path.join(root, "dist", "server.js");
const clientIndex = path.join(root, "dist", "client", "index.html");
const wasmDest = path.join(root, "dist", "sql-wasm.wasm");
const copyWasm = path.join(root, "scripts", "copy-sql-wasm.mjs");

function run(command, args, { shell = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      cwd: root,
      env: process.env,
      shell,
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        process.kill(process.pid, signal);
        return;
      }
      resolve(code ?? 1);
    });
  });
}

if (!existsSync(serverJs) || !existsSync(clientIndex)) {
  console.warn(
    "dist fehlt – einmaliger Build (vite + esbuild). Auf Hostinger Build-Befehl `npm run build` setzen, sonst läuft der Start in ein Proxy-Timeout.",
  );
  const code = await run("npm", ["run", "build:web"], { shell: true });
  if (code !== 0) process.exit(code);
}

if (!existsSync(wasmDest)) {
  const code = await run(process.execPath, [copyWasm]);
  if (code !== 0) process.exit(code);
}

await import(pathToFileURL(serverJs).href);
