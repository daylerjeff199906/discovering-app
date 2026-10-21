import { createDb, createPool, runMigrations, seedCatalog } from "@por-aqui/database";
import { Pool } from "pg";
import { TEST_DB_NAME, applyTestEnv } from "./env";

/** Crea una base de datos de pruebas limpia (PostgreSQL + PostGIS reales), migra y siembra el catálogo. */
export default async function setup() {
  const { adminUrl, testUrl } = applyTestEnv();
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  try {
    await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB_NAME} WITH (FORCE)`);
    await admin.query(`CREATE DATABASE ${TEST_DB_NAME}`);
  } finally {
    await admin.end();
  }
  await runMigrations(testUrl);
  const pool = createPool(testUrl, { max: 2 });
  await seedCatalog(createDb(pool));
  await pool.end();
}
