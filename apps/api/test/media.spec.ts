import { randomUUID } from "node:crypto";
import { mediaAssets } from "@por-aqui/database";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { StoragePort } from "../src/infrastructure/storage/storage";
import { MediaService } from "../src/modules/media/media.service";
import { memoryStorage } from "./fakes";
import { jpegWithExif, manualJourney, newUser, nowIso, startApp, uploadToStorage, type TestApp, type TestUser } from "./helpers";

let t: TestApp;
let tight: TestApp;
beforeAll(async () => {
  t = await startApp();
  tight = await startApp({ MEDIA_MAX_PIXELS: "40000", MEDIA_MAX_PER_VISIT: "2", MEDIA_MAX_BYTES: "200000" });
});
afterAll(async () => {
  await t.close();
  await tight.close();
});

async function visitFor(app: TestApp, u: TestUser) {
  const { journey, places } = await manualJourney(app, u, 1);
  const rec = (await u.client.post(`/journeys/${journey.id}/recording/start`)).body;
  const visit = (await u.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), placeId: places[0]!.id, visitedAt: nowIso(), timezone: "America/Lima" })).body;
  return { journey, visit };
}

async function uploadPhoto(app: TestApp, u: TestUser, visitId: string, data: Buffer, mime = "image/jpeg") {
  const auth = await u.client.post(`/visits/${visitId}/media/uploads`, { mimeType: mime, sizeBytes: data.length });
  if (auth.status !== 201) return { auth, status: 0, complete: undefined };
  const status = await uploadToStorage(auth.body, data, mime);
  const complete = await u.client.post(`/media/${auth.body.assetId}/complete`);
  return { auth, status, complete };
}

