import type { CreateVisitInput } from "@por-aqui/contracts";
import { ApiError, NetworkError } from "@por-aqui/api-client";
import { api } from "./api";
import { enqueueVisit, listQueuedVisits, pendingCounts, removePointsUpTo, removeQueuedVisit, takePendingBatches, updateQueuedVisit, type QueuedVisit } from "./offline-queue";

export interface FlushResult {
  sentPoints: number;
  sentVisits: number;
  online: boolean;
  remaining: { points: number; visits: number; failedVisits: number };
}

/** Sincroniza lotes de GPS pendientes. Es idempotente en el servidor: reintentar nunca duplica puntos. */
export async function flushTrack(userId: string, recordingId: string): Promise<{ sent: number; online: boolean; closed: boolean }> {
  let sent = 0;
  for (const batch of await takePendingBatches(userId, recordingId)) {
    try {
      const { lastSeq, ...payload } = batch;
      const res = await api.recording.trackBatch(recordingId, payload);
      await removePointsUpTo(userId, recordingId, batch.segmentClientId, lastSeq);
      sent += res.accepted;
    } catch (err) {
      if (err instanceof NetworkError) return { sent, online: false, closed: false };
      if (err instanceof ApiError && err.code === "RECORDING_CLOSED") return { sent, online: true, closed: true };
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        // Lote rechazado de forma permanente (validación): se descarta ese lote para no bloquear la cola.
        await removePointsUpTo(userId, recordingId, batch.segmentClientId, batch.lastSeq);
        continue;
      }
      return { sent, online: true, closed: false };
    }
  }
  return { sent, online: true, closed: false };
}

/** Envía las visitas encoladas, en orden. Detiene el ciclo ante un fallo de red. */
export async function flushVisits(userId: string, journeyId: string): Promise<{ sent: number; online: boolean }> {
  let sent = 0;
  for (const v of await listQueuedVisits(userId, journeyId)) {
    if (v.failure) continue;
    try {
      await api.visits.create(v.recordingId, v.payload);
      await removeQueuedVisit(userId, v.clientMutationId);
      sent++;
    } catch (err) {
      if (err instanceof NetworkError) return { sent, online: false };
      if (err instanceof ApiError && err.status >= 400 && err.status < 500) {
        await updateQueuedVisit(userId, { ...v, attempts: v.attempts + 1, failure: err.message });
        continue;
      }
      await updateQueuedVisit(userId, { ...v, attempts: v.attempts + 1 });
      return { sent, online: true };
    }
  }
  return { sent, online: true };
}

export async function flushAll(userId: string, journeyId: string, recordingId: string): Promise<FlushResult> {
  const visits = await flushVisits(userId, journeyId);
  const track = await flushTrack(userId, recordingId);
  return { sentPoints: track.sent, sentVisits: visits.sent, online: visits.online && track.online, remaining: await pendingCounts(userId, recordingId, journeyId) };
}

/**
 * Registra una visita. Si no hay red, queda en la cola local con el MISMO clientMutationId,
 * de modo que al reconectar el reintento no duplica nada.
 */
export async function submitVisit(userId: string, journeyId: string, recordingId: string, payload: CreateVisitInput): Promise<{ status: "saved" | "queued" }> {
  try {
    await api.visits.create(recordingId, payload);
    return { status: "saved" };
  } catch (err) {
    if (err instanceof NetworkError) {
      await enqueueVisit(userId, { clientMutationId: payload.clientMutationId, journeyId, recordingId, payload } satisfies Omit<QueuedVisit, "createdAt" | "attempts">);
      return { status: "queued" };
    }
    throw err;
  }
}
