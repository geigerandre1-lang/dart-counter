/**
 * Hostinger CJS wrapper. Panel field: Application startup file = server.js
 * Dynamic import() is valid in CommonJS and in this ESM package (`node server.js`).
 */
"use strict";

process.on("uncaughtException", function (err) {
  console.error("uncaughtException", err && err.stack ? err.stack : err);
});
process.on("unhandledRejection", function (err) {
  console.error("unhandledRejection", err && err.stack ? err.stack : err);
});

console.log("Hostinger-Start: server.js -> app.js");

import("./app.js").catch(function (err) {
  console.error("uncaughtException", err && err.stack ? err.stack : err);
  process.exit(1);
});