describe("Fotos", () => {
  it("sube directo al almacenamiento, el worker deja READY y elimina EXIF/GPS de los derivados", async () => {
    const u = await newUser(t);
    const { visit } = await visitFor(t, u);
    const original = await jpegWithExif();
    expect((await sharp(original).metadata()).exif).toBeTruthy(); // la fuente sí trae EXIF

    const { auth, status, complete } = await uploadPhoto(t, u, visit.id, original);
    expect(status).toBeGreaterThanOrEqual(200);
    expect(status).toBeLessThan(300);
    expect(complete!.status).toBe(200);
    expect(complete!.body.status).toBe("UPLOADED"); // confirmar no equivale a READY
    expect(complete!.body.thumbUrl).toBeNull();

    await t.outbox.runPendingInline();
    const dto = (await u.client.get(`/media/${auth.body.assetId}`)).body;
    expect(dto.status).toBe("READY");
    expect(dto.width).toBe(800);

    const thumb = await u.client.get(dto.thumbUrl.replace("/api/v1", ""));
    expect(thumb.status).toBe(200);
    const display = await t.app.get(StoragePort).getBuffer((await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, dto.id)))[0]!.displayKey!, 5_000_000);
    const meta = await sharp(display).metadata();
    expect(meta.format).toBe("webp");
    expect(meta.exif).toBeUndefined(); // sin EXIF ni GPS
    expect(display.includes(Buffer.from("Secreto del autor"))).toBe(false);

    // la visita muestra la foto
    const v = (await u.client.get(`/visits/${visit.id}`)).body;
    expect(v.media).toHaveLength(1);
    expect(v.media[0].status).toBe("READY");
  });

  it("completar es idempotente", async () => {
    const u = await newUser(t);
    const { visit } = await visitFor(t, u);
    const { auth } = await uploadPhoto(t, u, visit.id, await jpegWithExif(400, 300));
    const again = await u.client.post(`/media/${auth.body.assetId}/complete`);
    expect(again.status).toBe(200);
    await t.outbox.runPendingInline();
    expect(await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, auth.body.assetId))).toHaveLength(1);
    // procesar dos veces no duplica ni rompe
    await t.outbox.runPendingInline();
    expect((await u.client.post(`/media/${auth.body.assetId}/complete`)).body.status).toBe("READY");
  });

  it("valida los bytes reales: un archivo que no es imagen falla aunque declare image/jpeg", async () => {
    const u = await newUser(t);
    const { visit } = await visitFor(t, u);
    const html = Buffer.from("<html><script>alert(1)</script></html>");
    const { auth } = await uploadPhoto(t, u, visit.id, html, "image/jpeg");
    await t.outbox.runPendingInline();
    const dto = (await u.client.get(`/media/${auth.body.assetId}`)).body;
    expect(dto.status).toBe("FAILED");
    expect(dto.failureCode).toBe("UNSUPPORTED_FORMAT");
    expect((await u.client.post(`/media/${auth.body.assetId}/retry`)).status).toBe(400); // no es recuperable
  });

  it("rechaza tipos no admitidos al reservar (SVG, HEIC, HTML)", async () => {
    const u = await newUser(t);
    const { visit } = await visitFor(t, u);
    for (const mimeType of ["image/svg+xml", "image/heic", "text/html"]) {
      const r = await u.client.post(`/visits/${visit.id}/media/uploads`, { mimeType, sizeBytes: 1000 });
      expect(r.status, mimeType).toBe(400);
    }
  });

  it("limita tamaño (reserva y almacenamiento), píxeles y fotos por visita", async () => {
    const u = await newUser(tight);
    const { visit } = await visitFor(tight, u);

    const tooBig = await u.client.post(`/visits/${visit.id}/media/uploads`, { mimeType: "image/jpeg", sizeBytes: 300_000 });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.code).toBe("MEDIA_LIMIT");

    // Aunque el cliente mienta sobre el tamaño, el tamaño va firmado en la URL y el almacenamiento rechaza otro distinto
    const lie = await u.client.post(`/visits/${visit.id}/media/uploads`, { mimeType: "image/jpeg", sizeBytes: 1000 });
    const big = Buffer.alloc(260_000, 1);
    expect(await uploadToStorage(lie.body, big, "image/jpeg")).toBeGreaterThanOrEqual(400);
    expect((await u.client.post(`/media/${lie.body.assetId}/complete`)).status).toBe(400); // nada llegó
    expect((await u.client.delete(`/media/${lie.body.assetId}`)).status).toBe(200); // descartar la reserva

    // Límite de píxeles (40k): 400x400 = 160k
    const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#123456" } }).png().toBuffer();
    const { auth } = await uploadPhoto(tight, u, visit.id, png, "image/png");
    await tight.outbox.runPendingInline();
    const dto = (await u.client.get(`/media/${auth.body.assetId}`)).body;
    expect(dto.status).toBe("FAILED");
    expect(dto.failureCode).toBe("TOO_MANY_PIXELS");

    // Máximo por visita = 2 (las fallidas no cuentan): la 3.ª reserva válida se rechaza
    const ok = await sharp({ create: { width: 100, height: 100, channels: 3, background: "#654321" } }).jpeg().toBuffer();
    expect((await uploadPhoto(tight, u, visit.id, ok)).auth.status).toBe(201);
    expect((await uploadPhoto(tight, u, visit.id, ok)).auth.status).toBe(201);
    const third = await u.client.post(`/visits/${visit.id}/media/uploads`, { mimeType: "image/jpeg", sizeBytes: 1000 });
    expect(third.status).toBe(400);
    expect(third.body.code).toBe("MEDIA_LIMIT");
  });

  it("los archivos son privados: sin sesión o con otra cuenta no se leen; el original nunca se sirve", async () => {
    const owner = await newUser(t);
    const other = await newUser(t);
    const { visit } = await visitFor(t, owner);
    const { auth } = await uploadPhoto(t, owner, visit.id, await jpegWithExif(640, 480));
    await t.outbox.runPendingInline();
    const dto = (await owner.client.get(`/media/${auth.body.assetId}`)).body;

    const path = dto.displayUrl.replace("/api/v1", "");
    expect((await owner.client.get(path)).status).toBe(200);
    expect((await other.client.get(path)).status).toBe(404);
    expect((await t.client().get(path)).status).toBe(404);
    expect((await other.client.get(`/media/${dto.id}`)).status).toBe(404);
    expect((await other.client.post(`/media/${dto.id}/complete`)).status).toBe(404);
    expect((await other.client.delete(`/media/${dto.id}`)).status).toBe(404);

    // Los bytes solo salen por la API: no hay URL pública de R2 en ninguna respuesta
    expect(JSON.stringify(dto)).not.toMatch(/cloudflarestorage|r2\.dev|memory:\/\//);

    // Encabezados de seguridad al servir
    const served = await owner.client.get(path);
    expect(served.headers["x-content-type-options"]).toBe("nosniff");
    expect(served.headers["content-type"]).toContain("image/webp");
    expect(served.headers["cache-control"]).toContain("private");
  });

  it("guarda cada archivo en la carpeta del perfil: avatar/ o places/{lugar}/", async () => {
    const u = await newUser(t);
    const { visit } = await visitFor(t, u);
    const { auth } = await uploadPhoto(t, u, visit.id, await jpegWithExif(300, 200));
    await t.outbox.runPendingInline();
    const row = (await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, auth.body.assetId)))[0]!;
    const base = `users/${u.id}/places/${visit.placeId}/${row.id}`;
    expect(row.originalKey).toBe(`${base}/original`);
    expect(row.thumbnailKey).toBe(`${base}/v1/thumb.webp`);
    expect(row.displayKey).toBe(`${base}/v1/display.webp`);

    const avatar = await u.client.post("/me/avatar/uploads", { mimeType: "image/jpeg", sizeBytes: 1000 });
    const avatarRow = (await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, avatar.body.assetId)))[0]!;
    expect(avatarRow.originalKey).toBe(`users/${u.id}/avatar/${avatarRow.id}/original`);
  });

  it("al borrar la foto se elimina TODA su carpeta en R2 (original y derivados)", async () => {
    const u = await newUser(t);
    const { visit } = await visitFor(t, u);
    const { auth } = await uploadPhoto(t, u, visit.id, await jpegWithExif(300, 200));
    await t.outbox.runPendingInline();
    const row = (await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, auth.body.assetId)))[0]!;
    const folder = `users/${u.id}/places/${visit.placeId}/${row.id}/`;
    expect(memoryStorage.keysUnder(folder).length).toBe(3);
    // Un resto de una versión anterior también debe desaparecer
    await memoryStorage.put(`${folder}v0/display.webp`, Buffer.from("x"), "image/webp");

    expect((await u.client.delete(`/media/${row.id}`)).status).toBe(200);
    await t.outbox.runPendingInline();
    expect(memoryStorage.keysUnder(folder)).toEqual([]);
  });

  it("la red de seguridad elimina de R2 lo que ya no está en la base de datos y respeta lo reciente", async () => {
    const u = await newUser(t);
    const ghost = randomUUID();
    const key = `users/${u.id}/avatar/${ghost}/original`;
    const old = new Date(Date.now() - 3 * 3_600_000);
    await memoryStorage.put(key, Buffer.from("x"), "image/jpeg");
    memoryStorage.objects.get(key)!.lastModified = old;
    const fresh = `users/${u.id}/avatar/${randomUUID()}/original`;
    await memoryStorage.put(fresh, Buffer.from("x"), "image/jpeg");

    const removed = await t.app.get(MediaService, { strict: false }).reconcileStorage();
    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await memoryStorage.head(key)).toBeNull();
    expect(await memoryStorage.head(fresh)).not.toBeNull(); // subida en curso: no se toca
  });

  it("al borrar la cuenta se elimina la carpeta completa del perfil", async () => {
    const u = await newUser(t);
    const { visit } = await visitFor(t, u);
    await uploadPhoto(t, u, visit.id, await jpegWithExif(300, 200));
    await t.outbox.runPendingInline();
    expect(memoryStorage.keysUnder(`users/${u.id}/`).length).toBeGreaterThan(0);
    expect((await u.client.delete("/me/account", { password: u.password, confirmation: "ELIMINAR" })).status).toBe(200);
    await t.outbox.runPendingInline();
    expect(memoryStorage.keysUnder(`users/${u.id}/`)).toEqual([]);
  });

  it("al borrar la foto se eliminan fila y objetos", async () => {
    const u = await newUser(t);
    const { visit } = await visitFor(t, u);
    const { auth } = await uploadPhoto(t, u, visit.id, await jpegWithExif(300, 200));
    await t.outbox.runPendingInline();
    const row = (await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, auth.body.assetId)))[0]!;
    expect((await u.client.delete(`/media/${auth.body.assetId}`)).status).toBe(200);
    await t.outbox.runPendingInline();
    expect(await t.db.select().from(mediaAssets).where(eq(mediaAssets.id, auth.body.assetId))).toHaveLength(0);
    expect(await t.app.get(StoragePort).head(row.originalKey)).toBeNull();
    expect(await t.app.get(StoragePort).head(row.displayKey!)).toBeNull();
  });
});
