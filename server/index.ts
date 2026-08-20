import { startServer } from "./app.js";

process.on("uncaughtException", (err) => {
  console.error("uncaughtException", err && err.stack ? err.stack : err);
});
process.on("unhandledRejection", (err) => {
  console.error("unhandledRejection", err && err.stack ? err.stack : err);
});

startServer().catch((err) => {
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
});
