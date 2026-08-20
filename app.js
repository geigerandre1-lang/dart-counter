/**
 * Hostinger Express entry (Eingabedatei = app.js). CommonJS copy of server.cjs.
 * `node app.js` and `require("./app.js")` both work (package.json is not "type": "module").
 */
"use strict";

var fs = require("fs");
var path = require("path");
var childProcess = require("child_process");
var moduleApi = require("module");
var url = require("url");

function writeLine(line) {
  try {
    fs.writeSync(1, String(line) + "\n");
  } catch (_err) {
    console.log(line);
  }
}

function log() {
  var args = Array.prototype.slice.call(arguments);
  writeLine("[" + new Date().toISOString() + "] " + args.join(" "));
}

writeLine("steeldart starting");

process.on("uncaughtException", function (err) {
  writeLine(
    "[" +
      new Date().toISOString() +
      "] uncaughtException " +
      (err && err.stack ? err.stack : err),
  );
});
process.on("unhandledRejection", function (err) {
  writeLine(
    "[" +
      new Date().toISOString() +
      "] unhandledRejection " +
      (err && err.stack ? err.stack : err),
  );
});

var root = __dirname;
try {
  process.chdir(root);
} catch (_err) {
  /* ignore */
}

var requireFromRoot = moduleApi.createRequire(path.join(root, "package.json"));
var serverJs = path.join(root, "dist", "server.mjs");
var serverCjs = path.join(root, "dist", "server.cjs");
var clientIndex = path.join(root, "dist", "client", "index.html");
var wasmDest = path.join(root, "dist", "sql-wasm.wasm");

function run(command, args, exitOnFail) {
  log("run", command, args.join(" "));
  var result = childProcess.spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
  });
  if (result.error) {
    console.error("steeldart spawn error", result.error);
    if (exitOnFail) process.exit(1);
    return false;
  }
  if (result.status !== 0) {
    console.error("steeldart command failed", command, result.status);
    if (exitOnFail) process.exit(result.status == null ? 1 : result.status);
    return false;
  }
  return true;
}

function localBin(pkg, rel) {
  var file = path.join(root, "node_modules", pkg, rel);
  return fs.existsSync(file) ? file : "";
}

function runViteOrEsbuild(pkg, args, exitOnFail) {
  var binRel = pkg === "vite" ? path.join("bin", "vite.js") : path.join("bin", "esbuild");
  var local = localBin(pkg, binRel);
  if (local) {
    return run(process.execPath, [local].concat(args), exitOnFail);
  }
  var npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return run(npx, [pkg].concat(args), exitOnFail);
}

function copyWasm() {
  if (fs.existsSync(wasmDest)) {
    log("sql-wasm.wasm ok", wasmDest);
    return;
  }
  var from = "";
  try {
    from = path.join(path.dirname(requireFromRoot.resolve("sql.js")), "sql-wasm.wasm");
  } catch (_err) {
    from = "";
  }
  var fallbacks = [from, path.join(root, "node_modules", "sql.js", "dist", "sql-wasm.wasm")].filter(
    Boolean,
  );
  var src = fallbacks.find(function (file) {
    return fs.existsSync(file);
  });
  if (!src) {
    console.error("steeldart sql.js WASM missing (node_modules/sql.js/dist/sql-wasm.wasm)");
    process.exit(1);
  }
  fs.mkdirSync(path.dirname(wasmDest), { recursive: true });
  fs.copyFileSync(src, wasmDest);
  log("copied sql-wasm.wasm", src, "->", wasmDest);
}

function distExists() {
  return fs.existsSync(serverJs) || fs.existsSync(serverCjs);
}

function esbuildArgs(format, outfile) {
  return [
    "server/index.ts",
    "--bundle",
    "--platform=node",
    "--format=" + format,
    "--outfile=" + outfile,
    "--packages=external",
  ];
}

function distMtime() {
  var t = 0;
  if (fs.existsSync(serverCjs)) t = Math.max(t, fs.statSync(serverCjs).mtimeMs);
  if (fs.existsSync(serverJs)) t = Math.max(t, fs.statSync(serverJs).mtimeMs);
  return t;
}

function newestSourceMtime(dir) {
  var max = 0;
  if (!fs.existsSync(dir)) return 0;
  var entries = fs.readdirSync(dir, { withFileTypes: true });
  for (var i = 0; i < entries.length; i++) {
    var full = path.join(dir, entries[i].name);
    if (entries[i].isDirectory()) {
      max = Math.max(max, newestSourceMtime(full));
    } else if (/\.(ts|js)$/.test(entries[i].name)) {
      max = Math.max(max, fs.statSync(full).mtimeMs);
    }
  }
  return max;
}

function bundleStale() {
  if (!distExists()) return true;
  var srcTime = Math.max(
    newestSourceMtime(path.join(root, "server")),
    newestSourceMtime(path.join(root, "shared")),
  );
  return srcTime > distMtime();
}

function ensureServerBundle() {
  if (!bundleStale()) {
    log("dist/server up to date");
    return;
  }
  log("esbuild server bundle");
  var okEsm = runViteOrEsbuild("esbuild", esbuildArgs("esm", "dist/server.mjs"), false);
  var okCjs = runViteOrEsbuild("esbuild", esbuildArgs("cjs", "dist/server.cjs"), false);
  if (okEsm || okCjs || distExists()) return;
  console.error("steeldart dist/server still missing after esbuild");
  process.exit(1);
}

log("cwd", root);
log("node", process.version);
log(
  "PORT",
  process.env.PORT || "",
  "APP_PORT",
  process.env.APP_PORT || "",
  "HOST",
  process.env.HOST || "0.0.0.0",
  "STEELDART_MODE",
  process.env.STEELDART_MODE || "",
);

if (!fs.existsSync(clientIndex)) {
  log("dist/client missing — vite build once");
  runViteOrEsbuild("vite", ["build"], true);
}

ensureServerBundle();
copyWasm();

if (!distExists()) {
  console.error("steeldart dist/server still missing after build");
  process.exit(1);
}

function attachExport(started) {
  var app = started && started.app ? started.app : started;
  if (app && started && started.server) {
    app.server = started.server;
  }
  module.exports = app || module.exports;
  return app;
}

function unwrap(value) {
  if (value && typeof value.then === "function") return value;
  if (value && value.ready && typeof value.ready.then === "function") return value.ready;
  if (value && value.default && typeof value.default.then === "function") return value.default;
  return Promise.resolve(value && (value.ready || value.default || value));
}

function loadDist() {
  if (fs.existsSync(serverCjs)) {
    log("require", serverCjs);
    return unwrap(requireFromRoot(serverCjs));
  }
  log("import", serverJs);
  return import(url.pathToFileURL(serverJs).href).then(function (mod) {
    return unwrap(mod);
  });
}

var boot = loadDist()
  .then(function (started) {
    return unwrap(started).then(attachExport);
  })
  .catch(function (err) {
    writeLine("[" + new Date().toISOString() + "] " + (err && err.stack ? err.stack : err));
    process.exit(1);
  });

module.exports = boot;
module.exports.ready = boot;
