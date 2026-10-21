import { existsSync } from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";

/** Carpeta de migraciones, tanto desde `src/` (tsx) como desde `dist/` (paquete compilado). */
function migrationsFolder(): string {
  const candidates = [path.resolve(__dirname, "../migrations"), path.resolve(__dirname, "../../migrations")];
  const found = candidates.find((c) => existsSync(path.join(c, "meta", "_journal.json")));
  if (!found) throw new Error("No se encontró la carpeta de migraciones");
  return found;
}

/** Paso único de release: aplicar migraciones. No se ejecuta al arrancar cada réplica. */
export async function runMigrations(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: migrationsFolder() });
  } finally {
    await pool.end();
  }
}
