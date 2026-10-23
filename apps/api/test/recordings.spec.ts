import { randomUUID } from "node:crypto";
import { trackPoints, trackSegments, visits } from "@por-aqui/database";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { manualJourney, newUser, nowIso, startApp, type TestApp, type TestUser } from "./helpers";

let t: TestApp;
beforeAll(async () => {
  t = await startApp();
});
afterAll(async () => {
  await t.close();
});

async function started(u: TestUser, free = false) {
  if (free) {
    const j = (await u.client.post("/journeys", { title: "Aventura libre", creationMode: "FREE" })).body;
    const rec = (await u.client.post(`/journeys/${j.id}/recording/start`)).body;
    return { journey: j, rec, places: [] as { id: string }[] };
  }
  const { journey, places } = await manualJourney(t, u, 3);
  const rec = (await u.client.post(`/journeys/${journey.id}/recording/start`)).body;
  return { journey, rec, places };
}

const pt = (seq: number, extra: Record<string, unknown> = {}) => ({ seq, recordedAt: new Date(Date.now() - 60_000 + seq * 1000).toISOString(), lng: -73.25 + seq * 0.0001, lat: -3.75, accuracyM: 8, ...extra });

describe("Visitas", () => {
  it("registra sin GPS ni fotos, también visitas pasadas y varias al mismo lugar", async () => {
    const u = await newUser(t);
    const { rec, places } = await started(u);
    const place = places[0]!;
    const past = await u.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), placeId: place.id, visitedAt: "2026-03-01T15:00:00-05:00", timezone: "America/Lima", note: "ayer" });
    expect(past.status).toBe(201);
    expect(past.body.visitedAt).toBe("2026-03-01T20:00:00.000Z");
    expect(past.body.media).toEqual([]);
    const again = await u.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), placeId: place.id, visitedAt: nowIso(), timezone: "America/Lima" });
    expect(again.status).toBe(201);
    const list = (await u.client.get(`/recordings/${rec.id}/visits`)).body;
    expect(list.map((v: { id: string }) => v.id)).toEqual([past.body.id, again.body.id]); // orden cronológico
  });

  it("es idempotente por clientMutationId: el reintento no duplica", async () => {
    const u = await newUser(t);
    const { rec, places } = await started(u);
    const body = { clientMutationId: randomUUID(), placeId: places[0]!.id, visitedAt: nowIso(), timezone: "America/Lima", note: "una vez" };
    const [a, b] = await Promise.all([u.client.post(`/recordings/${rec.id}/visits`, body), u.client.post(`/recordings/${rec.id}/visits`, body)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.id).toBe(b.body.id);
    const retry = await u.client.post(`/recordings/${rec.id}/visits`, body);
    expect(retry.status).toBe(200);
    expect(await t.db.select().from(visits).where(eq(visits.recordingId, rec.id))).toHaveLength(1);
  });

  it("aventura libre: crea un lugar personal al vuelo y lo deja privado", async () => {
    const u = await newUser(t);
    const other = await newUser(t);
    const { rec } = await started(u, true);
    const v = await u.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), newPlace: { name: "Mirador sin nombre", lng: -73.3, lat: -3.8 }, visitedAt: nowIso(), timezone: "America/Lima" });
    expect(v.status).toBe(201);
    expect(v.body.place).toMatchObject({ name: "Mirador sin nombre", scope: "PERSONAL" });
    expect((await other.client.get(`/places/${v.body.placeId}`)).status).toBe(404);
  });

  it("tras finalizar exige confirmar explícitamente una visita pasada (retroactive)", async () => {
    const u = await newUser(t);
    const { journey, rec, places } = await started(u);
    await u.client.post(`/journeys/${journey.id}/recording/finish`, { watermarks: {} });
    const blocked = await u.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), placeId: places[0]!.id, visitedAt: nowIso(), timezone: "UTC" });
    expect(blocked.status).toBe(409);
    expect(blocked.body.code).toBe("RECORDING_CLOSED");
    const ok = await u.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), placeId: places[0]!.id, visitedAt: nowIso(), timezone: "UTC", retroactive: true });
    expect(ok.status).toBe(201);
  });

  it("edición con control de versión y borrado", async () => {
    const u = await newUser(t);
    const { rec, places } = await started(u);
    const v = (await u.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), placeId: places[0]!.id, visitedAt: nowIso(), timezone: "UTC", note: "v1" })).body;
    const ok = await u.client.patch(`/visits/${v.id}`, { note: "v2", expectedVersion: v.version });
    expect(ok.status).toBe(200);
    expect(ok.body.note).toBe("v2");
    const stale = await u.client.patch(`/visits/${v.id}`, { note: "v3", expectedVersion: v.version });
    expect(stale.status).toBe(409);
    expect((await u.client.delete(`/visits/${v.id}`)).status).toBe(200);
    expect((await u.client.get(`/visits/${v.id}`)).status).toBe(404);
  });

  it("guarda gasto, transporte y recomendación opcionales; el gasto exige monto y moneda", async () => {
    const u = await newUser(t);
    const { rec, places } = await started(u);
    const base = { placeId: places[0]!.id, visitedAt: nowIso(), timezone: "America/Lima" };
    const plain = await u.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), ...base });
    expect(plain.status).toBe(201);
    expect(plain.body).toMatchObject({ expenseMinor: null, expenseCurrency: null, transportMode: null, recommendation: null });

    const full = await u.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), ...base, expenseMinor: 1250, expenseCurrency: "pen", transportMode: "WALK", recommendation: "  Ve temprano  " });
    expect(full.status).toBe(201);
    expect(full.body).toMatchObject({ expenseMinor: 1250, expenseCurrency: "PEN", transportMode: "WALK", recommendation: "Ve temprano" });

    const half = await u.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), ...base, expenseMinor: 500 });
    expect(half.status).toBe(400);
    const negative = await u.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), ...base, expenseMinor: -1, expenseCurrency: "PEN" });
    expect(negative.status).toBe(400);

    const upd = await u.client.patch(`/visits/${full.body.id}`, { expenseMinor: null, expenseCurrency: null, recommendation: null, expectedVersion: full.body.version });
    expect(upd.status).toBe(200);
    expect(upd.body).toMatchObject({ expenseMinor: null, expenseCurrency: null, recommendation: null, transportMode: "WALK" });
  });

  it("rechaza fechas futuras", async () => {
    const u = await newUser(t);
    const { rec, places } = await started(u);
    const r = await u.client.post(`/recordings/${rec.id}/visits`, { clientMutationId: randomUUID(), placeId: places[0]!.id, visitedAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), timezone: "UTC" });
    expect(r.status).toBe(400);
  });
});

