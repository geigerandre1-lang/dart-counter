import { startServer } from "./app.js";

startServer().catch((err) => {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "EADDRINUSE") {
    console.error(
      "Kein freier Port im Bereich 3000–3010. Andere App beenden oder mit PORT=3017 starten.",
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});
