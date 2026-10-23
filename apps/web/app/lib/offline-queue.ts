import type { CreateVisitInput, TrackBatchInput } from "@por-aqui/contracts";
import { openDB, deleteDB, type DBSchema, type IDBPDatabase } from "idb";

/**
 * Cola local en IndexedDB para visitas y puntos GPS aún no sincronizados.
 * - Una base por usuario (`poraqui-<userId>`); se borra al cerrar sesión.
 * - Nunca guarda archivos binarios ni credenciales.
 * - Acotada: al llenarse se avisa y se deja de capturar; no se descarta nada en silencio.
 */
export const DB_VERSION = 1;
export const MAX_QUEUED_POINTS = 20_000;
export const MAX_QUEUED_VISITS = 500;

export interface QueuedVisit {
  clientMutationId: string;
  journeyId: string;
  recordingId: string;
  payload: CreateVisitInput;
  createdAt: number;
  attempts: number;
  /** Error permanente (4xx): se conserva visible para que la persona decida. */
  failure?: string;
}

export interface QueuedPoint {
  recordingId: string;
  segmentClientId: string;
  segmentStartedAt: string;
  seq: number;
  recordedAt: string;
  lng: number;
  lat: number;
  accuracyM: number | null;
}

interface Schema extends DBSchema {
  visits: { key: string; value: QueuedVisit; indexes: { byJourney: string } };
  points: { key: [string, string, number]; value: QueuedPoint; indexes: { byRecording: string } };
  segments: { key: [string, string]; value: { recordingId: string; segmentClientId: string; startedAt: string; lastSeq: number } };
}

export class QueueFullError extends Error {
  constructor(readonly kind: "points" | "visits") {
    super(kind === "points" ? "La cola local de puntos GPS está llena. Conéctate para sincronizar." : "Hay demasiadas visitas pendientes. Conéctate para sincronizar.");
    this.name = "QueueFullError";
  }
}

const dbName = (userId: string) => `poraqui-${userId}`;
const handles = new Map<string, Promise<IDBPDatabase<Schema>>>();

function db(userId: string): Promise<IDBPDatabase<Schema>> {
  let h = handles.get(userId);
  if (!h) {
    h = openDB<Schema>(dbName(userId), DB_VERSION, {
      // Migraciones por versión: añadir `case n:` al subir DB_VERSION.
      upgrade(d, oldVersion) {
        if (oldVersion < 1) {
          const v = d.createObjectStore("visits", { keyPath: "clientMutationId" });
          v.createIndex("byJourney", "journeyId");
          const p = d.createObjectStore("points", { keyPath: ["recordingId", "segmentClientId", "seq"] });
          p.createIndex("byRecording", "recordingId");
          d.createObjectStore("segments", { keyPath: ["recordingId", "segmentClientId"] });
        }
      },
    });
    handles.set(userId, h);
  }
  return h;
}

/* ───────────── Visitas ───────────── */

export async function enqueueVisit(userId: string, v: Omit<QueuedVisit, "createdAt" | "attempts">): Promise<void> {
  const d = await db(userId);
  if ((await d.count("visits")) >= MAX_QUEUED_VISITS) throw new QueueFullError("visits");
  await d.put("visits", { ...v, createdAt: Date.now(), attempts: 0 });
}
export async function listQueuedVisits(userId: string, journeyId: string): Promise<QueuedVisit[]> {
  return (await (await db(userId)).getAllFromIndex("visits", "byJourney", journeyId)).sort((a, b) => a.createdAt - b.createdAt);
}
export async function updateQueuedVisit(userId: string, v: QueuedVisit): Promise<void> {
  await (await db(userId)).put("visits", v);
}
export async function removeQueuedVisit(userId: string, clientMutationId: string): Promise<void> {
  await (await db(userId)).delete("visits", clientMutationId);
}

/* ───────────── Puntos de trayecto ───────────── */

export async function openSegment(userId: string, recordingId: string, segmentClientId: string, startedAt: string): Promise<void> {
  await (await db(userId)).put("segments", { recordingId, segmentClientId, startedAt, lastSeq: -1 });
}

