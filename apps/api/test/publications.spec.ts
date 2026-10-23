import { randomUUID } from "node:crypto";
import { journeys, publicationVersions, publications, visits } from "@por-aqui/database";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { jpegWithExif, manualJourney, newUser, nowIso, startApp, uploadToStorage, type TestApp, type TestUser } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.close();
});

/** Viaje finalizado con 2 visitas (la 1.ª con nota privada y foto). */
async function completedJourney(u: TestUser, opts: { withPhoto?: boolean } = {}) {
  const { journey, places } = await manualJourney(t, u, 3);
  const rec = (await u.client.post(`/journeys/${journey.id}/recording/start`)).body;
  const mk = async (i: number, note: string | null) =>
    (await u.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), placeId: places[i]!.id, visitedAt: new Date(Date.now() - (10 - i) * 3600_000).toISOString(), timezone: "America/Lima", note })).body;
  const v1 = await mk(0, "NOTA-PRIVADA-secreta");
  const v2 = await mk(1, null);
  let asset: { id: string; displayUrl: string } | null = null;
  if (opts.withPhoto) {
    const jpg = await jpegWithExif(640, 480);
    const auth = (await u.client.post(`/visits/${v1.id}/media/uploads`, { mimeType: "image/jpeg", sizeBytes: jpg.length })).body;
    await uploadToStorage(auth, jpg, "image/jpeg");
    await u.client.post(`/media/${auth.assetId}/complete`);
    await t.outbox.runPendingInline();
    asset = (await u.client.get(`/media/${auth.assetId}`)).body;
  }
  await u.client.post(`/journeys/${journey.id}/recording/finish`, { watermarks: {} });
  return { journey, rec, v1, v2, places, asset };
}

const publishBody = (c: Awaited<ReturnType<typeof completedJourney>>, over: Record<string, unknown> = {}) => ({
  title: "Mi día en Iquitos",
  description: "Un paseo tranquilo",
  visibility: "PUBLIC",
  coverAssetId: c.asset?.id ?? null,
  shareExactTrack: false,
  entries: [
    { visitId: c.v1.id, includeNote: false, locationPrecision: "EXACT", media: c.asset ? [{ assetId: c.asset.id, caption: "Foto", altText: "Plaza" }] : [] },
    { visitId: c.v2.id, includeNote: false, locationPrecision: "APPROXIMATE", media: [] },
  ],
  ...over,
});

