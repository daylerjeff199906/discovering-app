import { oauthIdentities, users } from "@por-aqui/database";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fakeGoogle } from "./fakes";
import { jpegWithExif, newUser, startApp, uniq, type TestApp } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.close();
});

/** Recorre start → (Google) → callback con un navegador de mentira y devuelve el redirect final. */
async function viaGoogle(client: ReturnType<TestApp["client"]>, profile: { email: string; name?: string; verified?: boolean; sub?: string }, query = "mode=register&terms=1") {
  const start = await client.rawGet(`/auth/google/start?${query}`);
  expect(start.status).toBe(302);
  const state = new URL(start.headers.location!).searchParams.get("state")!;
  const code = uniq("code_");
  fakeGoogle.profiles.set(code, { sub: profile.sub ?? uniq("sub_"), email: profile.email, emailVerified: profile.verified ?? true, name: profile.name ?? "Ana Viajera", picture: "https://lh3.googleusercontent.com/a/x=s96-c" });
  const cb = await client.rawGet(`/auth/google/callback?code=${code}&state=${state}`);
  expect(cb.status).toBe(302);
  return { location: new URL(cb.headers.location!), state, code };
}

describe("Acceso con Google", () => {
  it("anuncia la capacidad solo cuando está configurado", async () => {
    const caps = (await t.client().get("/meta/capabilities")).body;
    expect(caps.auth.google).toBe(false); // sin GOOGLE_CLIENT_ID/SECRET en el entorno de pruebas
  });

  it("crea la cuenta con el correo verificado, abre sesión e importa la foto de perfil", async () => {
    fakeGoogle.avatar = { data: await jpegWithExif(300, 300), mime: "image/jpeg" };
    const email = `${uniq("g_")}@example.com`;
    const c = t.client();
    const { location } = await viaGoogle(c, { email, name: "Ana Viajera" });
    expect(location.pathname).toBe("/bienvenida"); // cuenta nueva → onboarding
    await t.outbox.runPendingInline();

    const me = await c.get("/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.email).toBe(email);
    expect(me.body.emailVerified).toBe(true);
    expect(me.body.profile.displayName).toBe("Ana Viajera");
    expect(me.body.profile.avatarUrl).toMatch(/\/api\/v1\/media\//);
    const [u] = await t.db.select().from(users).where(eq(users.emailNormalized, email));
    expect(await t.db.select().from(oauthIdentities).where(eq(oauthIdentities.userId, u!.id))).toHaveLength(1);
    // La contraseña es inutilizable: solo entra con Google (o recuperando la contraseña).
    const pw = await t.client().post("/auth/login", { email, password: "claveSegura123" });
    expect(pw.status).toBe(401);
  });

  it("no crea cuentas sin aceptar los términos (se pide hacerlo desde «Crear cuenta»)", async () => {
    const email = `${uniq("g_")}@example.com`;
    const { location } = await viaGoogle(t.client(), { email }, "mode=login");
    expect(location.pathname).toBe("/registro");
    expect(location.searchParams.get("error")).toBe("google_sin_cuenta");
    expect(await t.db.select().from(users).where(eq(users.emailNormalized, email))).toHaveLength(0);
  });

  it("vincula una cuenta existente con el mismo correo verificado sin tocar su contraseña", async () => {
    const u = await newUser(t);
    const c = t.client();
    const { location } = await viaGoogle(c, { email: u.email }, "mode=login");
    expect(location.pathname).not.toBe("/registro");
    expect((await c.get("/auth/me")).body.id).toBe(u.id);
    expect((await t.client().post("/auth/login", { email: u.email, password: u.password })).status).toBe(200);
  });

  it("anti pre-secuestro: si el correo estaba registrado SIN verificar, esa contraseña deja de servir", async () => {
    const squatter = await newUser(t, { verified: false });
    const { location } = await viaGoogle(t.client(), { email: squatter.email }, "mode=login");
    expect(location.pathname).not.toBe("/registro");
    expect((await t.client().post("/auth/login", { email: squatter.email, password: squatter.password })).status).toBe(401);
    const [row] = await t.db.select().from(users).where(eq(users.emailNormalized, squatter.email));
    expect(row!.emailVerifiedAt).not.toBeNull();
  });

  it("rechaza estado manipulado, correo sin verificar y cuentas desactivadas", async () => {
    const c = t.client();
    const start = await c.rawGet("/auth/google/start?mode=login");
    expect(start.status).toBe(302);
    const bad = await c.rawGet("/auth/google/callback?code=x&state=otro");
    expect(new URL(bad.headers.location!).searchParams.get("error")).toBe("google_estado");

    const unverified = await viaGoogle(t.client(), { email: `${uniq("g_")}@example.com`, verified: false });
    expect(unverified.location.searchParams.get("error")).toBe("google_correo_no_verificado");

    const disabled = await newUser(t);
    await t.db.update(users).set({ accountStatus: "DISABLED" }).where(eq(users.id, disabled.id));
    const r = await viaGoogle(t.client(), { email: disabled.email }, "mode=login");
    expect(r.location.searchParams.get("error")).toBe("google_cuenta_inactiva");
  });

  it("el mismo usuario de Google vuelve a entrar a la misma cuenta aunque cambie su correo", async () => {
    const sub = uniq("sub_");
    const first = await viaGoogle(t.client(), { email: `${uniq("g_")}@example.com`, sub });
    expect(first.location.pathname).toBe("/bienvenida");
    const again = t.client();
    await viaGoogle(again, { email: `${uniq("otro_")}@example.com`, sub }, "mode=login");
    const me = (await again.get("/auth/me")).body;
    expect(me.id).toBeTruthy();
    const [id] = await t.db.select().from(oauthIdentities).where(eq(oauthIdentities.subject, sub));
    expect(me.id).toBe(id!.userId);
  });
});
