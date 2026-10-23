import { existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

const bool = (def: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(def)
    .transform((v) => v === "true");

const DEV_ENCRYPTION_KEY = "ZGV2LW9ubHktMzItYnl0ZS1rZXktZm9yLXBvcmFxdWk=";

export const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_ENV: z.enum(["development", "demo", "production"]).default("development"),
    API_PORT: z.coerce.number().int().default(4000),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    WEB_ORIGIN: z.string().url(),
    ALLOWED_ORIGINS: z
      .string()
      .default("")
      .transform((v) => v.split(",").map((s) => s.trim()).filter(Boolean)),
    PUBLIC_SITE_URL: z.string().url(),
    TRUST_PROXY: z.string().default("false"),
    COOKIE_SECURE: bool("false"),
    SESSION_COOKIE_NAME: z.string().default("pa_session"),
    CSRF_COOKIE_NAME: z.string().default("pa_csrf"),
    SESSION_ABSOLUTE_TTL_DAYS: z.coerce.number().int().min(1).default(30),
    SESSION_IDLE_TTL_DAYS: z.coerce.number().int().min(1).default(7),
    APP_ENCRYPTION_KEY: z.string().refine((v) => Buffer.from(v, "base64").length === 32, "Debe ser 32 bytes en base64"),
    RATE_LIMIT_ENABLED: bool("true"),

    // Cloudflare R2 (API compatible con S3). El bucket es PRIVADO: los archivos se leen a través de la API.
    R2_ACCOUNT_ID: z.string().default(""),
    R2_ACCESS_KEY_ID: z.string().default(""),
    R2_SECRET_ACCESS_KEY: z.string().default(""),
    R2_BUCKET: z.string().default(""),
    /** Opcional. Por defecto https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com */
    R2_ENDPOINT: z.string().default(""),
    UPLOAD_URL_TTL_SECONDS: z.coerce.number().int().min(30).default(300),
    MEDIA_TICKET_TTL_SECONDS: z.coerce.number().int().min(30).default(900),
    MEDIA_MAX_BYTES: z.coerce.number().int().default(10 * 1024 * 1024),
    MEDIA_MAX_PIXELS: z.coerce.number().int().default(60_000_000),
    MEDIA_MAX_PER_VISIT: z.coerce.number().int().default(20),
    MEDIA_MAX_PER_USER: z.coerce.number().int().default(2000),

    // Inicio de sesión con Google (OAuth 2.0 / OpenID Connect). Sin GOOGLE_CLIENT_ID/SECRET el botón no aparece.
    GOOGLE_CLIENT_ID: z.string().default(""),
    GOOGLE_CLIENT_SECRET: z.string().default(""),
    /** Opcional. Por defecto `${PUBLIC_SITE_URL}/api/v1/auth/google/callback` (debe estar registrada en Google Cloud). */
    GOOGLE_REDIRECT_URI: z.string().default(""),

    // Correo transaccional con Resend. Sin RESEND_API_KEY (solo fuera de producción) los correos se guardan en DEV_MAIL_DIR.
    RESEND_API_KEY: z.string().default(""),
    MAIL_FROM: z.string().default("Por aquí <onboarding@resend.dev>"),
    MAIL_REPLY_TO: z.string().default(""),
    DEV_MAIL_DIR: z.string().default(".dev-mail"),

    ROUTING_PROVIDER: z.enum(["none", "osrm", "fixture"]).default("none"),
    OSRM_BASE_URL: z.string().optional().default(""),
    GEOCODER_PROVIDER: z.enum(["none", "nominatim"]).default("none"),
    NOMINATIM_BASE_URL: z.string().default("https://nominatim.openstreetmap.org"),
    GEO_USER_AGENT: z.string().default("PorAqui/0.1"),

    ENABLE_DEMO_CONTENT: bool("false"),
    TRACK_MAX_ACCURACY_M: z.coerce.number().default(100),
    TRACK_MIN_DISTANCE_M: z.coerce.number().default(5),
  })
  .superRefine((env, ctx) => {
    if (env.APP_ENV !== "production") return;
    const fail = (message: string, p: string) => ctx.addIssue({ code: "custom", message, path: [p] });
    if (!env.COOKIE_SECURE) fail("COOKIE_SECURE debe ser true en producción", "COOKIE_SECURE");
    if (env.ROUTING_PROVIDER === "fixture") fail("El proveedor 'fixture' no puede usarse en producción", "ROUTING_PROVIDER");
    if (env.ENABLE_DEMO_CONTENT) fail("El contenido de demostración debe estar desactivado en producción", "ENABLE_DEMO_CONTENT");
    if (env.APP_ENCRYPTION_KEY === DEV_ENCRYPTION_KEY) fail("Genera una APP_ENCRYPTION_KEY propia", "APP_ENCRYPTION_KEY");
    for (const key of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "RESEND_API_KEY"] as const) {
      if (!env[key]) fail(`${key} es obligatorio en producción`, key);
    }
    if (!env.RATE_LIMIT_ENABLED) fail("El límite de peticiones no puede desactivarse en producción", "RATE_LIMIT_ENABLED");
  });

export type Env = z.infer<typeof envSchema>;
export const ENV = Symbol("ENV");

/** Carga el `.env` más cercano (desarrollo). En producción las variables vienen del entorno. */
export function loadDotenv(): void {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    const candidate = path.join(dir, ".env");
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/** Raíz del monorepo (donde está pnpm-workspace.yaml); si no se encuentra, el directorio actual. */
export function findRepoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

export function parseEnv(source: NodeJS.ProcessEnv = process.env, overrides: Record<string, string> = {}): Env {
  const result = envSchema.safeParse({ ...source, ...overrides });
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Configuración de entorno inválida:\n${lines}`);
  }
  const env = result.data;
  if (env.ALLOWED_ORIGINS.length === 0) env.ALLOWED_ORIGINS = [env.WEB_ORIGIN];
  return env;
}
