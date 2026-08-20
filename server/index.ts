import { startServer } from "./app.js";

function bootLog(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  try {
    process.stdout.write(`${stamped}\n`);
  } catch {
    console.log(stamped);
  }
}

process.on("uncaughtException", (err) => {
  console.error(
    `[${new Date().toISOString()}] uncaughtException`,
    err && (err as Error).stack ? (err as Error).stack : err,
  );
});
process.on("unhandledRejection", (err) => {
  console.error(
    `[${new Date().toISOString()}] unhandledRejection`,
    err && (err as Error).stack ? (err as Error).stack : err,
  );
});

bootLog("dist/server loaded");

export const ready = startServer().catch((err) => {
  const code = (err as NodeJS.ErrnoException).code;
  const pinned = process.env.PORT || process.env.APP_PORT;
  if (code === "EADDRINUSE") {
    const port = pinned || "3000";
    console.error(
      pinned
        ? `PORT ${port} ist belegt. Hostinger erwartet genau diesen Port — keinen anderen binden.`
        : "Kein freier Port im Bereich 3000–3010. Andere App beenden oder mit PORT=3017 starten.",
    );
  } else {
    console.error(err);
  }
  process.exit(1);
  throw err;
});

export default ready;