describe("Recorrido y trayecto GPS", () => {
  it("start es idempotente y las transiciones son coherentes", async () => {
    const u = await newUser(t);
    const { journey, rec } = await started(u);
    expect((await u.client.post(`/journeys/${journey.id}/recording/start`)).body.id).toBe(rec.id);
    expect((await u.client.post(`/journeys/${journey.id}/recording/pause`)).body.status).toBe("PAUSED");
    expect((await u.client.post(`/journeys/${journey.id}/recording/pause`)).body.status).toBe("PAUSED"); // idempotente
    expect((await u.client.post(`/journeys/${journey.id}/recording/resume`)).body.status).toBe("ACTIVE");
    const fin = await u.client.post(`/journeys/${journey.id}/recording/finish`, { watermarks: {} });
    expect(fin.body.status).toBe("COMPLETED");
    expect((await u.client.post(`/journeys/${journey.id}/recording/finish`, { watermarks: {} })).body.status).toBe("COMPLETED"); // sin doble finalización
    expect((await u.client.post(`/journeys/${journey.id}/recording/resume`)).status).toBe(409);
    expect((await u.client.post(`/journeys/${journey.id}/recording/start`)).status).toBe(409);
  });

  it("pausar y reanudar crea segmentos distintos; los lotes duplicados no duplican puntos", async () => {
    const u = await newUser(t);
    const { journey, rec } = await started(u);
    const batch = { segmentClientId: "seg-aaaa-1", startedAt: nowIso(), points: [pt(0), pt(1), pt(2)] };
    const first = await u.client.post(`/recordings/${rec.id}/track-batches`, batch);
    expect(first.body).toEqual({ accepted: 3, duplicates: 0, rejected: 0, watermark: 2 });
    const dup = await u.client.post(`/recordings/${rec.id}/track-batches`, batch);
    expect(dup.body).toEqual({ accepted: 0, duplicates: 3, rejected: 0, watermark: 2 });
    const overlap = await u.client.post(`/recordings/${rec.id}/track-batches`, { ...batch, points: [pt(2), pt(3)] });
    expect(overlap.body).toMatchObject({ accepted: 1, duplicates: 1, watermark: 3 });

    await u.client.post(`/journeys/${journey.id}/recording/pause`);
    // Pausar cierra el segmento: la captura al reanudar abre otro (no se unen los huecos)
    await u.client.post(`/journeys/${journey.id}/recording/resume`);
    const second = await u.client.post(`/recordings/${rec.id}/track-batches`, { segmentClientId: "seg-bbbb-2", startedAt: nowIso(), points: [pt(0), pt(1)] });
    expect(second.body.accepted).toBe(2);

    const segs = await t.db.select().from(trackSegments).where(eq(trackSegments.recordingId, rec.id));
    expect(segs).toHaveLength(2);
    expect(segs.find((s) => s.clientSegmentId === "seg-aaaa-1")!.endedAt).not.toBeNull();
    const track = (await u.client.get(`/recordings/${rec.id}/track`)).body;
    expect(track.segments.map((s: { points: unknown[] }) => s.points.length).sort()).toEqual([2, 4]);
  });

  it("filtra ruido por umbral de precisión sin perder el resto", async () => {
    const u = await newUser(t);
    const { rec } = await started(u);
    const r = await u.client.post(`/recordings/${rec.id}/track-batches`, { segmentClientId: "seg-noise-1", startedAt: nowIso(), points: [pt(0), pt(1, { accuracyM: 900 }), pt(2)] });
    expect(r.body).toMatchObject({ accepted: 2, rejected: 1 });
  });

  it("finalizar concilia pendientes: 409 con detalle, o descarte explícito; luego solo acepta reintentos reconocidos", async () => {
    const u = await newUser(t);
    const { journey, rec } = await started(u);
    await u.client.post(`/recordings/${rec.id}/track-batches`, { segmentClientId: "seg-final-1", startedAt: nowIso(), points: [pt(0), pt(1), pt(2)] });

    // El cliente cree haber capturado hasta la secuencia 5 pero el servidor solo tiene hasta la 2
    const pending = await u.client.post(`/journeys/${journey.id}/recording/finish`, { watermarks: { "seg-final-1": 5 } });
    expect(pending.status).toBe(409);
    expect(pending.body.code).toBe("PENDING_TRACK_DATA");
    expect(pending.body.details.pending["seg-final-1"]).toEqual({ client: 5, server: 2 });
    expect((await u.client.get(`/journeys/${journey.id}`)).body.status).toBe("IN_PROGRESS");

    // Sincroniza lo pendiente y finaliza
    await u.client.post(`/recordings/${rec.id}/track-batches`, { segmentClientId: "seg-final-1", startedAt: nowIso(), points: [pt(3), pt(4), pt(5)] });
    const fin = await u.client.post(`/journeys/${journey.id}/recording/finish`, { watermarks: { "seg-final-1": 5 } });
    expect(fin.status).toBe(200);
    expect(fin.body.trackWatermarks).toEqual({ "seg-final-1": 5 });

    // Reintento de un lote ya reconocido: permitido (idempotente). Puntos nuevos: rechazados.
    const retry = await u.client.post(`/recordings/${rec.id}/track-batches`, { segmentClientId: "seg-final-1", startedAt: nowIso(), points: [pt(4), pt(5)] });
    expect(retry.status).toBe(200);
    expect(retry.body.accepted).toBe(0);
    const late = await u.client.post(`/recordings/${rec.id}/track-batches`, { segmentClientId: "seg-final-1", startedAt: nowIso(), points: [pt(6)] });
    expect(late.status).toBe(409);
    const newSeg = await u.client.post(`/recordings/${rec.id}/track-batches`, { segmentClientId: "seg-nuevo-9", startedAt: nowIso(), points: [pt(0)] });
    expect(newSeg.status).toBe(409);
    expect(await t.db.select().from(trackPoints).innerJoin(trackSegments, eq(trackSegments.id, trackPoints.segmentId)).where(eq(trackSegments.recordingId, rec.id))).toHaveLength(6);
  });

  it("permite descartar explícitamente los puntos que no se sincronizaron", async () => {
    const u = await newUser(t);
    const { journey, rec } = await started(u);
    await u.client.post(`/recordings/${rec.id}/track-batches`, { segmentClientId: "seg-disc-01", startedAt: nowIso(), points: [pt(0)] });
    const fin = await u.client.post(`/journeys/${journey.id}/recording/finish`, { watermarks: { "seg-disc-01": 9 }, discardPending: true });
    expect(fin.status).toBe(200);
    expect(fin.body.trackWatermarks).toEqual({ "seg-disc-01": 0 });
  });
});
