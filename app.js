/**
 * ESM entry. Hostinger Express that require()s this file will crash with
 * ERR_REQUIRE_ESM because package.json has "type": "module".
 * Panel field "Eingabedatei" = server.cjs
 */
import fs from "node:fs";
import { createRequire } from "node:module";

try {
  fs.writeSync(1, "steeldart starting\n");
} catch {
  console.log("steeldart starting");
}

const require = createRequire(import.meta.url);
export default await require("./server.cjs");
