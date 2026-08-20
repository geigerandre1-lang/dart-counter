/**
 * Hostinger Node.js startup (ESM). Panel field: Application startup file = app.js
 * package.json "main" points here so “use package.json main” does not start Electron.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
process.chdir(root);

process.on("uncaughtException", (err) => {
  console.error("uncaughtException", err && err.stack ? err.stack : err);
});
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection", err && err.stack ? err.stack : err);
});

const require = createRequire(path.join(root, "package.json"));
const serverJs = path.join(root, "dist", "server.js");
const clientIndex = path.join(root, "dist", "client", "index.html");
const wasmDest = path.join(root, "dist", "sql-wasm.wasm");

function log(...args) {
  console.log("Hostinger-Start:", ...args);
}

function run(command, args) {
  log("run", command, args.join(" "));
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error("Hostinger-Start: spawn error", result.error);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error("Hostinger-Start: command failed", command, result.status);
    process.exit(result.status ?? 1);
  }
}

function localBin(pkg, rel) {
  const file = path.join(root, "node_modules", pkg, rel);
  return existsSync(file) ? file : "";
}

function runViteOrEsbuild(pkg, args) {
  const binRel = pkg === "vite" ? path.join("bin", "vite.js") : path.join("bin", "esbuild");
  const local = localBin(pkg, binRel);
  if (local) {
    run(process.execPath, [local, ...args]);
    return;
  }
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  run(npx, [pkg, ...args]);
}

function copyWasm() {
  if (existsSync(wasmDest)) {
    log("sql-wasm.wasm ok", wasmDest);
    return;
  }
  let from = "";
  try {
    from = path.join(path.dirname(require.resolve("sql.js")), "sql-wasm.wasm");
  } catch {
    from = "";
  }
  const fallbacks = [
    from,
    path.join(root, "node_modules", "sql.js", "dist", "sql-wasm.wasm"),
  ].filter(Boolean);
  const src = fallbacks.find((file) => existsSync(file));
  if (!src) {
    console.error("Hostinger-Start: sql.js WASM fehlt (node_modules/sql.js/dist/sql-wasm.wasm)");
    process.exit(1);
  }
  mkdirSync(path.dirname(wasmDest), { recursive: true });
  copyFileSync(src, wasmDest);
  log("copied sql-wasm.wasm", src, "->", wasmDest);
}

log("cwd", root);
log("node", process.version);
log(
  "PORT",
  process.env.PORT ?? "",
  "APP_PORT",
  process.env.APP_PORT ?? "",
  "HOST",
  process.env.HOST ?? "0.0.0.0",
  "STEELDART_MODE",
  process.env.STEELDART_MODE ?? "",
);

if (!existsSync(clientIndex)) {
  log("dist/client missing — npx vite build once");
  runViteOrEsbuild("vite", ["build"]);
}

if (!existsSync(serverJs)) {
  log("dist/server.js missing — esbuild once");
  runViteOrEsbuild("esbuild", [
    "server/index.ts",
    "--bundle",
    "--platform=node",
    "--format=esm",
    "--outfile=dist/server.js",
    "--packages=external",
  ]);
}

copyWasm();

if (!existsSync(serverJs)) {
  console.error("Hostinger-Start: dist/server.js still missing after build");
  process.exit(1);
}

log("import", serverJs);
await import(pathToFileURL(serverJs).href);
