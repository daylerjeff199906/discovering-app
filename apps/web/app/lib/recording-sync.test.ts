import { ApiError, NetworkError } from "@por-aqui/api-client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearLocalData, enqueuePoint, listQueuedVisits, openSegment, pendingCounts } from "./offline-queue";

const mocks = vi.hoisted(() => ({ create: vi.fn(), trackBatch: vi.fn() }));
vi.mock("./api", () => ({ api: { visits: { create: mocks.create }, recording: { trackBatch: mocks.trackBatch } } }));

import { flushAll, flushTrack, submitVisit } from "./recording-sync";

const U = "u-sync";
const REC = "rec-sync";
const J = "j-sync";
const payload = { clientMutationId: "abcdefgh1234", placeId: "7d4a3c1e-5c52-4a3a-9a55-0f0b6e5d3a10", visitedAt: "2026-03-01T15:00:00.000Z", timezone: "UTC" } as never;

beforeEach(async () => {
  mocks.create.mockReset();
  mocks.trackBatch.mockReset();
  await clearLocalData(U);
});

async function seedPoints(n: number) {
  await openSegment(U, REC, "seg-1", "2026-03-01T10:00:00.000Z");
  for (let i = 0; i < n; i++) {
    await enqueuePoint(U, { recordingId: REC, segmentClientId: "seg-1", segmentStartedAt: "2026-03-01T10:00:00.000Z", recordedAt: `2026-03-01T10:00:0${i}.000Z`, lng: -73, lat: -3, accuracyM: 5 });
  }
}

describe("sincronización offline → online", () => {
  it("una visita sin red queda en cola con su clientMutationId y se envía al reconectar sin duplicar", async () => {
    mocks.create.mockRejectedValueOnce(new NetworkError());
    expect(await submitVisit(U, J, REC, payload)).toEqual({ status: "queued" });
    expect(await listQueuedVisits(U, J)).toHaveLength(1);

    mocks.create.mockResolvedValue({ id: "v1" });
    const r = await flushAll(U, J, REC);
    expect(r.sentVisits).toBe(1);
    expect(r.remaining.visits).toBe(0);
    expect(mocks.create).toHaveBeenLastCalledWith(REC, payload); // el mismo cuerpo, el mismo clientMutationId
  });

  it("los puntos se envían en lote y solo se borran cuando el servidor los confirma", async () => {
    await seedPoints(3);
    mocks.trackBatch.mockRejectedValueOnce(new NetworkError());
    expect(await flushTrack(U, REC)).toMatchObject({ online: false, sent: 0 });
    expect((await pendingCounts(U, REC, J)).points).toBe(3); // nada se perdió

    mocks.trackBatch.mockResolvedValue({ accepted: 3, duplicates: 0, rejected: 0, watermark: 2 });
    expect(await flushTrack(U, REC)).toMatchObject({ online: true, sent: 3 });
    expect((await pendingCounts(U, REC, J)).points).toBe(0);
    expect(mocks.trackBatch.mock.calls.at(-1)![1].points.map((p: { seq: number }) => p.seq)).toEqual([0, 1, 2]);
  });

  it("un error permanente (4xx) de una visita se conserva visible en lugar de reintentarse sin fin", async () => {
    mocks.create.mockRejectedValueOnce(new NetworkError());
    await submitVisit(U, J, REC, payload);
    mocks.create.mockRejectedValue(new ApiError(400, { code: "VALIDATION_ERROR", message: "Fecha inválida" }));
    const r = await flushAll(U, J, REC);
    expect(r.remaining).toMatchObject({ visits: 0, failedVisits: 1 });
    expect((await listQueuedVisits(U, J))[0]!.failure).toBe("Fecha inválida");
  });

  it("si el recorrido ya cerró (409) deja de intentar enviar puntos nuevos", async () => {
    await seedPoints(2);
    mocks.trackBatch.mockRejectedValue(new ApiError(409, { code: "RECORDING_CLOSED", message: "cerrado" }));
    expect(await flushTrack(U, REC)).toMatchObject({ closed: true });
  });
});
