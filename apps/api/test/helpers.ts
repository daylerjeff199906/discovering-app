import { randomBytes } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { TERMS_VERSION } from "@por-aqui/contracts";
import { places, users, type Db } from "@por-aqui/database";
import { eq } from "drizzle-orm";
import request from "supertest";
import sharp from "sharp";
import { createApp } from "../src/bootstrap";
import { ENV, type Env } from "../src/config/env";
import { MailerPort } from "../src/infrastructure/mail/mailer";
import { StoragePort } from "../src/infrastructure/storage/storage";
import { memoryMailer, memoryStorage } from "./fakes";
import { DB, QUEUES, type QueueMap } from "../src/infrastructure/tokens";
import { MediaService } from "../src/modules/media/media.service";
import { OutboxHandlers } from "../src/worker/outbox.handlers";

export interface TestApp {
  app: NestExpressApplication;
  db: Db;
  env: Env;
  outbox: OutboxHandlers;
  close: () => Promise<void>;
  client: () => Client;
}

export async function startApp(overrides: Record<string, string> = {}): Promise<TestApp> {
  const app = await createApp(overrides);
  await app.init();
  const db = app.get<Db>(DB);
  const env = app.get<Env>(ENV);
  const outbox = new OutboxHandlers(db, env, app.get<QueueMap>(QUEUES), app.get(MailerPort), app.get(StoragePort), app.get(MediaService, { strict: false }));
  return { app, db, env, outbox, close: () => app.close(), client: () => new Client(app) };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface Res<T = any> {
  status: number;
  body: T;
  headers: Record<string, string>;
}

/** Cliente HTTP con cookie jar y CSRF (doble-submit), como lo usa el navegador. */
export class Client {
  private agent: ReturnType<typeof request.agent>;
  private csrf = "";
  constructor(app: NestExpressApplication) {
    this.agent = request.agent(app.getHttpServer());
  }

  async ensureCsrf() {
    if (this.csrf) return;
    const r = await this.agent.get("/api/v1/auth/csrf");
    this.csrf = r.body.csrfToken;
  }

  private wrap(r: request.Response): Res {
    // El servidor rota la cookie CSRF al abrir sesión; el cliente (como el navegador) usa siempre la última.
    const set = ([] as string[]).concat((r.headers["set-cookie"] as unknown as string[]) ?? []);
    for (const line of set) {
      const m = /^pa_csrf=([^;]+)/.exec(line);
      if (m) this.csrf = decodeURIComponent(m[1]!);
    }
    return { status: r.status, body: r.body, headers: r.headers as Record<string, string> };
  }

  async get(path: string): Promise<Res> {
    return this.wrap(await this.agent.get(`/api/v1${path}`));
  }

  /** GET sin seguir redirecciones (conserva cookies): para el flujo de Google. */
  async rawGet(path: string): Promise<Res> {
    return this.wrap(await this.agent.get(`/api/v1${path}`).redirects(0));
  }

  async send(method: "post" | "put" | "patch" | "delete", path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Res> {
    await this.ensureCsrf();
    let r = this.agent[method](`/api/v1${path}`).set("x-csrf-token", this.csrf).set("origin", "http://localhost:5173");
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return this.wrap(await (body === undefined ? r : r.send(body as object)));
  }
  /** POST multipart/form-data con un archivo en el campo `file` (importación de recorridos). */
  async upload(path: string, file?: { name: string; data: Buffer | string }, fields: Record<string, string> = {}): Promise<Res> {
    await this.ensureCsrf();
    let r = this.agent.post(`/api/v1${path}`).set("x-csrf-token", this.csrf).set("origin", "http://localhost:5173");
    for (const [k, v] of Object.entries(fields)) r = r.field(k, v);
    if (file) r = r.attach("file", Buffer.from(file.data), file.name);
    return this.wrap(await r);
  }
  post = (p: string, b?: unknown, h?: Record<string, string>) => this.send("post", p, b ?? {}, h);
  put = (p: string, b?: unknown) => this.send("put", p, b ?? {});
  patch = (p: string, b?: unknown) => this.send("patch", p, b ?? {});
  delete = (p: string, b?: unknown) => this.send("delete", p, b);

  /** Petición sin token CSRF (para comprobar el rechazo). */
  rawPost(path: string, body: unknown, headers: Record<string, string> = {}) {
    let r = this.agent.post(`/api/v1${path}`);
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return r.send(body as object);
  }

}

export const uniq = (p = "u") => `${p}${randomBytes(4).toString("hex")}`;

export interface TestUser {
  client: Client;
  email: string;
  username: string;
  password: string;
  id: string;
}

/** Registra, marca el correo como verificado (atajo por BD) e inicia sesión. */
export async function newUser(t: TestApp, opts: { verified?: boolean; role?: "USER" | "MODERATOR" } = {}): Promise<TestUser> {
  const username = uniq("u_");
  const email = `${username}@example.com`;
  const password = "claveSegura123";
  const client = t.client();
  const reg = await client.post("/auth/register", { displayName: `Persona ${username}`, username, email, password, passwordConfirm: password, acceptTerms: true, termsVersion: TERMS_VERSION });
  if (reg.status !== 201) throw new Error(`register falló: ${JSON.stringify(reg.body)}`);
  const patch: Partial<typeof users.$inferInsert> = {};
  if (opts.verified !== false) patch.emailVerifiedAt = new Date();
  if (opts.role) patch.role = opts.role;
  if (Object.keys(patch).length) await t.db.update(users).set(patch).where(eq(users.emailNormalized, email));
  const login = await client.post("/auth/login", { email, password });
  if (login.status !== 200) throw new Error(`login falló: ${JSON.stringify(login.body)}`);
  return { client, email, username, password, id: login.body.id };
}

export async function catalogPlaces(t: TestApp, locality = "Iquitos") {
  return t.db.select().from(places).where(eq(places.locality, locality));
}

/** Crea un viaje manual con dos paradas del catálogo. */
export async function manualJourney(t: TestApp, u: TestUser, stopsCount = 3) {
  const cat = (await catalogPlaces(t)).slice(0, stopsCount);
  let j = (await u.client.post("/journeys", { title: "Mi viaje", creationMode: "MANUAL", daysCount: 1 })).body;
  for (const p of cat) {
    const r = await u.client.post(`/journeys/${j.id}/stops`, { dayId: j.days[0].id, placeId: p.id, expectedVersion: j.version });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    j = r.body;
  }
  return { journey: j, places: cat };
}

export const nowIso = () => new Date().toISOString();

/** Imagen JPEG de prueba con EXIF (incluye GPS) para comprobar que se elimina. */
export async function jpegWithExif(width = 800, height = 600): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 120, b: 80 } } })
    .jpeg()
    .withExif({ IFD0: { Copyright: "Secreto del autor", ImageDescription: "con-gps" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "3/1 44/1 56/1", GPSLongitudeRef: "W", GPSLongitude: "73/1 15/1 13/1" } })
    .toBuffer();
}

/** Sube un archivo con la URL PUT prefirmada, como haría el navegador (contra el almacenamiento en memoria). */
export async function uploadToStorage(auth: { url: string; headers: Record<string, string> }, data: Buffer, mime: string): Promise<number> {
  return memoryStorage.receive(auth.url, { ...auth.headers, "Content-Type": mime }, data);
}

export async function mailTo(email: string): Promise<{ text: string; subject: string } | null> {
  const m = memoryMailer.lastTo(email);
  return m ? { text: m.text, subject: m.subject } : null;
}
