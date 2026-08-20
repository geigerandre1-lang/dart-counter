import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);

const require = createRequire(path.join(root, "package.json"));
await require(path.join(root, "server.cjs"));