describe("Publicar", () => {
  it("exige cuenta verificada y recorrido finalizado", async () => {
    const unverified = await newUser(t, { verified: false });
    const c = await completedJourney(unverified);
    const r = await unverified.client.put(`/journeys/${c.journey.id}/publication`, publishBody(c));
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("EMAIL_NOT_VERIFIED");
    expect((await unverified.client.get(`/journeys/${c.journey.id}/publication`)).body.blockedReason).toContain("Verifica tu correo");

    const u = await newUser(t);
    const { journey, places } = await manualJourney(t, u, 1);
    const rec = (await u.client.post(`/journeys/${journey.id}/recording/start`)).body;
    const v = (await u.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), placeId: places[0]!.id, visitedAt: nowIso(), timezone: "UTC" })).body;
    const early = await u.client.put(`/journeys/${journey.id}/publication`, { title: "x", visibility: "PUBLIC", entries: [{ visitId: v.id }] });
    expect(early.status).toBe(400);
    expect(early.body.code).toBe("NOT_COMPLETED");
  });

  it("entrega solo lo seleccionado: sin notas privadas, sin IDs privados, sin trayecto exacto por omisión", async () => {
    const u = await newUser(t);
    const c = await completedJourney(u, { withPhoto: true });
    const res = await u.client.put(`/journeys/${c.journey.id}/publication`, publishBody(c));
    expect(res.status).toBe(200);
    expect(res.body.visibility).toBe("PUBLIC");

    const anon = t.client();
    const pub = await anon.get(`/public/routes/${res.body.slug}`);
    expect(pub.status).toBe(200);
    const json = JSON.stringify(pub.body);
    expect(json).not.toContain("NOTA-PRIVADA-secreta");
    expect(json).not.toContain(c.journey.id);
    expect(json).not.toContain(c.v1.id);
    expect(json).not.toContain(c.rec.id);
    expect(json).not.toContain(u.email);
    expect(json).not.toContain(u.id);
    expect(pub.body.track).toBeNull();
    expect(pub.body.entries).toHaveLength(2);
    expect(pub.body.entries[0].media).toHaveLength(1);
    expect(pub.body.author.username).toBe(u.username);
    // precisión: la 2.ª entrada es aproximada (2 decimales)
    const loc = pub.body.entries[1].location;
    expect(Math.abs(loc.lng * 100 - Math.round(loc.lng * 100))).toBeLessThan(1e-6);

    // la foto pública se sirve sin sesión (publicación PUBLIC + VISIBLE); el original sigue sin servirse
    const img = await anon.get(pub.body.entries[0].media[0].url.replace("/api/v1", ""));
    expect(img.status).toBe(200);
    expect(img.headers["cache-control"]).toContain("public");

    const explore = (await anon.get("/public/explore?limit=50")).body;
    expect(explore.items.some((i: { slug: string }) => i.slug === res.body.slug)).toBe(true);
    expect(JSON.stringify(explore)).not.toContain("NOTA-PRIVADA-secreta");
  });

  it("incluye una nota solo si el autor la elige", async () => {
    const u = await newUser(t);
    const c = await completedJourney(u);
    const body = publishBody(c);
    (body.entries[0] as { includeNote: boolean }).includeNote = true;
    const res = await u.client.put(`/journeys/${c.journey.id}/publication`, body);
    const pub = (await t.client().get(`/public/routes/${res.body.slug}`)).body;
    expect(pub.entries[0].note).toBe("NOTA-PRIVADA-secreta");
    expect(pub.entries[1].note).toBeNull();
  });

  it("gasto y transporte nunca se publican; la recomendación solo si el autor la elige", async () => {
    const u = await newUser(t);
    const c = await completedJourney(u);
    const patched = await u.client.patch(`/visits/${c.v1.id}`, { expenseMinor: 98765, expenseCurrency: "USD", transportMode: "TRANSIT", recommendation: "CONSEJO-del-autor", expectedVersion: c.v1.version });
    expect(patched.status, JSON.stringify(patched.body)).toBe(200);
    const draft = (await u.client.get(`/journeys/${c.journey.id}/publication`)).body;
    expect(draft.candidates.find((x: { visitId: string }) => x.visitId === c.v1.id).recommendation).toBe("CONSEJO-del-autor");

    const off = await u.client.put(`/journeys/${c.journey.id}/publication`, publishBody(c));
    expect(off.status).toBe(200);
    let raw = JSON.stringify((await t.client().get(`/public/routes/${off.body.slug}`)).body);
    expect(raw).not.toContain("CONSEJO-del-autor");

    const body = publishBody(c);
    (body.entries[0] as { includeRecommendation?: boolean }).includeRecommendation = true;
    const on = await u.client.put(`/journeys/${c.journey.id}/publication`, { ...body, expectedRevision: off.body.revision });
    expect(on.status).toBe(200);
    const pub = (await t.client().get(`/public/routes/${on.body.slug}`)).body;
    expect(pub.entries[0].recommendation).toBe("CONSEJO-del-autor");
    expect(pub.entries[1].recommendation).toBeNull();
    raw = JSON.stringify(pub);
    expect(raw).not.toContain("98765");
    expect(raw).not.toContain("expense");
    expect(raw).not.toContain("TRANSIT");
  });

  it("editar el diario no altera la instantánea publicada hasta «Actualizar publicación»", async () => {
    const u = await newUser(t);
    const c = await completedJourney(u);
    const res = (await u.client.put(`/journeys/${c.journey.id}/publication`, publishBody(c))).body;
    const read = async () => (await t.client().get(`/public/routes/${res.slug}`)).body;
    const before = await read();

    await u.client.patch(`/visits/${c.v1.id}`, { note: "editado después", expectedVersion: c.v1.version });
    await u.client.patch(`/journeys/${c.journey.id}`, { title: "Título privado nuevo", expectedVersion: c.journey.version });
    expect(await read()).toEqual(before);

    // Actualizar con revisión desfasada → 409
    const stale = await u.client.put(`/journeys/${c.journey.id}/publication`, publishBody(c, { title: "Nuevo título", expectedRevision: 0 }));
    expect(stale.status).toBe(409);
    const upd = await u.client.put(`/journeys/${c.journey.id}/publication`, publishBody(c, { title: "Nuevo título", expectedRevision: res.revision }));
    expect(upd.status).toBe(200);
    expect(upd.body.revision).toBe(res.revision + 1);
    expect(upd.body.slug).toBe(res.slug); // slug estable
    expect((await read()).title).toBe("Nuevo título");
    // solo queda la versión activa
    const versions = await t.db.select().from(publicationVersions).where(eq(publicationVersions.publicationId, res.id));
    expect(versions).toHaveLength(1);
  });

  it("rechaza visitas/fotos ajenas o repetidas en la selección", async () => {
    const a = await newUser(t);
    const b = await newUser(t);
    const ca = await completedJourney(a, { withPhoto: true });
    const cb = await completedJourney(b);
    const foreignVisit = await b.client.put(`/journeys/${cb.journey.id}/publication`, publishBody(cb, { entries: [{ visitId: ca.v1.id, includeNote: false, locationPrecision: "EXACT", media: [] }] }));
    expect(foreignVisit.status).toBe(400);
    const foreignPhoto = await b.client.put(`/journeys/${cb.journey.id}/publication`, publishBody(cb, { entries: [{ visitId: cb.v1.id, includeNote: false, locationPrecision: "EXACT", media: [{ assetId: ca.asset!.id }] }] }));
    expect(foreignPhoto.status).toBe(400);
    const dup = await b.client.put(`/journeys/${cb.journey.id}/publication`, publishBody(cb, { entries: [{ visitId: cb.v1.id, includeNote: false, locationPrecision: "EXACT", media: [] }, { visitId: cb.v1.id, includeNote: false, locationPrecision: "EXACT", media: [] }] }));
    expect(dup.status).toBe(400);
  });

  it("política de borrado: una foto publicada no se elimina hasta actualizar o retirar la publicación", async () => {
    const u = await newUser(t);
    const c = await completedJourney(u, { withPhoto: true });
    await u.client.put(`/journeys/${c.journey.id}/publication`, publishBody(c));
    const blocked = await u.client.delete(`/media/${c.asset!.id}`);
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("MEDIA_IN_PUBLICATION");
    expect((await u.client.delete(`/visits/${c.v1.id}`)).status).toBe(409);

    const noPhoto = publishBody(c, { coverAssetId: null, entries: [{ visitId: c.v1.id, includeNote: false, locationPrecision: "EXACT", media: [] }, { visitId: c.v2.id, includeNote: false, locationPrecision: "EXACT", media: [] }] });
    expect((await u.client.put(`/journeys/${c.journey.id}/publication`, noPhoto)).status).toBe(200);
    expect((await u.client.delete(`/media/${c.asset!.id}`)).status).toBe(200);
  });
});

