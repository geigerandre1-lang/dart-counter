import { startServer } from "./app.js";

startServer().catch((err) => {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "EADDRINUSE") {
    const port = process.env.PORT || "3000";
    console.error(
      process.env.PORT
        ? `PORT ${port} ist belegt. Hostinger erwartet genau diesen Port — keinen anderen binden.`
        : "Kein freier Port im Bereich 3000–3010. Andere App beenden oder mit PORT=3017 starten.",
    );
  } else {
    console.error(err);
  }
  process.exit(1);
});
