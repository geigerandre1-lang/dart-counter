import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const root = process.cwd();
const serverJs = path.join(root, "dist", "server.js");
const clientIndex = path.join(root, "dist", "client", "index.html");

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
  console.log("dist fehlt – baue Web-App (vite + esbuild)…");
  const code = await run("npm", ["run", "build:web"], { shell: true });
  if (code !== 0) process.exit(code);
}

const code = await run(process.execPath, [serverJs]);
process.exit(code);