describe("Visibilidad, enlaces y moderación", () => {
  it("retirar (PRIVATE) corta el acceso al texto y a las fotos y revoca enlaces", async () => {
    const u = await newUser(t);
    const c = await completedJourney(u, { withPhoto: true });
    const pub = (await u.client.put(`/journeys/${c.journey.id}/publication`, publishBody(c))).body;
    const link = (await u.client.post(`/publications/${pub.id}/share-links`, {})).body;
    const anon = t.client();
    const route = (await anon.get(`/public/routes/${pub.slug}`)).body;
    const photo = route.entries[0].media[0].url.replace("/api/v1", "");
    expect((await anon.get(photo)).status).toBe(200);
    expect((await anon.get(`/shared/${link.token}`)).status).toBe(200);

    const off = await u.client.put(`/publications/${pub.id}/visibility`, { visibility: "PRIVATE" });
    expect(off.status).toBe(200);
    for (const path of [`/public/routes/${pub.slug}`, `/shared/${link.token}`, photo]) {
      const r = await anon.get(path);
      expect(r.status, path).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain("Mi día en Iquitos"); // sin revelar el contenido anterior
    }
    expect((await anon.get("/public/explore?limit=50")).body.items.some((i: { slug: string }) => i.slug === pub.slug)).toBe(false);
    // el dueño sigue viendo su foto
    expect((await u.client.get(photo)).status).toBe(200);
  });

  it("UNLISTED: solo con token, fuera del feed; las fotos usan tickets de vida corta; revocable", async () => {
    const u = await newUser(t);
    const c = await completedJourney(u, { withPhoto: true });
    const pub = (await u.client.put(`/journeys/${c.journey.id}/publication`, publishBody(c, { visibility: "UNLISTED" }))).body;
    const anon = t.client();
    expect((await anon.get(`/public/routes/${pub.slug}`)).status).toBe(404); // el slug sin token no da acceso
    const explore = JSON.stringify((await anon.get("/public/explore?limit=50")).body);
    expect(explore).not.toContain(pub.slug);

    const noLink = await u.client.get(`/publications/${pub.id}/share-links`);
    expect(noLink.body).toHaveLength(0);
    const link = (await u.client.post(`/publications/${pub.id}/share-links`, { expiresInDays: 7 })).body;
    expect(link.url).toContain(`/s/${link.token}`);
    // el token no se guarda en claro
    const list = (await u.client.get(`/publications/${pub.id}/share-links`)).body;
    expect(JSON.stringify(list)).not.toContain(link.token);

    const shared = await anon.get(`/shared/${link.token}`);
    expect(shared.status).toBe(200);
    expect(shared.body.visibility).toBe("UNLISTED");
    expect(JSON.stringify(shared.body)).not.toContain(link.token); // el DTO no repite el token
    const imgUrl = shared.body.entries[0].media[0].url as string;
    expect(imgUrl).toContain("&t=");
    expect((await anon.get(imgUrl.replace("/api/v1", ""))).status).toBe(200);
    expect((await anon.get(imgUrl.replace("/api/v1", "").replace(/&t=[^&]+/, ""))).status).toBe(404); // sin ticket, no
    expect((await anon.get(imgUrl.replace("/api/v1", "").replace(/&t=\d+\./, "&t=1."))).status).toBe(404); // ticket vencido/alterado

    expect((await anon.get("/shared/token-inexistente-123456")).status).toBe(404);
    expect((await u.client.delete(`/publications/${pub.id}/share-links/${link.id}`)).status).toBe(200);
    expect((await anon.get(`/shared/${link.token}`)).status).toBe(404);
  });

  it("solo el dueño gestiona la publicación", async () => {
    const a = await newUser(t);
    const b = await newUser(t);
    const c = await completedJourney(a);
    const pub = (await a.client.put(`/journeys/${c.journey.id}/publication`, publishBody(c))).body;
    expect((await b.client.put(`/publications/${pub.id}/visibility`, { visibility: "PRIVATE" })).status).toBe(404);
    expect((await b.client.post(`/publications/${pub.id}/share-links`, {})).status).toBe(404);
    expect((await b.client.delete(`/journeys/${c.journey.id}/publication`)).status).toBe(404);
    expect((await t.client().get(`/public/routes/${pub.slug}`)).status).toBe(200);
  });

  it("reporte → moderador oculta con motivo (auditado) → todo acceso se corta → restituir", async () => {
    const author = await newUser(t);
    const reporter = await newUser(t);
    const mod = await newUser(t, { role: "MODERATOR" });
    const c = await completedJourney(author, { withPhoto: true });
    const pub = (await author.client.put(`/journeys/${c.journey.id}/publication`, publishBody(c))).body;
    const link = (await author.client.post(`/publications/${pub.id}/share-links`, {})).body;
    const anon = t.client();
    const photo = (await anon.get(`/public/routes/${pub.slug}`)).body.entries[0].media[0].url.replace("/api/v1", "");

    expect((await reporter.client.post("/reports", { publicationId: pub.id, reason: "SPAM", detail: "no me gusta" })).status).toBe(201);
    expect((await reporter.client.post("/reports", { publicationId: pub.id, reason: "SPAM" })).status).toBe(201); // idempotente
    expect((await reporter.client.get("/moderation/reports")).status).toBe(403);

    const reports = (await mod.client.get("/moderation/reports")).body as { id: string; publicationId: string }[];
    const mine = reports.filter((r) => r.publicationId === pub.id);
    expect(mine).toHaveLength(1);
    const preview = await mod.client.get(`/moderation/publications/${pub.id}/preview`);
    expect(preview.status).toBe(200);
    expect((await mod.client.get(preview.body.entries[0].media[0].url.replace("/api/v1", ""))).status).toBe(200); // el moderador ve el snapshot reportado

    const noReason = await mod.client.post(`/moderation/publications/${pub.id}/actions`, { action: "HIDE", reason: "x" });
    expect(noReason.status).toBe(400);
    const hide = await mod.client.post(`/moderation/publications/${pub.id}/actions`, { action: "HIDE", reason: "Contenido inapropiado", reportId: mine[0]!.id, resolveReport: "RESOLVED" });
    expect(hide.body.moderationStatus).toBe("HIDDEN");

    for (const path of [`/public/routes/${pub.slug}`, `/shared/${link.token}`, photo]) expect((await anon.get(path)).status, path).toBe(404);
    expect((await anon.get("/public/explore?limit=50")).body.items.some((i: { slug: string }) => i.slug === pub.slug)).toBe(false);
    // el autor sigue viendo su diario privado; la visibilidad PUBLIC no se tocó pero no basta
    expect((await author.client.get(`/journeys/${c.journey.id}`)).status).toBe(200);
    expect((await author.client.put(`/publications/${pub.id}/visibility`, { visibility: "PUBLIC" })).status).toBe(200);
    expect((await anon.get(`/public/routes/${pub.slug}`)).status).toBe(404); // el autor no puede saltarse la moderación

    const audit = await t.db.execute(`select action, reason from moderation_actions where publication_id = '${pub.id}'` as never);
    expect(audit.rows).toEqual([{ action: "HIDE", reason: "Contenido inapropiado" }]);
    expect((await mod.client.post(`/moderation/publications/${pub.id}/actions`, { action: "RESTORE", reason: "Revisado: es correcto" })).body.moderationStatus).toBe("VISIBLE");
    expect((await anon.get(`/public/routes/${pub.slug}`)).status).toBe(200);
    expect((await mod.client.get(`/journeys/${c.journey.id}`)).status).toBe(404); // la moderación no accede a diarios privados
  });
});

