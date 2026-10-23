import { beforeEach, describe, expect, it } from "vitest";
import { clearLocalData, discardPending, enqueuePoint, enqueueVisit, hasPendingData, listQueuedVisits, openSegment, pendingCounts, removePointsUpTo, segmentWatermarks, takePendingBatches } from "./offline-queue";

const U = "user-1";
const REC = "rec-1";
const J = "journey-1";
const point = (segmentClientId: string, n: number) => ({
  recordingId: REC,
  segmentClientId,
  segmentStartedAt: "2026-03-01T10:00:00.000Z",
  recordedAt: `2026-03-01T10:00:0${n}.000Z`,
  lng: -73 + n * 0.001,
  lat: -3,
  accuracyM: 5,
});

beforeEach(async () => {
  await clearLocalData(U);
  await clearLocalData("user-2");
});

describe("cola local (IndexedDB)", () => {
  it("asigna secuencias consecutivas por segmento y calcula el watermark", async () => {
    await openSegment(U, REC, "seg-a", "2026-03-01T10:00:00.000Z");
    await openSegment(U, REC, "seg-b", "2026-03-01T10:05:00.000Z");
    expect(await enqueuePoint(U, point("seg-a", 0))).toBe(0);
    expect(await enqueuePoint(U, point("seg-a", 1))).toBe(1);
    expect(await enqueuePoint(U, point("seg-b", 2))).toBe(0);
    expect(await segmentWatermarks(U, REC)).toEqual({ "seg-a": 1, "seg-b": 0 });
    expect((await pendingCounts(U, REC, J)).points).toBe(3);
  });

  it("arma lotes por segmento y los elimina solo hasta la secuencia confirmada", async () => {
    await openSegment(U, REC, "seg-a", "2026-03-01T10:00:00.000Z");
    for (let i = 0; i < 4; i++) await enqueuePoint(U, point("seg-a", i));
    const [batch] = await takePendingBatches(U, REC);
    expect(batch!.points.map((p) => p.seq)).toEqual([0, 1, 2, 3]);
    expect(batch!.lastSeq).toBe(3);
    await removePointsUpTo(U, REC, "seg-a", 1);
    const [rest] = await takePendingBatches(U, REC);
    expect(rest!.points.map((p) => p.seq)).toEqual([2, 3]); // lo no confirmado sigue en cola
  });

  it("guarda visitas con su clientMutationId (idempotencia) y las separa por aventura", async () => {
    const payload = { clientMutationId: "abcdefgh1234", placeId: "7d4a3c1e-5c52-4a3a-9a55-0f0b6e5d3a10", visitedAt: "2026-03-01T15:00:00.000Z", timezone: "UTC" } as never;
    await enqueueVisit(U, { clientMutationId: "abcdefgh1234", journeyId: J, recordingId: REC, payload });
    await enqueueVisit(U, { clientMutationId: "abcdefgh1234", journeyId: J, recordingId: REC, payload }); // reintento: no duplica
    await enqueueVisit(U, { clientMutationId: "otra-visita-99", journeyId: "otro", recordingId: "r2", payload });
    expect(await listQueuedVisits(U, J)).toHaveLength(1);
    expect(await hasPendingData(U)).toBe(true);
  });

  it("descartar explícitamente limpia puntos y visitas del recorrido", async () => {
    await openSegment(U, REC, "seg-a", "2026-03-01T10:00:00.000Z");
    await enqueuePoint(U, point("seg-a", 0));
    await enqueueVisit(U, { clientMutationId: "abcdefgh1234", journeyId: J, recordingId: REC, payload: {} as never });
    await discardPending(U, REC, J);
    expect(await pendingCounts(U, REC, J)).toEqual({ points: 0, visits: 0, failedVisits: 0 });
  });

  it("aísla por usuario y se borra al cerrar sesión", async () => {
    await enqueueVisit(U, { clientMutationId: "abcdefgh1234", journeyId: J, recordingId: REC, payload: {} as never });
    expect(await listQueuedVisits("user-2", J)).toHaveLength(0);
    await clearLocalData(U);
    expect(await hasPendingData(U)).toBe(false);
  });
});
