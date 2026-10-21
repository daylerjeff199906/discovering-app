import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolConfig } from "pg";
import * as schema from "./schema";

export * from "./schema";
export * from "./geometry";
export { schema };

export type Db = ReturnType<typeof createDb>;
export type DbTx = Parameters<Parameters<Db["transaction"]>[0]>[0];
/** Cualquier ejecutor de consultas: la conexión base o una transacción. */
export type DbExecutor = Db | DbTx;

export function createPool(connectionString: string, config: PoolConfig = {}): Pool {
  return new Pool({ connectionString, max: 10, ...config });
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema });
}
export { runMigrations } from "./migrate";
export { seedCatalog } from "./seed-catalog";
export { INTERESTS, PLACES } from "./seed-data";
