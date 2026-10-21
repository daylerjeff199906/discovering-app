import { randomUUID } from "node:crypto";
import { journeyStops, visits } from "@por-aqui/database";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { catalogPlaces, manualJourney, newUser, nowIso, startApp, type TestApp } from "./helpers";

let t: TestApp;
let fx: TestApp;
beforeAll(async () => {
  t = await startApp();
  fx = await startApp({ ROUTING_PROVIDER: "fixture" });
});
afterAll(async () => {
  await t.close();
  await fx.close();
});

describe("Ruta manual", () => {
  it("persiste días, orden y preferencias al recargar", async () => {
    const u = await newUser(t);
    const { journey, places } = await manualJourney(t, u, 3);
    const prefs = { interests: ["historia"], pace: "RELAXED", transport: "WALK", destinationLabel: "Iquitos" };
    const upd = await u.client.patch(`/journeys/${journey.id}`, { preferences: prefs, expectedVersion: journey.version });
    expect(upd.status).toBe(200);

    const reload = (await u.client.get(`/journeys/${journey.id}`)).body;
    expect(reload.days).toHaveLength(1);
    expect(reload.days[0].stops.map((s: { placeId: string }) => s.placeId)).toEqual(places.map((p) => p.id));
    expect(reload.days[0].stops.map((s: { position: number }) => s.position)).toEqual([0, 1, 2]);
    expect(reload.preferences).toMatchObject(prefs);
    expect(reload.status).toBe("DRAFT");
    expect(reload.days[0].stops[0].place.name).toBe(places[0]!.name);
  });

  it("reordena en una transacción; rechaza listas incompletas o con IDs ajenos", async () => {
    const u = await newUser(t);
    const { journey } = await manualJourney(t, u, 3);
    const ids: string[] = journey.days[0].stops.map((s: { id: string }) => s.id);
    const dayId = journey.days[0].id;

    const ok = await u.client.post(`/journeys/${journey.id}/reorder`, { layout: [{ dayId, stopIds: [ids[2], ids[0], ids[1]] }], expectedVersion: journey.version });
    expect(ok.status).toBe(200);
    expect(ok.body.days[0].stops.map((s: { id: string }) => s.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(ok.body.version).toBe(journey.version + 1);

    const missing = await u.client.post(`/journeys/${journey.id}/reorder`, { layout: [{ dayId, stopIds: [ids[0], ids[1]] }], expectedVersion: ok.body.version });
    expect(missing.status).toBe(400);
    const dup = await u.client.post(`/journeys/${journey.id}/reorder`, { layout: [{ dayId, stopIds: [ids[0], ids[0], ids[1], ids[2]] }], expectedVersion: ok.body.version });
    expect(dup.status).toBe(400);
    const foreign = await u.client.post(`/journeys/${journey.id}/reorder`, { layout: [{ dayId, stopIds: [ids[0], ids[1], randomUUID()] }], expectedVersion: ok.body.version });
    expect(foreign.status).toBe(400);
    // nada cambió
    expect((await u.client.get(`/journeys/${journey.id}`)).body.days[0].stops.map((s: { id: string }) => s.id)).toEqual([ids[2], ids[0], ids[1]]);
  });

  it("dos reordenamientos concurrentes con la misma versión: uno gana, el otro recibe 409 y no hay pérdida de datos", async () => {
    const u = await newUser(t);
    const { journey } = await manualJourney(t, u, 3);
    const ids: string[] = journey.days[0].stops.map((s: { id: string }) => s.id);
    const dayId = journey.days[0].id;
    const a = [ids[1], ids[0], ids[2]];
    const b = [ids[2], ids[1], ids[0]];
    const [r1, r2] = await Promise.all([
      u.client.post(`/journeys/${journey.id}/reorder`, { layout: [{ dayId, stopIds: a }], expectedVersion: journey.version }),
      u.client.post(`/journeys/${journey.id}/reorder`, { layout: [{ dayId, stopIds: b }], expectedVersion: journey.version }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const conflict = r1.status === 409 ? r1 : r2;
    expect(conflict.body.code).toBe("VERSION_CONFLICT");
    expect(conflict.body.details.currentVersion).toBe(journey.version + 1);

    const final = (await u.client.get(`/journeys/${journey.id}`)).body;
    const winner = r1.status === 200 ? a : b;
    expect(final.days[0].stops.map((s: { id: string }) => s.id)).toEqual(winner);
    expect(final.days[0].stops).toHaveLength(3);
  });

  it("mueve paradas entre días y compacta posiciones al quitar", async () => {
    const u = await newUser(t);
    let { journey } = await manualJourney(t, u, 3);
    journey = (await u.client.post(`/journeys/${journey.id}/days`, { expectedVersion: journey.version })).body;
    const [d1, d2] = journey.days;
    const ids: string[] = d1.stops.map((s: { id: string }) => s.id);
    const moved = await u.client.post(`/journeys/${journey.id}/reorder`, {
      layout: [{ dayId: d1.id, stopIds: [ids[0]] }, { dayId: d2.id, stopIds: [ids[2], ids[1]] }],
      expectedVersion: journey.version,
    });
    expect(moved.status).toBe(200);
    expect(moved.body.days[1].stops.map((s: { id: string }) => s.id)).toEqual([ids[2], ids[1]]);

    const removed = await u.client.delete(`/journeys/${journey.id}/stops/${ids[2]}?expectedVersion=${moved.body.version}`);
    expect(removed.status).toBe(200);
    expect(removed.body.days[1].stops.map((s: { position: number }) => s.position)).toEqual([0]);
  });

  it("quitar una parada conserva la visita (stop_id pasa a null)", async () => {
    const u = await newUser(t);
    const { journey } = await manualJourney(t, u, 2);
    const rec = (await u.client.post(`/journeys/${journey.id}/recording/start`)).body;
    const stop = journey.days[0].stops[0];
    const v = await u.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), placeId: stop.placeId, stopId: stop.id, visitedAt: nowIso(), timezone: "America/Lima", note: "recuerdo" });
    expect(v.status).toBe(201);
    expect(v.body.stopId).toBe(stop.id);

    expect((await u.client.delete(`/journeys/${journey.id}/stops/${stop.id}?expectedVersion=${journey.version}`)).status).toBe(200);
    const [row] = await t.db.select().from(visits).where(eq(visits.id, v.body.id));
    expect(row!.stopId).toBeNull();
    expect(row!.note).toBe("recuerdo");
    expect(await t.db.select().from(journeyStops).where(eq(journeyStops.id, stop.id))).toHaveLength(0);
  });

  it("deriva un único estado visible a partir de plan + ejecución + archivo", async () => {
    const u = await newUser(t);
    const { journey } = await manualJourney(t, u, 1);
    const status = async () => (await u.client.get("/journeys")).body.find((j: { id: string }) => j.id === journey.id).status;
    expect(await status()).toBe("DRAFT");
    await u.client.patch(`/journeys/${journey.id}`, { planStatus: "READY", expectedVersion: journey.version });
    expect(await status()).toBe("PLANNED");
    await u.client.post(`/journeys/${journey.id}/recording/start`);
    expect(await status()).toBe("IN_PROGRESS");
    await u.client.post(`/journeys/${journey.id}/recording/pause`);
    expect(await status()).toBe("PAUSED");
    await u.client.post(`/journeys/${journey.id}/recording/resume`);
    await u.client.post(`/journeys/${journey.id}/recording/finish`, { watermarks: {} });
    expect(await status()).toBe("COMPLETED");
    await u.client.post(`/journeys/${journey.id}/archive`);
    expect((await u.client.get("/journeys?includeArchived=true")).body.find((j: { id: string }) => j.id === journey.id).status).toBe("ARCHIVED");
    expect((await u.client.get("/journeys")).body.find((j: { id: string }) => j.id === journey.id)).toBeUndefined();
  });
});

describe("Aislamiento entre usuarios (IDOR)", () => {
  it("B no puede leer, modificar ni usar recursos de A cambiando IDs", async () => {
    const a = await newUser(t);
    const b = await newUser(t);
    const { journey } = await manualJourney(t, a, 2);
    const stop = journey.days[0].stops[0];
    const rec = (await a.client.post(`/journeys/${journey.id}/recording/start`)).body;
    const visit = (await a.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), placeId: stop.placeId, visitedAt: nowIso(), timezone: "America/Lima", note: "privado" })).body;
    const mine = (await a.client.post("/places", { name: "Mi rincón secreto", lng: -73.25, lat: -3.75 })).body;

    const attempts = [
      await b.client.get(`/journeys/${journey.id}`),
      await b.client.patch(`/journeys/${journey.id}`, { title: "hack", expectedVersion: journey.version }),
      await b.client.post(`/journeys/${journey.id}/stops`, { dayId: journey.days[0].id, placeId: stop.placeId, expectedVersion: journey.version }),
      await b.client.post(`/journeys/${journey.id}/reorder`, { layout: [], expectedVersion: journey.version }),
      await b.client.post(`/journeys/${journey.id}/archive`),
      await b.client.post(`/journeys/${journey.id}/recording/pause`),
      await b.client.get(`/recordings/${rec.id}/visits`),
      await b.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), placeId: stop.placeId, visitedAt: nowIso(), timezone: "UTC" }),
      await b.client.post(`/recordings/${rec.id}/track-batches`, { segmentClientId: "seg-12345", startedAt: nowIso(), points: [{ seq: 0, recordedAt: nowIso(), lng: -73, lat: -3 }] }),
      await b.client.get(`/visits/${visit.id}`),
      await b.client.patch(`/visits/${visit.id}`, { note: "hack", expectedVersion: 1 }),
      await b.client.delete(`/visits/${visit.id}`),
      await b.client.post(`/visits/${visit.id}/media/uploads`, { mimeType: "image/jpeg", sizeBytes: 1000 }),
      await b.client.get(`/journeys/${journey.id}/publication`),
      await b.client.get(`/places/${mine.id}`),
    ];
    for (const r of attempts) expect([404], JSON.stringify(r.body)).toContain(r.status);

    // B no puede usar un lugar personal de A en sus paradas ni verlo en búsquedas
    const bj = (await b.client.post("/journeys", { title: "B", creationMode: "MANUAL" })).body;
    const useForeign = await b.client.post(`/journeys/${bj.id}/stops`, { dayId: bj.days[0].id, placeId: mine.id, expectedVersion: bj.version });
    expect(useForeign.status).toBe(404);
    const search = await b.client.get("/places/search?q=secreto&scope=all");
    expect(search.body).toHaveLength(0);
    expect((await a.client.get("/places/search?q=secreto")).body).toHaveLength(1);

    // y los datos de A siguen intactos
    const intact = (await a.client.get(`/journeys/${journey.id}`)).body;
    expect(intact.title).toBe("Mi viaje");
    expect((await a.client.get(`/visits/${visit.id}`)).body.note).toBe("privado");
  });

  it("no permite que una visita referencie una parada de otro viaje", async () => {
    const a = await newUser(t);
    const one = await manualJourney(t, a, 1);
    const two = await manualJourney(t, a, 1);
    const rec = (await a.client.post(`/journeys/${one.journey.id}/recording/start`)).body;
    const r = await a.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), placeId: one.places[0]!.id, stopId: two.journey.days[0].stops[0].id, visitedAt: nowIso(), timezone: "UTC" });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("STOP_INVALID");
  });

  it("los endpoints privados exigen sesión y los públicos funcionan sin ella", async () => {
    const anon = t.client();
    for (const path of ["/journeys", "/bookmarks", "/auth/sessions", "/moderation/reports"]) expect((await anon.get(path)).status, path).toBe(401);
    for (const path of ["/public/explore", "/meta/capabilities", "/places/search?q=plaza"]) expect((await anon.get(path)).status, path).toBe(200);
    const user = await newUser(t);
    expect((await user.client.get("/moderation/reports")).status).toBe(403);
  });
});

