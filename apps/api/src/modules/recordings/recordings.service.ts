import { Inject, Injectable } from "@nestjs/common";
import {
  ERROR_CODES,
  type CreateVisitInput,
  type FinishRecordingInput,
  type PlaceSnapshot,
  type RecordingDto,
  type TrackBatchInput,
  type TrackBatchResult,
  type TrackDto,
  type UpdateVisitInput,
  type VisitDto,
} from "@por-aqui/contracts";
import { journeys, places, recordings, trackPoints, trackSegments, visits, type Db, type DbExecutor } from "@por-aqui/database";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AuthUser } from "../../common/decorators";
import { AppError, badRequest, notFound, versionConflict } from "../../common/errors";
import { ENV, type Env } from "../../config/env";
import { DB } from "../../infrastructure/tokens";
import { recordingToDto } from "../journeys/journey.mapper";
import { loadVisitMedia } from "../media/media.mapper";
import { MediaService } from "../media/media.service";
import { PlacesService, placeSnapshot } from "../places/places.service";

type RecordingRow = typeof recordings.$inferSelect;
type VisitRow = typeof visits.$inferSelect;

@Injectable()
export class RecordingsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly places: PlacesService,
    private readonly media: MediaService,
  ) {}

  /* ───────────── Acceso ───────────── */

  private async ownedJourney(exec: DbExecutor, userId: string, journeyId: string) {
    const [j] = await exec.select().from(journeys).where(and(eq(journeys.id, journeyId), eq(journeys.ownerId, userId))).limit(1);
    if (!j) throw notFound("No encontramos ese viaje.");
    return j;
  }

  async ownedRecording(exec: DbExecutor, userId: string, recordingId: string, forUpdate = false) {
    const q = exec
      .select({ rec: recordings, journey: journeys })
      .from(recordings)
      .innerJoin(journeys, eq(journeys.id, recordings.journeyId))
      .where(and(eq(recordings.id, recordingId), eq(journeys.ownerId, userId)))
      .limit(1);
    const [row] = await (forUpdate ? q.for("update", { of: recordings }) : q);
    if (!row) throw notFound("No encontramos esa ejecución.");
    return row;
  }

  /* ───────────── Ciclo de vida ───────────── */

  async get(user: AuthUser, journeyId: string): Promise<RecordingDto | null> {
    await this.ownedJourney(this.db, user.id, journeyId);
    const [rec] = await this.db.select().from(recordings).where(eq(recordings.journeyId, journeyId));
    return rec ? recordingToDto(rec) : null;
  }

  async start(user: AuthUser, journeyId: string): Promise<RecordingDto> {
    const journey = await this.ownedJourney(this.db, user.id, journeyId);
    if (journey.archivedAt) throw badRequest("JOURNEY_ARCHIVED", "Este viaje está archivado.");
    const [existing] = await this.db.select().from(recordings).where(eq(recordings.journeyId, journeyId));
    if (existing) {
      if (existing.status === "COMPLETED") throw new AppError(409, ERROR_CODES.RECORDING_CLOSED, "Este recorrido ya fue finalizado. Duplica el viaje para repetirlo.");
      return recordingToDto(existing); // idempotente
    }
    const [rec] = await this.db
      .insert(recordings)
      .values({ journeyId, status: "ACTIVE", startedAt: new Date() })
      .onConflictDoNothing({ target: recordings.journeyId })
      .returning();
    if (!rec) {
      const [again] = await this.db.select().from(recordings).where(eq(recordings.journeyId, journeyId));
      return recordingToDto(again!);
    }
    return recordingToDto(rec);
  }

  private async closeOpenSegments(tx: DbExecutor, recordingId: string) {
    await tx.update(trackSegments).set({ endedAt: new Date() }).where(and(eq(trackSegments.recordingId, recordingId), isNull(trackSegments.endedAt)));
  }

  async pause(user: AuthUser, journeyId: string): Promise<RecordingDto> {
    return this.transition(user, journeyId, async (tx, rec) => {
      if (rec.status === "PAUSED") return rec;
      await this.closeOpenSegments(tx, rec.id);
      const [u] = await tx.update(recordings).set({ status: "PAUSED", pausedAt: new Date(), version: sql`${recordings.version} + 1` }).where(eq(recordings.id, rec.id)).returning();
      return u!;
    });
  }

  async resume(user: AuthUser, journeyId: string): Promise<RecordingDto> {
    return this.transition(user, journeyId, async (tx, rec) => {
      if (rec.status === "ACTIVE") return rec;
      const [u] = await tx.update(recordings).set({ status: "ACTIVE", pausedAt: null, version: sql`${recordings.version} + 1` }).where(eq(recordings.id, rec.id)).returning();
      return u!;
    });
  }

  private async transition(user: AuthUser, journeyId: string, fn: (tx: DbExecutor, rec: RecordingRow) => Promise<RecordingRow>): Promise<RecordingDto> {
    await this.ownedJourney(this.db, user.id, journeyId);
    return this.db.transaction(async (tx) => {
      const [rec] = await tx.select().from(recordings).where(eq(recordings.journeyId, journeyId)).for("update");
      if (!rec) throw notFound("Este viaje todavía no se inició.");
      if (rec.status === "COMPLETED") throw new AppError(409, ERROR_CODES.RECORDING_CLOSED, "Este recorrido ya fue finalizado.");
      return recordingToDto(await fn(tx, rec));
    });
  }

  /**
   * Finalizar es idempotente. Antes de cerrar se concilia el seguimiento: si el cliente declara puntos que el
   * servidor no recibió, responde 409 con el detalle para que sincronice, o descarte explícitamente lo pendiente.
   */
  async finish(user: AuthUser, journeyId: string, input: FinishRecordingInput): Promise<RecordingDto> {
    await this.ownedJourney(this.db, user.id, journeyId);
    return this.db.transaction(async (tx) => {
      const [rec] = await tx.select().from(recordings).where(eq(recordings.journeyId, journeyId)).for("update");
      if (!rec) throw notFound("Este viaje todavía no se inició.");
      if (rec.status === "COMPLETED") return recordingToDto(rec);

      const server = await this.segmentWatermarks(tx, rec.id);
      const pending: Record<string, { client: number; server: number | null }> = {};
      for (const [segment, clientMax] of Object.entries(input.watermarks)) {
        const s = server[segment];
        if (s === undefined || s < clientMax) pending[segment] = { client: clientMax, server: s ?? null };
      }
      if (Object.keys(pending).length > 0 && !input.discardPending) {
        throw new AppError(409, ERROR_CODES.PENDING_TRACK_DATA, "Quedan puntos del trayecto sin sincronizar. Conéctate para enviarlos o descártalos explícitamente.", undefined, { pending });
      }
      await this.closeOpenSegments(tx, rec.id);
      const [u] = await tx
        .update(recordings)
        .set({ status: "COMPLETED", endedAt: new Date(), pausedAt: null, trackWatermarks: server, version: sql`${recordings.version} + 1` })
        .where(eq(recordings.id, rec.id))
        .returning();
      return recordingToDto(u!);
    });
  }

  private async segmentWatermarks(exec: DbExecutor, recordingId: string): Promise<Record<string, number>> {
    const rows = await exec
      .select({ client: trackSegments.clientSegmentId, max: sql<number>`coalesce(max(${trackPoints.clientSequence}), -1)::int` })
      .from(trackSegments)
      .leftJoin(trackPoints, eq(trackPoints.segmentId, trackSegments.id))
      .where(eq(trackSegments.recordingId, recordingId))
      .groupBy(trackSegments.clientSegmentId);
    return Object.fromEntries(rows.map((r) => [r.client, r.max]));
  }

  /* ───────────── Visitas ───────────── */

  private async toVisitDtos(exec: DbExecutor, rows: VisitRow[]): Promise<VisitDto[]> {
    const media = await loadVisitMedia(exec, rows.map((r) => r.id));
    return rows.map((v) => ({
      id: v.id,
      recordingId: v.recordingId,
      journeyId: v.journeyId,
      stopId: v.stopId,
      placeId: v.placeId,
      place: v.placeSnapshotJson as PlaceSnapshot,
      visitedAt: v.visitedAt.toISOString(),
      endedAt: v.endedAt?.toISOString() ?? null,
      timezone: v.timezone,
      note: v.note,
      media: media.get(v.id) ?? [],
      version: v.version,
      clientMutationId: v.clientMutationId,
    }));
  }

  async createVisit(user: AuthUser, recordingId: string, input: CreateVisitInput): Promise<{ visit: VisitDto; created: boolean }> {
    const { rec, journey } = await this.ownedRecording(this.db, user.id, recordingId);
    if (journey.archivedAt) throw badRequest("JOURNEY_ARCHIVED", "Este viaje está archivado.");
    if (rec.status === "COMPLETED" && !input.retroactive) {
      throw new AppError(409, ERROR_CODES.RECORDING_CLOSED, "El recorrido ya terminó. Para añadir una visita pasada, confírmalo explícitamente.");
    }
    const visitedAt = new Date(input.visitedAt);
    if (visitedAt.getTime() > Date.now() + 86_400_000) throw badRequest("VISIT_IN_FUTURE", "La fecha de la visita no puede estar en el futuro.", { visitedAt: ["Fecha futura"] });

    // Idempotencia: el mismo clientMutationId devuelve la visita ya creada.
    const [dup] = await this.db.select().from(visits).where(and(eq(visits.recordingId, recordingId), eq(visits.clientMutationId, input.clientMutationId)));
    if (dup) return { visit: (await this.toVisitDtos(this.db, [dup]))[0]!, created: false };

    try {
      const row = await this.db.transaction(async (tx) => {
        let place: typeof places.$inferSelect;
        if (input.placeId) place = await this.places.getAccessible(user, input.placeId, tx);
        else place = await this.places.createPersonal(user, input.newPlace!, tx);

        if (input.stopId) {
          const ok = await tx.execute(sql`select 1 from journey_stops where id = ${input.stopId} and journey_id = ${journey.id}`);
          if (ok.rows.length === 0) throw badRequest("STOP_INVALID", "Esa parada no pertenece a este viaje.", { stopId: ["Parada inválida"] });
        }
        const [v] = await tx
          .insert(visits)
          .values({
            recordingId,
            journeyId: journey.id,
            ownerId: user.id,
            stopId: input.stopId ?? null,
            placeId: place.id,
            visitedAt,
            timezone: input.timezone,
            note: input.note ?? null,
            placeSnapshotJson: placeSnapshot(place),
            clientMutationId: input.clientMutationId,
          })
          .returning();
        return v!;
      });
      return { visit: (await this.toVisitDtos(this.db, [row]))[0]!, created: true };
    } catch (err) {
      // Carrera entre dos envíos con el mismo clientMutationId.
      if (JSON.stringify(err, Object.getOwnPropertyNames(err)).includes("visits_idem_uq")) {
        const [again] = await this.db.select().from(visits).where(and(eq(visits.recordingId, recordingId), eq(visits.clientMutationId, input.clientMutationId)));
        if (again) return { visit: (await this.toVisitDtos(this.db, [again]))[0]!, created: false };
      }
      throw err;
    }
  }

  async listVisits(user: AuthUser, recordingId: string): Promise<VisitDto[]> {
    await this.ownedRecording(this.db, user.id, recordingId);
    const rows = await this.db.select().from(visits).where(eq(visits.recordingId, recordingId)).orderBy(asc(visits.visitedAt), asc(visits.id));
    return this.toVisitDtos(this.db, rows);
  }

  async listJourneyVisits(user: AuthUser, journeyId: string): Promise<VisitDto[]> {
    await this.ownedJourney(this.db, user.id, journeyId);
    const rows = await this.db.select().from(visits).where(eq(visits.journeyId, journeyId)).orderBy(asc(visits.visitedAt), asc(visits.id));
    return this.toVisitDtos(this.db, rows);
  }

  private async ownedVisit(exec: DbExecutor, userId: string, visitId: string): Promise<VisitRow> {
    const [v] = await exec.select().from(visits).where(and(eq(visits.id, visitId), eq(visits.ownerId, userId))).limit(1);
    if (!v) throw notFound("No encontramos esa visita.");
    return v;
  }

  async getVisit(user: AuthUser, visitId: string): Promise<VisitDto> {
    return (await this.toVisitDtos(this.db, [await this.ownedVisit(this.db, user.id, visitId)]))[0]!;
  }

  async updateVisit(user: AuthUser, visitId: string, input: UpdateVisitInput): Promise<VisitDto> {
    const current = await this.ownedVisit(this.db, user.id, visitId);
    const patch: Partial<typeof visits.$inferInsert> = {};
    if (input.visitedAt) patch.visitedAt = new Date(input.visitedAt);
    if (input.endedAt !== undefined) patch.endedAt = input.endedAt ? new Date(input.endedAt) : null;
    if (input.timezone) patch.timezone = input.timezone;
    if (input.note !== undefined) patch.note = input.note === "" ? null : input.note;
    const updated = await this.db
      .update(visits)
      .set({ ...patch, version: sql`${visits.version} + 1` })
      .where(and(eq(visits.id, visitId), eq(visits.ownerId, user.id), eq(visits.version, input.expectedVersion)))
      .returning();
    if (!updated[0]) throw versionConflict(current.version);
    return (await this.toVisitDtos(this.db, updated))[0]!;
  }

  async deleteVisit(user: AuthUser, visitId: string): Promise<{ ok: true }> {
    await this.ownedVisit(this.db, user.id, visitId);
    await this.db.transaction(async (tx) => {
      // Si alguna foto está usada en una publicación, se bloquea con una política explícita (409).
      await this.media.deleteVisitAssets(tx, user.id, visitId);
      await tx.delete(visits).where(and(eq(visits.id, visitId), eq(visits.ownerId, user.id)));
    });
    return { ok: true };
  }

  /* ───────────── Trayecto GPS ───────────── */

  async trackBatch(user: AuthUser, recordingId: string, input: TrackBatchInput): Promise<TrackBatchResult> {
    return this.db.transaction(async (tx) => {
      const { rec } = await this.ownedRecording(tx, user.id, recordingId, true);
      const finalWatermarks = rec.trackWatermarks as Record<string, number>;
      const closed = rec.status === "COMPLETED";
      if (closed) {
        // Tras finalizar solo se aceptan reintentos de lotes ya reconocidos (≤ watermark), nunca puntos nuevos.
        const limit = finalWatermarks[input.segmentClientId];
        if (limit === undefined || input.points.some((p) => p.seq > limit)) {
          throw new AppError(409, ERROR_CODES.RECORDING_CLOSED, "El recorrido ya terminó: no se aceptan puntos nuevos.");
        }
      }
      // En pausa se siguen aceptando lotes: son puntos capturados antes de pausar que estaban pendientes de sincronizar.

      let [segment] = await tx.select().from(trackSegments).where(and(eq(trackSegments.recordingId, recordingId), eq(trackSegments.clientSegmentId, input.segmentClientId)));
      if (!segment) {
        [segment] = await tx
          .insert(trackSegments)
          .values({ recordingId, clientSegmentId: input.segmentClientId, startedAt: new Date(input.startedAt) })
          .onConflictDoNothing()
          .returning();
        if (!segment) [segment] = await tx.select().from(trackSegments).where(and(eq(trackSegments.recordingId, recordingId), eq(trackSegments.clientSegmentId, input.segmentClientId)));
      }

      const maxAcc = this.env.TRACK_MAX_ACCURACY_M;
      const horizon = Date.now() + 5 * 60_000;
      const valid = input.points.filter((p) => (p.accuracyM == null || p.accuracyM <= maxAcc) && new Date(p.recordedAt).getTime() <= horizon);
      const rejected = input.points.length - valid.length;

      let accepted = 0;
      if (valid.length) {
        const inserted = await tx
          .insert(trackPoints)
          .values(valid.map((p) => ({ segmentId: segment!.id, clientSequence: p.seq, recordedAt: new Date(p.recordedAt), location: { lng: p.lng, lat: p.lat }, accuracyM: p.accuracyM ?? null })))
          .onConflictDoNothing({ target: [trackPoints.segmentId, trackPoints.clientSequence] })
          .returning({ id: trackPoints.id });
        accepted = inserted.length;
      }
      const [{ max }] = (await tx.select({ max: sql<number>`coalesce(max(${trackPoints.clientSequence}), -1)::int` }).from(trackPoints).where(eq(trackPoints.segmentId, segment!.id))) as [{ max: number }];
      return { accepted, duplicates: valid.length - accepted, rejected, watermark: max };
    });
  }

  async getTrack(user: AuthUser, recordingId: string): Promise<TrackDto> {
    await this.ownedRecording(this.db, user.id, recordingId);
    const segs = await this.db.select().from(trackSegments).where(eq(trackSegments.recordingId, recordingId)).orderBy(asc(trackSegments.startedAt));
    const pts = segs.length
      ? await this.db.select().from(trackPoints).where(inArray(trackPoints.segmentId, segs.map((s) => s.id))).orderBy(asc(trackPoints.segmentId), asc(trackPoints.clientSequence)).limit(50_000)
      : [];
    return {
      segments: segs.map((s) => ({
        id: s.id,
        clientSegmentId: s.clientSegmentId,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
        points: pts.filter((p) => p.segmentId === s.id).map((p) => ({ seq: p.clientSequence, recordedAt: p.recordedAt.toISOString(), lng: p.location.lng, lat: p.location.lat, accuracyM: p.accuracyM })),
      })),
    };
  }
}

