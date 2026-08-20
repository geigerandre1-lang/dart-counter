import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));

function sourceWasm() {
  try {
    return path.join(path.dirname(require.resolve("sql.js")), "sql-wasm.wasm");
  } catch {
    return path.join(root, "node_modules", "sql.js", "dist", "sql-wasm.wasm");
  }
}

const from = sourceWasm();
const destDir = path.join(root, "dist");
const dest = path.join(destDir, "sql-wasm.wasm");

if (!fs.existsSync(from)) {
  console.error(`sql.js WASM fehlt: ${from}`);
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(from, dest);
console.log(`sql.js WASM: ${from} -> ${dest}`);
