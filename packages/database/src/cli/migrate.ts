import { runMigrations } from "../migrate";
import { databaseUrl } from "./env";

runMigrations(databaseUrl())
  .then(() => console.log("✔ Migraciones aplicadas"))
  .catch((err) => {
    console.error("✘ Error aplicando migraciones:", err);
    process.exit(1);
  });
