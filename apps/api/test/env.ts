import { existsSync } from "node:fs";
import path from "node:path";

export const TEST_DB_NAME = "poraqui_test";

/** Carga .env y apunta DATABASE_URL a una base de datos de pruebas separada (nunca la de desarrollo). */
export function applyTestEnv(): { adminUrl: string; testUrl: string } {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const f = path.join(dir, ".env");
    if (existsSync(f)) {
      process.loadEnvFile(f);
      break;
    }
    dir = path.dirname(dir);
  }
  const adminUrl = process.env.DATABASE_URL!;
  const u = new URL(adminUrl);
  u.pathname = `/${TEST_DB_NAME}`;
  const testUrl = u.toString();
  process.env.DATABASE_URL = testUrl;
  process.env.NODE_ENV = "test";
  process.env.RATE_LIMIT_ENABLED = "false";
  process.env.ENABLE_DEMO_CONTENT = "false";
  process.env.S3_BUCKET = "poraqui-media-test";
  process.env.REDIS_URL = (process.env.REDIS_URL ?? "redis://localhost:6380").replace(/\/\d*$/, "") + "/0";
  return { adminUrl, testUrl };
}
