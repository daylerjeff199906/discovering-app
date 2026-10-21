import { Inject, Injectable } from "@nestjs/common";
import type {
  CreateJourneyInput,
  JourneyDto,
  JourneyPreferences,
  JourneyStatus,
  JourneySummaryDto,
  ReorderInput,
  TransportMode,
  UpdateJourneyInput,
} from "@por-aqui/contracts";
import { journeyDays, journeyLegs, journeys, journeyStops, profiles, publications, recordings, type Db, type DbExecutor } from "@por-aqui/database";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { AuthUser } from "../../common/decorators";
import { badRequest, notFound, versionConflict } from "../../common/errors";
import { RoutingPort } from "../../infrastructure/geo/providers";
import { DB } from "../../infrastructure/tokens";
import { PlacesService, placeSnapshot } from "../places/places.service";
import { buildJourneyDto, defaultPreferences, deriveStatus, loadJourneyDto } from "./journey.mapper";

type JourneyRow = typeof journeys.$inferSelect;

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class JourneysService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly places: PlacesService,
    private readonly routing: RoutingPort,
  ) {}

  /** El viaje debe existir y ser del usuario; si no, 404 (no se revela la existencia de recursos ajenos). */
  async assertOwned(exec: DbExecutor, userId: string, journeyId: string): Promise<JourneyRow> {
    const [row] = await exec.select().from(journeys).where(and(eq(journeys.id, journeyId), eq(journeys.ownerId, userId))).limit(1);
    if (!row) throw notFound("No encontramos ese viaje.");
    return row;
  }

  /**
   * Control optimista de concurrencia. El UPDATE condicionado por versión también toma el bloqueo de fila:
   * las ediciones concurrentes del mismo viaje se serializan y la perdedora recibe 409.
   */
  async bump(tx: DbExecutor, userId: string, journeyId: string, expectedVersion: number): Promise<number> {
    const updated = await tx
      .update(journeys)
      .set({ version: sql`${journeys.version} + 1` })
      .where(and(eq(journeys.id, journeyId), eq(journeys.ownerId, userId), eq(journeys.version, expectedVersion), isNull(journeys.archivedAt)))
      .returning({ version: journeys.version });
    if (updated[0]) return updated[0].version;
    const row = await this.assertOwned(tx, userId, journeyId);
    if (row.archivedAt) throw badRequest("JOURNEY_ARCHIVED", "Este viaje está archivado. Desarchívalo para editarlo.");
    throw versionConflict(row.version);
  }

  /* ───────────── Lectura ───────────── */

  async list(user: AuthUser, opts: { status?: JourneyStatus; includeArchived: boolean }): Promise<JourneySummaryDto[]> {
    const rows = await this.db
      .select({
        j: journeys,
        rec: recordings.status,
        stops: sql<number>`(select count(*)::int from journey_stops s where s.journey_id = ${journeys.id})`,
        visits: sql<number>`(select count(*)::int from visits v where v.journey_id = ${journeys.id})`,
        pubSlug: publications.slug,
        pubVis: publications.visibility,
      })
      .from(journeys)
      .leftJoin(recordings, eq(recordings.journeyId, journeys.id))
      .leftJoin(publications, eq(publications.journeyId, journeys.id))
      .where(and(eq(journeys.ownerId, user.id), opts.includeArchived ? undefined : isNull(journeys.archivedAt)))
      .orderBy(desc(journeys.updatedAt));
    const out = rows.map<JourneySummaryDto>((r) => ({
      id: r.j.id,
      title: r.j.title,
      status: deriveStatus(r.j, r.rec ? { status: r.rec } : null),
      creationMode: r.j.creationMode as JourneySummaryDto["creationMode"],
      destinationLabel: ((r.j.preferencesJson ?? {}) as Partial<JourneyPreferences>).destinationLabel ?? null,
      stopsCount: r.stops,
      visitsCount: r.visits,
      updatedAt: r.j.updatedAt.toISOString(),
      publicationSlug: r.pubVis && r.pubVis !== "PRIVATE" ? r.pubSlug : null,
      publicationVisibility: (r.pubVis as JourneySummaryDto["publicationVisibility"]) ?? null,
    }));
    return opts.status ? out.filter((o) => o.status === opts.status) : out;
  }

  get(user: AuthUser, id: string): Promise<JourneyDto> {
    return loadJourneyDto(this.db, id, user.id);
  }

  /* ───────────── Escritura del viaje ───────────── */

  async create(user: AuthUser, input: CreateJourneyInput): Promise<JourneyDto> {
    const [profile] = await this.db.select({ tz: profiles.timezone }).from(profiles).where(eq(profiles.userId, user.id));
    const timezone = input.timezone ?? profile?.tz ?? "UTC";
    const preferences: JourneyPreferences = { ...defaultPreferences(), ...(input.preferences ?? {}) };
    const daysCount = input.creationMode === "FREE" ? 0 : Math.max(1, input.daysCount ?? 1);

    const id = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(journeys)
        .values({ ownerId: user.id, title: input.title, description: input.description ?? null, creationMode: input.creationMode, preferencesJson: preferences })
        .returning({ id: journeys.id });
      for (let i = 0; i < daysCount; i++) {
        await tx.insert(journeyDays).values({
          journeyId: row!.id,
          position: i,
          timezone,
          localDate: preferences.startDate ? addDays(preferences.startDate, i) : null,
          destinationLabel: preferences.destinationLabel ?? null,
        });
      }
      return row!.id;
    });
    return this.get(user, id);
  }

  async update(user: AuthUser, id: string, input: UpdateJourneyInput): Promise<JourneyDto> {
    await this.db.transaction(async (tx) => {
      await this.bump(tx, user.id, id, input.expectedVersion);
      const patch: Partial<typeof journeys.$inferInsert> = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.description !== undefined) patch.description = input.description;
      if (input.planStatus !== undefined) patch.planStatus = input.planStatus;
      if (input.preferences !== undefined) patch.preferencesJson = input.preferences;
      if (Object.keys(patch).length) await tx.update(journeys).set(patch).where(eq(journeys.id, id));
    });
    return this.get(user, id);
  }

  async setArchived(user: AuthUser, id: string, archived: boolean): Promise<JourneyDto> {
    await this.assertOwned(this.db, user.id, id);
    await this.db
      .update(journeys)
      .set({ archivedAt: archived ? new Date() : null, version: sql`${journeys.version} + 1` })
      .where(and(eq(journeys.id, id), eq(journeys.ownerId, user.id)));
    return this.get(user, id);
  }

  async duplicate(user: AuthUser, id: string): Promise<JourneyDto> {
    const src = await this.get(user, id);
    const newId = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(journeys)
        .values({ ownerId: user.id, title: `${src.title} (copia)`, description: src.description, creationMode: src.creationMode === "FREE" ? "MANUAL" : src.creationMode, preferencesJson: src.preferences })
        .returning({ id: journeys.id });
      for (const d of src.days) {
        const [day] = await tx
          .insert(journeyDays)
          .values({ journeyId: row!.id, position: d.position, timezone: d.timezone, localDate: d.localDate, destinationLabel: d.destinationLabel })
          .returning({ id: journeyDays.id });
        for (const s of d.stops) {
          await tx.insert(journeyStops).values({ journeyId: row!.id, dayId: day!.id, placeId: s.placeId, position: s.position, visitDurationSeconds: s.visitDurationSeconds, placeSnapshotJson: s.place });
        }
      }
      return row!.id;
    });
    return this.get(user, newId);
  }

  /* ───────────── Días ───────────── */

  async addDay(user: AuthUser, id: string, input: { localDate?: string | null; timezone?: string; destinationLabel?: string | null; expectedVersion: number }): Promise<JourneyDto> {
    await this.db.transaction(async (tx) => {
      await this.bump(tx, user.id, id, input.expectedVersion);
      const existing = await tx.select().from(journeyDays).where(eq(journeyDays.journeyId, id)).orderBy(asc(journeyDays.position));
      const last = existing[existing.length - 1];
      const [profile] = await tx.select({ tz: profiles.timezone }).from(profiles).where(eq(profiles.userId, user.id));
      await tx.insert(journeyDays).values({
        journeyId: id,
        position: existing.length,
        timezone: input.timezone ?? last?.timezone ?? profile?.tz ?? "UTC",
        localDate: input.localDate !== undefined ? input.localDate : last?.localDate ? addDays(last.localDate, 1) : null,
        destinationLabel: input.destinationLabel ?? last?.destinationLabel ?? null,
      });
    });
    return this.get(user, id);
  }

  async updateDay(user: AuthUser, id: string, dayId: string, input: { localDate?: string | null; timezone?: string; destinationLabel?: string | null; expectedVersion: number }): Promise<JourneyDto> {
    await this.db.transaction(async (tx) => {
      await this.bump(tx, user.id, id, input.expectedVersion);
      const patch: Partial<typeof journeyDays.$inferInsert> = {};
      if (input.localDate !== undefined) patch.localDate = input.localDate;
      if (input.timezone !== undefined) patch.timezone = input.timezone;
      if (input.destinationLabel !== undefined) patch.destinationLabel = input.destinationLabel;
      if (Object.keys(patch).length === 0) return;
      const r = await tx.update(journeyDays).set(patch).where(and(eq(journeyDays.id, dayId), eq(journeyDays.journeyId, id))).returning({ id: journeyDays.id });
      if (r.length === 0) throw notFound("No encontramos ese día.");
    });
    return this.get(user, id);
  }

  async deleteDay(user: AuthUser, id: string, dayId: string, expectedVersion: number): Promise<JourneyDto> {
    await this.db.transaction(async (tx) => {
      await this.bump(tx, user.id, id, expectedVersion);
      const r = await tx.delete(journeyDays).where(and(eq(journeyDays.id, dayId), eq(journeyDays.journeyId, id))).returning({ id: journeyDays.id });
      if (r.length === 0) throw notFound("No encontramos ese día.");
      await this.compactDays(tx, id);
    });
    return this.get(user, id);
  }

  private async compactDays(tx: DbExecutor, journeyId: string) {
    await tx.execute(sql`
      UPDATE journey_days d SET position = r.rn - 1
      FROM (SELECT id, row_number() OVER (ORDER BY position) AS rn FROM journey_days WHERE journey_id = ${journeyId}) r
      WHERE d.id = r.id`);
  }

  private async compactStops(tx: DbExecutor, dayId: string) {
    await tx.execute(sql`
      UPDATE journey_stops s SET position = r.rn - 1
      FROM (SELECT id, row_number() OVER (ORDER BY position) AS rn FROM journey_stops WHERE day_id = ${dayId}) r
      WHERE s.id = r.id`);
  }

  /* ───────────── Paradas ───────────── */

  async addStop(user: AuthUser, id: string, input: { dayId: string; placeId: string; visitDurationSeconds?: number | null; expectedVersion: number }): Promise<JourneyDto> {
    await this.db.transaction(async (tx) => {
      await this.bump(tx, user.id, id, input.expectedVersion);
      const [day] = await tx.select().from(journeyDays).where(and(eq(journeyDays.id, input.dayId), eq(journeyDays.journeyId, id))).limit(1);
      if (!day) throw notFound("No encontramos ese día.");
      const place = await this.places.getAccessible(user, input.placeId, tx);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(journeyStops).where(eq(journeyStops.dayId, input.dayId))) as [{ n: number }];
      await tx.insert(journeyStops).values({
        journeyId: id,
        dayId: input.dayId,
        placeId: place.id,
        position: n,
        visitDurationSeconds: input.visitDurationSeconds ?? null,
        placeSnapshotJson: placeSnapshot(place),
      });
    });
    return this.get(user, id);
  }

  async updateStop(user: AuthUser, id: string, stopId: string, input: { visitDurationSeconds?: number | null; expectedVersion: number }): Promise<JourneyDto> {
    await this.db.transaction(async (tx) => {
      await this.bump(tx, user.id, id, input.expectedVersion);
      if (input.visitDurationSeconds === undefined) return;
      const r = await tx
        .update(journeyStops)
        .set({ visitDurationSeconds: input.visitDurationSeconds, version: sql`${journeyStops.version} + 1` })
        .where(and(eq(journeyStops.id, stopId), eq(journeyStops.journeyId, id)))
        .returning({ id: journeyStops.id });
      if (r.length === 0) throw notFound("No encontramos esa parada.");
    });
    return this.get(user, id);
  }

  /** Quitar una parada conserva las visitas ya registradas (la FK anula solo stop_id). */
  async deleteStop(user: AuthUser, id: string, stopId: string, expectedVersion: number): Promise<JourneyDto> {
    await this.db.transaction(async (tx) => {
      await this.bump(tx, user.id, id, expectedVersion);
      const r = await tx.delete(journeyStops).where(and(eq(journeyStops.id, stopId), eq(journeyStops.journeyId, id))).returning({ dayId: journeyStops.dayId });
      if (r.length === 0) throw notFound("No encontramos esa parada.");
      await this.compactStops(tx, r[0]!.dayId);
    });
    return this.get(user, id);
  }

  /**
   * Reordena el plan completo (también entre días). Recibe la lista COMPLETA de IDs, comprueba que no
   * falte ni sobre ninguno y reindexa en una transacción; las posiciones únicas son DEFERRABLE.
   */
  async reorder(user: AuthUser, id: string, input: ReorderInput): Promise<JourneyDto> {
    await this.db.transaction(async (tx) => {
      await this.bump(tx, user.id, id, input.expectedVersion);
      const days = await tx.select({ id: journeyDays.id }).from(journeyDays).where(eq(journeyDays.journeyId, id));
      const stops = await tx.select({ id: journeyStops.id }).from(journeyStops).where(eq(journeyStops.journeyId, id));
      const dayIds = new Set(days.map((d) => d.id));
      const stopIds = new Set(stops.map((s) => s.id));
      const seenDays = new Set<string>();
      const seenStops = new Set<string>();
      for (const entry of input.layout) {
        if (!dayIds.has(entry.dayId) || seenDays.has(entry.dayId)) throw badRequest("REORDER_INVALID", "El orden incluye días repetidos o ajenos al viaje.");
        seenDays.add(entry.dayId);
        for (const sid of entry.stopIds) {
          if (!stopIds.has(sid) || seenStops.has(sid)) throw badRequest("REORDER_INVALID", "El orden incluye paradas repetidas o ajenas al viaje.");
          seenStops.add(sid);
        }
      }
      if (seenDays.size !== dayIds.size || seenStops.size !== stopIds.size) throw badRequest("REORDER_INVALID", "El orden debe incluir todos los días y todas las paradas.");

      const tuples: ReturnType<typeof sql>[] = [];
      const adjacent = new Set<string>();
      for (const entry of input.layout) {
        entry.stopIds.forEach((sid, idx) => {
          tuples.push(sql`(${sid}::uuid, ${entry.dayId}::uuid, ${idx}::int)`);
          const next = entry.stopIds[idx + 1];
          if (next) adjacent.add(`${sid}>${next}`);
        });
      }
      if (tuples.length) {
        await tx.execute(sql`
          UPDATE journey_stops s SET day_id = v.day_id, position = v.pos, version = s.version + 1
          FROM (VALUES ${sql.join(tuples, sql`, `)}) AS v(id, day_id, pos)
          WHERE s.id = v.id AND s.journey_id = ${id}`);
      }
      // Los tramos calculados dejan de valer si ya no son consecutivos; los manuales (p. ej. barco) se conservan.
      const legs = await tx.select().from(journeyLegs).where(eq(journeyLegs.journeyId, id));
      const drop = legs.filter((l) => l.quality !== "MANUAL" && !adjacent.has(`${l.fromStopId}>${l.toStopId}`)).map((l) => l.id);
      if (drop.length) await tx.delete(journeyLegs).where(inArray(journeyLegs.id, drop));
    });
    return this.get(user, id);
  }

  /* ───────────── Tramos ───────────── */

  async setManualLeg(user: AuthUser, id: string, input: { fromStopId: string; toStopId: string; mode: TransportMode; durationS: number | null; expectedVersion: number }): Promise<JourneyDto> {
    if (input.fromStopId === input.toStopId) throw badRequest("LEG_INVALID", "El tramo necesita dos paradas distintas.");
    await this.db.transaction(async (tx) => {
      const version = await this.bump(tx, user.id, id, input.expectedVersion);
      const found = await tx.select({ id: journeyStops.id }).from(journeyStops).where(and(eq(journeyStops.journeyId, id), inArray(journeyStops.id, [input.fromStopId, input.toStopId])));
      if (found.length !== 2) throw notFound("No encontramos esas paradas.");
      await tx
        .insert(journeyLegs)
        .values({ journeyId: id, fromStopId: input.fromStopId, toStopId: input.toStopId, mode: input.mode, durationS: input.durationS, distanceM: null, source: "user", quality: "MANUAL", calculatedForVersion: version })
        .onConflictDoUpdate({ target: [journeyLegs.fromStopId, journeyLegs.toStopId], set: { mode: input.mode, durationS: input.durationS, source: "user", quality: "MANUAL", calculatedForVersion: version } });
    });
    return this.get(user, id);
  }

  /**
   * Recalcula los tramos consecutivos de cada día con el proveedor configurado. Se hace fuera de la transacción
   * (puede tardar) y solo se aplica si el viaje no cambió mientras tanto: nunca sobrescribe ediciones.
   */
  async recalculateLegs(user: AuthUser, id: string): Promise<{ applied: boolean; reason: "OK" | "NO_PROVIDER" | "MODE_UNSUPPORTED" | "STALE"; computed: number; journey: JourneyDto }> {
    const before = await this.get(user, id);
    const mode = before.preferences.transport;
    const done = (applied: boolean, reason: "OK" | "NO_PROVIDER" | "MODE_UNSUPPORTED" | "STALE", computed = 0, journey = before) => ({ applied, reason, computed, journey });
    if (!this.routing.available) return done(false, "NO_PROVIDER");
    if (!this.routing.supports(mode)) return done(false, "MODE_UNSUPPORTED");

    const computed: { from: string; to: string; durationS: number | null; distanceM: number | null; source: string; quality: "PROVIDER" | "ESTIMATED" }[] = [];
    for (const day of before.days) {
      if (day.stops.length < 2) continue;
      const matrix = await this.routing.matrix(day.stops.map((s) => ({ lng: s.place.lng, lat: s.place.lat })), mode);
      if (!matrix) continue;
      for (let i = 0; i < day.stops.length - 1; i++) {
        computed.push({ from: day.stops[i]!.id, to: day.stops[i + 1]!.id, durationS: matrix.durations[i]?.[i + 1] ?? null, distanceM: matrix.distances[i]?.[i + 1] ?? null, source: matrix.source, quality: matrix.quality });
      }
    }

    return this.db.transaction(async (tx) => {
      const [locked] = await tx.select().from(journeys).where(and(eq(journeys.id, id), eq(journeys.ownerId, user.id))).for("update");
      if (!locked || locked.version !== before.version) return done(false, "STALE");
      for (const c of computed) {
        const [existing] = await tx.select({ q: journeyLegs.quality }).from(journeyLegs).where(and(eq(journeyLegs.fromStopId, c.from), eq(journeyLegs.toStopId, c.to)));
        if (existing?.q === "MANUAL") continue; // no pisar lo que el usuario fijó a mano
        await tx
          .insert(journeyLegs)
          .values({ journeyId: id, fromStopId: c.from, toStopId: c.to, mode, durationS: c.durationS, distanceM: c.distanceM, source: c.source, quality: c.quality, calculatedForVersion: before.version })
          .onConflictDoUpdate({ target: [journeyLegs.fromStopId, journeyLegs.toStopId], set: { mode, durationS: c.durationS, distanceM: c.distanceM, source: c.source, quality: c.quality, calculatedForVersion: before.version } });
      }
      const fresh = await buildJourneyDto(tx, locked);
      return done(true, "OK", computed.length, fresh);
    });
  }
}