describe("Propuesta automática", () => {
  it("sin proveedor de rutas degrada con honestidad: ordena por cercanía pero deja los traslados «Por definir»", async () => {
    const u = await newUser(t);
    let j = (await u.client.post("/journeys", { title: "Auto", creationMode: "AUTOMATIC" })).body;
    const input = { destinationLabel: "Iquitos", daysCount: 1, availableMinutesPerDay: 480, interests: ["historia"], transport: "WALK", pace: "MODERATE", expectedVersion: j.version };
    const res = await u.client.post(`/journeys/${j.id}/proposals`, input);
    expect(res.status).toBe(200);
    const p = res.body;
    expect(p.days).toHaveLength(1);
    expect(p.days[0].stops.length).toBeGreaterThanOrEqual(2);
    expect(p.days[0].stops.length).toBeLessThanOrEqual(5);
    for (const leg of p.days[0].legs) {
      expect(leg.durationS).toBeNull();
      expect(leg.distanceM).toBeNull();
      expect(leg.quality).toBe("UNKNOWN");
    }
    expect(p.warnings.map((w: { code: string }) => w.code)).toContain("ROUTING_UNAVAILABLE");
    expect(p.days[0].stops.every((s: { place: { locality: string } }) => s.place.locality === "Iquitos")).toBe(true);
    expect(p.days[0].stops.some((s: { hoursKnown: boolean }) => s.hoursKnown)).toBe(false);

    const applied = await u.client.post(`/journeys/${j.id}/proposals/apply`, { proposal: p, expectedVersion: j.version });
    expect(applied.status).toBe(200);
    j = applied.body;
    expect(j.days[0].stops.length).toBe(p.days[0].stops.length);
    // aplicar de nuevo con la versión vieja → 409 y no se pisa nada
    const stale = await u.client.post(`/journeys/${j.id}/proposals/apply`, { proposal: p, expectedVersion: j.version - 1 });
    expect(stale.status).toBe(409);
  });

  it("con proveedor calcula tiempos de traslado según el modo; modos sin proveedor quedan sin tiempos", async () => {
    const u = await newUser(fx);
    const j = (await u.client.post("/journeys", { title: "Auto", creationMode: "AUTOMATIC" })).body;
    const base = { destinationLabel: "Iquitos", daysCount: 1, availableMinutesPerDay: 480, interests: [], pace: "MODERATE", expectedVersion: j.version };
    const walk = (await u.client.post(`/journeys/${j.id}/proposals`, { ...base, transport: "WALK" })).body;
    expect(walk.days[0].legs.length).toBeGreaterThan(0);
    for (const leg of walk.days[0].legs) {
      expect(leg.durationS).toBeGreaterThan(0);
      expect(leg.quality).toBe("ESTIMATED"); // proveedor determinista de pruebas, marcado como estimado
      expect(leg.source).toBe("fixture");
    }
    expect(walk.dataSources.join(" ")).toContain("estimado");
    const boat = (await u.client.post(`/journeys/${j.id}/proposals`, { ...base, transport: "BOAT" })).body;
    for (const leg of boat.days[0].legs) expect(leg.durationS).toBeNull();
    expect(boat.warnings.map((w: { code: string }) => w.code)).toContain("ROUTING_UNAVAILABLE");
  });

  it("destino desconocido devuelve propuesta vacía y parcial, sin inventar lugares", async () => {
    const u = await newUser(t);
    const j = (await u.client.post("/journeys", { title: "Auto", creationMode: "AUTOMATIC" })).body;
    const r = await u.client.post(`/journeys/${j.id}/proposals`, { destinationLabel: "Atlántida", daysCount: 2, availableMinutesPerDay: 480, interests: [], transport: "WALK", pace: "MODERATE", expectedVersion: j.version });
    expect(r.status).toBe(200);
    expect(r.body.days).toHaveLength(0);
    expect(r.body.partial).toBe(true);
    expect(r.body.warnings[0].code).toBe("NO_DATA");
  });

  it("recalcula tramos tras reordenar sin pisar tramos manuales", async () => {
    const u = await newUser(fx);
    const { journey } = await manualJourney(fx, u, 3);
    const stops = journey.days[0].stops;
    const manual = await u.client.put(`/journeys/${journey.id}/legs`, { fromStopId: stops[0].id, toStopId: stops[1].id, mode: "BOAT", durationS: 5400, expectedVersion: journey.version });
    expect(manual.status).toBe(200);
    const rc = await u.client.post(`/journeys/${journey.id}/legs/recalculate`);
    expect(rc.body.applied).toBe(true);
    const legs = rc.body.journey.legs;
    expect(legs.find((l: { fromStopId: string }) => l.fromStopId === stops[0].id)).toMatchObject({ mode: "BOAT", durationS: 5400, quality: "MANUAL" });
    expect(legs.find((l: { fromStopId: string }) => l.fromStopId === stops[1].id)).toMatchObject({ quality: "ESTIMATED" });
  });

  it("el catálogo existe en PostGIS y la búsqueda por radio usa metros", async () => {
    const [plaza] = (await catalogPlaces(t)).filter((p) => p.name.startsWith("Plaza de Armas"));
    const c = t.client();
    const near = (await c.get(`/places/search?lng=${plaza!.location.lng}&lat=${plaza!.location.lat}&radiusM=700`)).body as { name: string; distanceM: number }[];
    expect(near.length).toBeGreaterThanOrEqual(2);
    expect(near.every((p) => p.distanceM <= 700)).toBe(true);
    expect(near[0]!.distanceM).toBeLessThanOrEqual(near[near.length - 1]!.distanceM);
    const far = (await c.get(`/places/search?lng=${plaza!.location.lng}&lat=${plaza!.location.lat}&radiusM=100000`)).body as { locality: string }[];
    expect(far.every((p) => p.locality === "Iquitos")).toBe(true);
  });
});
