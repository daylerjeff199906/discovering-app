import { Pool } from "pg";
import { databaseUrl } from "./env";
import { runMigrations } from "../migrate";

/** SOLO DESARROLLO: borra todo el esquema público y vuelve a migrar. */
async function main() {
  const url = databaseUrl();
  if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
    throw new Error("db:reset está deshabilitado en producción.");
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await pool.query("DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;");
  } finally {
    await pool.end();
  }
  await runMigrations(url);
  console.log("✔ Base de datos reiniciada y migrada");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
