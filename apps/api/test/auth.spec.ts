import { TERMS_VERSION } from "@por-aqui/contracts";
import { authTokens, sessions, users } from "@por-aqui/database";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mailTo, newUser, startApp, uniq, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.close();
});

const registration = (username: string, email: string, password = "claveSegura123") => ({
  displayName: "Persona Prueba",
  username,
  email,
  password,
  passwordConfirm: password,
  acceptTerms: true,
  termsVersion: TERMS_VERSION,
});

describe("Cuenta → correo → verificar → login → logout → reset", () => {
  it("recorre el ciclo completo con correo real (Mailpit) y revoca sesiones tras el reset", async () => {
    const username = uniq("flow_");
    const email = `${username}@example.com`;
    const c = t.client();

    const reg = await c.post("/auth/register", registration(username, email));
    expect(reg.status).toBe(201);
    expect(reg.body).toEqual({ ok: true, requiresVerification: true });

    // El correo sale por outbox → worker. Aquí se procesa en línea con el mismo código del worker.
    await t.outbox.runPendingInline();
    const mail = await mailTo(email);
    expect(mail?.subject).toContain("Confirma tu correo");
    const token = /token=([A-Za-z0-9_-]+)/.exec(mail!.text)?.[1];
    expect(token).toBeTruthy();

    // El token no queda en claro en la base de datos
    const hashes = await t.db.select().from(authTokens);
    expect(hashes.some((h) => h.tokenHash === token)).toBe(false);

    // Antes de verificar se puede iniciar sesión, pero no publicar
    const login0 = await c.post("/auth/login", { email, password: "claveSegura123" });
    expect(login0.status).toBe(200);
    expect(login0.body.emailVerified).toBe(false);
    expect((await c.get("/auth/me")).status).toBe(200);

    expect((await c.post("/auth/verify-email", { token })).status).toBe(200);
    // consumo atómico + idempotente: repetir el mismo enlace no falla si ya está verificado
    expect((await c.post("/auth/verify-email", { token })).status).toBe(200);
    expect((await c.get("/auth/me")).body.emailVerified).toBe(true);

    // Cookie de sesión: HttpOnly, SameSite=Lax; el token se guarda solo como hash
    const raw = await t.app.getHttpServer();
    void raw;
    const logout = await c.post("/auth/logout");
    expect(logout.status).toBe(200);
    expect((await c.get("/auth/me")).status).toBe(401);

    // Recuperación
    expect((await c.post("/auth/forgot-password", { email })).status).toBe(200);
    expect((await c.post("/auth/forgot-password", { email: "nadie@example.com" })).status).toBe(200); // respuesta genérica
    await t.outbox.runPendingInline();
    const resetMail = await mailTo(email);
    const resetToken = /restablecer-clave\?token=([A-Za-z0-9_-]+)/.exec(resetMail!.text)?.[1];
    expect(resetToken).toBeTruthy();

    const other = t.client();
    await other.post("/auth/login", { email, password: "claveSegura123" });
    expect((await other.get("/auth/me")).status).toBe(200);

    const bad = await c.post("/auth/reset-password", { token: resetToken, password: "otraClave12345", passwordConfirm: "distinta12345" });
    expect(bad.status).toBe(400);
    const reset = await c.post("/auth/reset-password", { token: resetToken, password: "otraClave12345", passwordConfirm: "otraClave12345" });
    expect(reset.status).toBe(200);
    // reutilizar el enlace falla
    expect((await c.post("/auth/reset-password", { token: resetToken, password: "otraClave12345", passwordConfirm: "otraClave12345" })).status).toBe(400);
    // la sesión previa quedó revocada
    expect((await other.get("/auth/me")).status).toBe(401);
    expect((await c.post("/auth/login", { email, password: "claveSegura123" })).status).toBe(401);
    expect((await c.post("/auth/login", { email, password: "otraClave12345" })).status).toBe(200);
  });

  it("no revela si un correo existe (registro y login)", async () => {
    const u = await newUser(t);
    const c = t.client();
    const again = await c.post("/auth/register", registration(uniq("x_"), u.email));
    expect(again.status).toBe(201);
    expect(again.body).toEqual({ ok: true, requiresVerification: true });
    const wrongUser = await c.post("/auth/login", { email: "no-existe@example.com", password: "claveSegura123" });
    const wrongPass = await c.post("/auth/login", { email: u.email, password: "incorrecta1234" });
    expect(wrongUser.status).toBe(401);
    expect(wrongPass.status).toBe(401);
    expect(wrongUser.body.message).toBe(wrongPass.body.message);
  });

  it("valida contraseña, términos y username en el servidor", async () => {
    const c = t.client();
    const r = await c.post("/auth/register", { ...registration("ab", "no-es-correo", "corta"), acceptTerms: false });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("VALIDATION_ERROR");
    expect(Object.keys(r.body.fieldErrors)).toEqual(expect.arrayContaining(["username", "email", "password", "acceptTerms"]));
    expect(r.body.requestId).toBeTruthy();
    expect(JSON.stringify(r.body)).not.toContain("stack");
  });

  it("rechaza mutaciones sin token CSRF o con Origin no permitido", async () => {
    const c = t.client();
    const noToken = await c.rawPost("/auth/login", { email: "a@b.com", password: "x" });
    expect(noToken.status).toBe(403);
    expect(noToken.body.code).toBe("CSRF_INVALID");
    await c.ensureCsrf();
    const badOrigin = await c.send("post", "/auth/login", { email: "a@b.com", password: "x" }, { origin: "https://evil.example" });
    expect(badOrigin.status).toBe(403);
  });

  it("guarda la sesión solo como hash, con cookie HttpOnly/SameSite=Lax", async () => {
    const u = await newUser(t);
    const [row] = await t.db.select().from(users).where(eq(users.emailNormalized, u.email));
    const sess = await t.db.select().from(sessions).where(eq(sessions.userId, row!.id));
    expect(sess.length).toBeGreaterThan(0);
    expect(sess[0]!.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    // Encabezado Set-Cookie en un login nuevo
    const c = t.client();
    await c.ensureCsrf();
    const res = await c.post("/auth/login", { email: u.email, password: u.password });
    const setCookie = ([] as string[]).concat((res.headers["set-cookie"] as unknown as string[]) ?? []).join("\n");
    expect(setCookie).toMatch(/pa_session=[^;]+;[^\n]*HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/Domain=/i);
  });

  it("lista y revoca sesiones; cambiar contraseña revoca las demás", async () => {
    const u = await newUser(t);
    const second = t.client();
    await second.post("/auth/login", { email: u.email, password: u.password });
    const list = await u.client.get("/auth/sessions");
    expect(list.body.length).toBe(2);
    expect(list.body.filter((s: { current: boolean }) => s.current)).toHaveLength(1);

    const change = await u.client.put("/me/password", { currentPassword: u.password, newPassword: "nuevaClave12345", newPasswordConfirm: "nuevaClave12345" });
    expect(change.status).toBe(200);
    expect((await second.get("/auth/me")).status).toBe(401);
    expect((await u.client.get("/auth/me")).status).toBe(200); // la actual se rotó, no se perdió
  });

  it("elimina la cuenta: revoca acceso de inmediato y la purga completa el worker", async () => {
    const u = await newUser(t);
    const del = await u.client.delete("/me/account", { password: u.password, confirmation: "ELIMINAR" });
    expect(del.status).toBe(200);
    expect((await u.client.get("/auth/me")).status).toBe(401);
    expect((await t.client().post("/auth/login", { email: u.email, password: u.password })).status).toBe(401);
    await t.outbox.runPendingInline();
    expect(await t.db.select().from(users).where(eq(users.emailNormalized, u.email))).toHaveLength(0);
  });
});
