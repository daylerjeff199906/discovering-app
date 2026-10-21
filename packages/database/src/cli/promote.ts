import { eq } from "drizzle-orm";
import { Pool } from "pg";
import { createDb } from "../index";
import { users } from "../schema";
import { databaseUrl } from "./env";

/**
 * Asigna el rol MODERATOR (o USER) a una cuenta existente.
 *   pnpm --filter @por-aqui/database db:promote tu@correo.com [USER|MODERATOR]
 * Los moderadores solo ven reportes y publicaciones, nunca diarios privados.
 */
async function main() {
  const [email, role = "MODERATOR"] = process.argv.slice(2);
  if (!email || !["USER", "MODERATOR"].includes(role)) {
    console.error("Uso: db:promote <correo> [USER|MODERATOR]");
    process.exit(1);
  }
  const pool = new Pool({ connectionString: databaseUrl(), max: 1 });
  try {
    const updated = await createDb(pool).update(users).set({ role }).where(eq(users.emailNormalized, email.trim().toLowerCase())).returning({ id: users.id });
    if (updated.length === 0) throw new Error(`No existe una cuenta con el correo ${email}`);
    console.log(`✔ ${email} ahora es ${role}`);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