describe("Comunidad: guardar, copiar, perfiles", () => {
  it("usar como base copia paradas con atribución, sin fotos, notas ni GPS; es atómico e idempotente", async () => {
    const author = await newUser(t);
    const reader = await newUser(t);
    const c = await completedJourney(author, { withPhoto: true });
    await author.client.post(`/recordings/${c.rec.id}/track-batches`, { segmentClientId: "seg-copy-001", startedAt: nowIso(), points: [{ seq: 0, recordedAt: nowIso(), lng: -73.25, lat: -3.75 }] }).catch(() => undefined);
    const pub = (await author.client.put(`/journeys/${c.journey.id}/publication`, publishBody(c))).body;
    const route = (await t.client().get(`/public/routes/${pub.slug}`)).body;

    const key = randomUUID();
    const copy = await reader.client.post(`/publications/${route.id}/copy`, { clientMutationId: key });
    expect(copy.status).toBe(201);
    expect(copy.body.stopsCopied).toBe(2);
    const again = await reader.client.post(`/publications/${route.id}/copy`, { clientMutationId: key });
    expect(again.body.journeyId).toBe(copy.body.journeyId);
    expect((await reader.client.get("/journeys")).body.filter((j: { title: string }) => j.title.includes("(mi versión)"))).toHaveLength(1);

    const mine = (await reader.client.get(`/journeys/${copy.body.journeyId}`)).body;
    expect(mine.status).toBe("DRAFT");
    expect(mine.days.flatMap((d: { stops: unknown[] }) => d.stops)).toHaveLength(2);
    expect(mine.sourcePublicationId).toBe(route.id);
    expect(mine.visitsCount).toBe(0);
    expect(mine.recording).toBeNull();
    expect(JSON.stringify(mine)).not.toContain("NOTA-PRIVADA-secreta");
    expect((await reader.client.get(`/visits/${c.v1.id}`)).status).toBe(404);
    // el autor conserva su diario intacto
    expect((await author.client.get(`/journeys/${c.journey.id}`)).body.visitsCount).toBe(2);
    expect((await t.db.select().from(visits).where(eq(visits.journeyId, copy.body.journeyId)))).toHaveLength(0);
    // retirar la publicación no destruye la copia (la FK de atribución es SET NULL)
    await author.client.put(`/publications/${pub.id}/visibility`, { visibility: "PRIVATE" });
    expect((await reader.client.get(`/journeys/${copy.body.journeyId}`)).status).toBe(200);
    expect((await reader.client.post(`/publications/${route.id}/copy`, { clientMutationId: randomUUID() })).status).toBe(404);
  });

  it("lugares personales con ubicación oculta no se copian y se informa cuántos", async () => {
    const author = await newUser(t);
    const reader = await newUser(t);
    const { journey } = await manualJourney(t, author, 1);
    const rec = (await author.client.post(`/journeys/${journey.id}/recording/start`)).body;
    const secret = (await author.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), newPlace: { name: "Casa de mi amigo", lng: -73.26, lat: -3.76 }, visitedAt: nowIso(), timezone: "UTC" })).body;
    const open = (await author.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), newPlace: { name: "Rincón con vista", lng: -73.27, lat: -3.77 }, visitedAt: nowIso(), timezone: "UTC" })).body;
    await author.client.post(`/journeys/${journey.id}/recording/finish`, { watermarks: {} });
    const pub = (
      await author.client.put(`/journeys/${journey.id}/publication`, {
        title: "Con lugares personales",
        visibility: "PUBLIC",
        entries: [
          { visitId: secret.id, locationPrecision: "HIDDEN" },
          { visitId: open.id, locationPrecision: "EXACT" },
        ],
      })
    ).body;
    const route = (await t.client().get(`/public/routes/${pub.slug}`)).body;
    expect(JSON.stringify(route)).not.toContain(secret.placeId);
    expect(route.entries.find((e: { displayName: string }) => e.displayName === "Casa de mi amigo").location).toBeNull();

    const copy = await reader.client.post(`/publications/${route.id}/copy`, { clientMutationId: randomUUID() });
    expect(copy.body).toMatchObject({ stopsCopied: 1, skippedStops: 1 });
    const copied = (await reader.client.get(`/journeys/${copy.body.journeyId}`)).body;
    const stop = copied.days[0].stops[0];
    expect(stop.place.scope).toBe("PERSONAL");
    expect(stop.placeId).not.toBe(open.placeId); // lugar propio del lector, no una referencia al del autor
    expect((await reader.client.get(`/places/${open.placeId}`)).status).toBe(404);
  });

  it("guardados: añadir, listar, quitar; si la publicación deja de ser pública aparece «No disponible» sin contenido", async () => {
    const author = await newUser(t);
    const reader = await newUser(t);
    const c = await completedJourney(author);
    const pub = (await author.client.put(`/journeys/${c.journey.id}/publication`, publishBody(c))).body;

    expect((await t.client().post("/bookmarks", { publicationId: pub.id })).status).toBe(401);
    expect((await reader.client.post("/bookmarks", { publicationId: pub.id })).status).toBe(201);
    expect((await reader.client.post("/bookmarks", { publicationId: pub.id })).status).toBe(201); // idempotente
    expect((await reader.client.get(`/bookmarks/${pub.id}`)).body.bookmarked).toBe(true);
    const list = (await reader.client.get("/bookmarks")).body;
    expect(list).toHaveLength(1);
    expect(list[0].available).toBe(true);
    expect(list[0].card.title).toBe("Mi día en Iquitos");

    await author.client.put(`/publications/${pub.id}/visibility`, { visibility: "PRIVATE" });
    const after = (await reader.client.get("/bookmarks")).body;
    expect(after[0]).toMatchObject({ available: false, card: null });
    expect(JSON.stringify(after)).not.toContain("Mi día en Iquitos");
    expect((await reader.client.delete(`/bookmarks/${pub.id}`)).status).toBe(200);
    expect((await reader.client.get("/bookmarks")).body).toHaveLength(0);
  });

  it("perfil público: solo historias públicas, sin email ni datos privados", async () => {
    const author = await newUser(t);
    const c1 = await completedJourney(author);
    const c2 = await completedJourney(author);
    const p1 = (await author.client.put(`/journeys/${c1.journey.id}/publication`, publishBody(c1, { title: "Pública" }))).body;
    await author.client.put(`/journeys/${c2.journey.id}/publication`, publishBody(c2, { title: "Solo enlace", visibility: "UNLISTED" }));
    const prof = await t.client().get(`/public/profiles/${author.username}`);
    expect(prof.status).toBe(200);
    expect(prof.body.routes.map((r: { slug: string }) => r.slug)).toEqual([p1.slug]);
    const json = JSON.stringify(prof.body);
    expect(json).not.toContain(author.email);
    expect(json).not.toContain(author.id);
    expect((await t.client().get(`/public/profiles/${author.username.toUpperCase()}`)).status).toBe(200); // insensible a mayúsculas
    expect((await t.client().get("/public/profiles/no_existe_jamas")).status).toBe(404);
  });

  it("explorar pagina por cursor estable y filtra", async () => {
    const author = await newUser(t);
    const slugs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const c = await completedJourney(author);
      await author.client.patch(`/journeys/${c.journey.id}`, { preferences: { interests: ["historia"], pace: "RELAXED", transport: "WALK", destinationLabel: "Iquitos, Perú" }, expectedVersion: c.journey.version });
      const p = (await author.client.put(`/journeys/${c.journey.id}/publication`, publishBody(c, { title: `Paginación ${i}` }))).body;
      slugs.push(p.slug);
    }
    const anon = t.client();
    const page1 = (await anon.get("/public/explore?limit=2&q=Paginaci%C3%B3n")).body;
    expect(page1.items).toHaveLength(2);
    expect(page1.nextCursor).toBeTruthy();
    const page2 = (await anon.get(`/public/explore?limit=2&q=Paginaci%C3%B3n&cursor=${encodeURIComponent(page1.nextCursor)}`)).body;
    expect(page2.items).toHaveLength(1);
    expect(page2.nextCursor).toBeNull();
    const all = [...page1.items, ...page2.items].map((i: { slug: string }) => i.slug);
    expect(new Set(all).size).toBe(3);
    expect(all.sort()).toEqual([...slugs].sort());
    expect((await anon.get("/public/explore?q=zzzz-no-existe")).body.items).toHaveLength(0);
    expect((await anon.get("/public/explore?interest=historia&transport=WALK&q=Paginaci%C3%B3n")).body.items.length).toBe(3);
    expect((await anon.get("/public/explore?transport=CAR&q=Paginaci%C3%B3n")).body.items).toHaveLength(0);
    expect((await anon.get("/public/explore?limit=500")).status).toBe(400);
    void publications;
    void journeys;
  });
});
