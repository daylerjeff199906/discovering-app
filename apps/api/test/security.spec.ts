import { randomBytes } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env";
import { newUser, startApp, uniq, type TestApp } from "./helpers";

let strict: TestApp;
let t: TestApp;
beforeAll(async () => {
  t = await startApp();
  // Instancia con límite de peticiones REAL (Redis) y confianza en X-Forwarded-For para aislar IPs entre ejecuciones
  strict = await startApp({ RATE_LIMIT_ENABLED: "true", TRUST_PROXY: "true" });
});
afterAll(async () => {
  await t.close();
  await strict.close();
});

const fakeIp = () => Array.from(randomBytes(4)).join(".");

describe("Límite de peticiones", () => {
  it("bloquea intentos de login repetidos con 429 y Retry-After (por correo e IP)", async () => {
    const ip = fakeIp();
    const email = `${uniq("rl_")}@example.com`;
    const c = strict.client();
    const statuses: number[] = [];
    let last: { headers: Record<string, string>; body: { code: string } } | null = null;
    for (let i = 0; i < 14; i++) {
      const r = await c.send("post", "/auth/login", { email, password: "incorrecta1234" }, { "x-forwarded-for": ip });
      statuses.push(r.status);
      last = r;
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses.includes(429)).toBe(true);
    expect(last!.body.code).toBe("RATE_LIMITED");
    expect(Number(last!.headers["retry-after"])).toBeGreaterThan(0);
  });

  it("limita el reenvío del correo de verificación con un cooldown", async () => {
    const ip = fakeIp();
    const email = `${uniq("cd_")}@example.com`;
    const c = strict.client();
    const first = await c.send("post", "/auth/resend-verification", { email }, { "x-forwarded-for": ip });
    const second = await c.send("post", "/auth/resend-verification", { email }, { "x-forwarded-for": ip });
    expect(first.status).toBe(200);
    expect(second.status).toBe(429);
  });
});

describe("Cabeceras, CORS y errores", () => {
  it("no expone tecnología ni stacktraces, y responde siempre private/no-store con requestId", async () => {
    const c = t.client();
    const ok = await c.get("/meta/capabilities");
    expect(ok.headers["x-powered-by"]).toBeUndefined();
    expect(ok.headers["x-content-type-options"]).toBe("nosniff");
    expect(ok.headers["cache-control"]).toBe("private, no-store");
    expect(ok.headers["x-request-id"]).toBeTruthy();

    const notFound = await c.get("/ruta/que/no/existe");
    expect(notFound.status).toBe(404);
    expect(notFound.body).toMatchObject({ code: "NOT_FOUND" });
    expect(JSON.stringify(notFound.body)).not.toMatch(/stack|node_modules|at \w+/);

    const badJson = await request(t.app.getHttpServer()).post("/api/v1/auth/login").set("content-type", "application/json").send("{no es json");
    expect(badJson.status).toBeLessThan(500);
    expect(JSON.stringify(badJson.body)).not.toContain("SyntaxError");

    const u = await newUser(t);
    const unknownUuid = await u.client.get("/journeys/00000000-0000-4000-8000-000000000000");
    expect(unknownUuid.status).toBe(404);
    const notUuid = await u.client.get("/journeys/no-es-uuid");
    expect(notUuid.status).toBe(400);
  });

  it("CORS: solo orígenes configurados, con credenciales", async () => {
    const server = t.app.getHttpServer();
    const allowed = await request(server).options("/api/v1/auth/me").set("Origin", "http://localhost:5173").set("Access-Control-Request-Method", "GET");
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(allowed.headers["access-control-allow-credentials"]).toBe("true");
    const evil = await request(server).options("/api/v1/auth/me").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "GET");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("sirve el OpenAPI generado desde los esquemas Zod", async () => {
    const res = await request(t.app.getHttpServer()).get("/api/v1/openapi.json");
    expect(res.status).toBe(200);
    const doc = res.body as { paths: Record<string, Record<string, { requestBody?: { content: Record<string, { schema: { properties?: Record<string, unknown> } }> } }>> };
    expect(Object.keys(doc.paths).length).toBeGreaterThan(60);
    const register = doc.paths["/api/v1/auth/register"]?.post?.requestBody?.content["application/json"]?.schema;
    expect(Object.keys(register?.properties ?? {})).toEqual(expect.arrayContaining(["email", "password", "acceptTerms"]));
  });
});

describe("Validación del entorno", () => {
  const base = { DATABASE_URL: "postgres://x", REDIS_URL: "redis://x", WEB_ORIGIN: "http://localhost:5173", PUBLIC_SITE_URL: "http://localhost:5173", APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"), };
  const cloud = { R2_ACCOUNT_ID: "acc", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b", RESEND_API_KEY: "re_test" };

  it("acepta una configuración de desarrollo válida", () => {
    expect(parseEnv({}, base).API_PORT).toBe(4000);
  });

  it("en producción exige cookies Secure, límite de peticiones, clave propia y sin demo/fixture", () => {
    expect(() => parseEnv({}, { ...base, APP_ENV: "production" })).toThrow(/COOKIE_SECURE/);
    expect(() => parseEnv({}, { ...base, APP_ENV: "production", COOKIE_SECURE: "true", ROUTING_PROVIDER: "fixture" })).toThrow(/fixture/);
    expect(() => parseEnv({}, { ...base, APP_ENV: "production", COOKIE_SECURE: "true", ENABLE_DEMO_CONTENT: "true" })).toThrow(/demostración/);
    expect(() => parseEnv({}, { ...base, APP_ENV: "production", COOKIE_SECURE: "true", RATE_LIMIT_ENABLED: "false" })).toThrow(/límite de peticiones/);
    expect(() => parseEnv({}, { ...base, APP_ENV: "production", COOKIE_SECURE: "true", APP_ENCRYPTION_KEY: "ZGV2LW9ubHktMzItYnl0ZS1rZXktZm9yLXBvcmFxdWk=" })).toThrow(/APP_ENCRYPTION_KEY/);
    expect(parseEnv({}, { ...base, ...cloud, APP_ENV: "production", COOKIE_SECURE: "true" }).COOKIE_SECURE).toBe(true);
  });

  it("en producción exige las claves de Cloudflare R2 y de Resend; en desarrollo son opcionales", () => {
    expect(() => parseEnv({}, { ...base, APP_ENV: "production", COOKIE_SECURE: "true" })).toThrow(/R2_BUCKET/);
    expect(() => parseEnv({}, { ...base, ...cloud, RESEND_API_KEY: "", APP_ENV: "production", COOKIE_SECURE: "true" })).toThrow(/RESEND_API_KEY/);
    expect(parseEnv({}, base).R2_BUCKET).toBe("");
  });

  it("falla con un mensaje claro si falta una variable obligatoria", () => {
    expect(() => parseEnv({}, { WEB_ORIGIN: "http://x" })).toThrow(/Configuración de entorno inválida/);
  });
});