/** Asigna secuencia consecutiva dentro del segmento y encola el punto (transacción única). */
export async function enqueuePoint(userId: string, p: Omit<QueuedPoint, "seq">): Promise<number> {
  const d = await db(userId);
  const tx = d.transaction(["points", "segments"], "readwrite");
  const seg = await tx.objectStore("segments").get([p.recordingId, p.segmentClientId]);
  if (!seg) throw new Error("Segmento no abierto");
  if ((await tx.objectStore("points").index("byRecording").count(p.recordingId)) >= MAX_QUEUED_POINTS) throw new QueueFullError("points");
  const seq = seg.lastSeq + 1;
  await tx.objectStore("points").put({ ...p, seq });
  await tx.objectStore("segments").put({ ...seg, lastSeq: seq });
  await tx.done;
  return seq;
}

export async function takePendingBatches(userId: string, recordingId: string, maxPerBatch = 200): Promise<(TrackBatchInput & { lastSeq: number })[]> {
  const d = await db(userId);
  const pts = (await d.getAllFromIndex("points", "byRecording", recordingId)).sort((a, b) => (a.segmentClientId === b.segmentClientId ? a.seq - b.seq : a.segmentClientId.localeCompare(b.segmentClientId)));
  const bySeg = new Map<string, QueuedPoint[]>();
  for (const p of pts) bySeg.set(p.segmentClientId, [...(bySeg.get(p.segmentClientId) ?? []), p]);
  const batches: (TrackBatchInput & { lastSeq: number })[] = [];
  for (const [segmentClientId, list] of bySeg) {
    const slice = list.slice(0, maxPerBatch);
    batches.push({ segmentClientId, startedAt: slice[0]!.segmentStartedAt, lastSeq: slice[slice.length - 1]!.seq, points: slice.map((p) => ({ seq: p.seq, recordedAt: p.recordedAt, lng: p.lng, lat: p.lat, accuracyM: p.accuracyM })) });
  }
  return batches;
}

export async function removePointsUpTo(userId: string, recordingId: string, segmentClientId: string, lastSeq: number): Promise<void> {
  const d = await db(userId);
  await d.delete("points", IDBKeyRange.bound([recordingId, segmentClientId, 0], [recordingId, segmentClientId, lastSeq]));
}

export async function pendingCounts(userId: string, recordingId: string, journeyId: string): Promise<{ points: number; visits: number; failedVisits: number }> {
  const d = await db(userId);
  const visits = await d.getAllFromIndex("visits", "byJourney", journeyId);
  return { points: await d.countFromIndex("points", "byRecording", recordingId), visits: visits.filter((v) => !v.failure).length, failedVisits: visits.filter((v) => v.failure).length };
}

/** Última secuencia generada por segmento: es el «watermark» que el cliente declara al finalizar. */
export async function segmentWatermarks(userId: string, recordingId: string): Promise<Record<string, number>> {
  const all = await (await db(userId)).getAll("segments");
  return Object.fromEntries(all.filter((s) => s.recordingId === recordingId && s.lastSeq >= 0).map((s) => [s.segmentClientId, s.lastSeq]));
}

export async function discardPending(userId: string, recordingId: string, journeyId: string): Promise<void> {
  const d = await db(userId);
  for (const k of await d.getAllKeysFromIndex("points", "byRecording", recordingId)) await d.delete("points", k);
  for (const v of await d.getAllFromIndex("visits", "byJourney", journeyId)) await d.delete("visits", v.clientMutationId);
}

/** Retira también los segmentos locales cuando se elimina definitivamente una aventura. */
export async function discardJourneyData(userId: string, journeyId: string, recordingId?: string): Promise<void> {
  const d = await db(userId);
  for (const v of await d.getAllFromIndex("visits", "byJourney", journeyId)) await d.delete("visits", v.clientMutationId);
  if (!recordingId) return;
  for (const k of await d.getAllKeysFromIndex("points", "byRecording", recordingId)) await d.delete("points", k);
  for (const segment of await d.getAll("segments")) {
    if (segment.recordingId === recordingId) await d.delete("segments", [recordingId, segment.segmentClientId]);
  }
}

/** Al cerrar sesión se elimina la base local del usuario. */
export async function clearLocalData(userId: string): Promise<void> {
  const h = handles.get(userId);
  if (h) (await h).close();
  handles.delete(userId);
  await deleteDB(dbName(userId));
}

export async function hasPendingData(userId: string): Promise<boolean> {
  try {
    const d = await db(userId);
    return (await d.count("points")) + (await d.count("visits")) > 0;
  } catch {
    return false;
  }
}
