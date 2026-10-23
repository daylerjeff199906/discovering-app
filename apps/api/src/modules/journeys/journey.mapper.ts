import type { DayDto, JourneyDto, JourneyPreferences, JourneyStatus, LegDto, PlaceSnapshot, RecordingDto, StopDto } from "@por-aqui/contracts";
import { journeyDays, journeyLegs, journeys, journeyStops, recordings, visits, type DbExecutor } from "@por-aqui/database";
import { asc, eq, sql } from "drizzle-orm";
import { notFound } from "../../common/errors";

type JourneyRow = typeof journeys.$inferSelect;
type RecordingRow = typeof recordings.$inferSelect;

/** Una sola máquina de estados visible, derivada de plan + ejecución + archivo. */
export function deriveStatus(journey: Pick<JourneyRow, "archivedAt" | "planStatus">, recording: Pick<RecordingRow, "status"> | null): JourneyStatus {
  if (journey.archivedAt) return "ARCHIVED";
  if (recording?.status === "COMPLETED") return "COMPLETED";
  if (recording?.status === "PAUSED") return "PAUSED";
  if (recording?.status === "ACTIVE") return "IN_PROGRESS";
  return journey.planStatus === "READY" ? "PLANNED" : "DRAFT";
}

export function recordingToDto(r: RecordingRow): RecordingDto {
  return {
    id: r.id,
    journeyId: r.journeyId,
    status: r.status as RecordingDto["status"],
    startedAt: r.startedAt.toISOString(),
    pausedAt: r.pausedAt?.toISOString() ?? null,
    endedAt: r.endedAt?.toISOString() ?? null,
    version: r.version,
    trackWatermarks: (r.trackWatermarks ?? {}) as Record<string, number>,
  };
}

export const defaultPreferences = (): JourneyPreferences => ({ interests: [], pace: "MODERATE", transport: "WALK" });

export async function loadJourneyDto(exec: DbExecutor, journeyId: string, ownerId: string): Promise<JourneyDto> {
  const [j] = await exec.select().from(journeys).where(eq(journeys.id, journeyId)).limit(1);
  if (!j || j.ownerId !== ownerId) throw notFound("No encontramos esa aventura.");
  return buildJourneyDto(exec, j);
}

export async function buildJourneyDto(exec: DbExecutor, j: JourneyRow): Promise<JourneyDto> {
  // Secuencial a propósito: dentro de una transacción hay una sola conexión.
  const dayRows = await exec.select().from(journeyDays).where(eq(journeyDays.journeyId, j.id)).orderBy(asc(journeyDays.position));
  const stopRows = await exec.select().from(journeyStops).where(eq(journeyStops.journeyId, j.id)).orderBy(asc(journeyStops.dayId), asc(journeyStops.position));
  const legRows = await exec.select().from(journeyLegs).where(eq(journeyLegs.journeyId, j.id));
  const recRows = await exec.select().from(recordings).where(eq(recordings.journeyId, j.id)).limit(1);
  const visitCount = await exec.select({ n: sql<number>`count(*)::int` }).from(visits).where(eq(visits.journeyId, j.id));
  const prefs = { ...defaultPreferences(), ...((j.preferencesJson ?? {}) as Partial<JourneyPreferences>) } as JourneyPreferences;

  const stopsByDay = new Map<string, StopDto[]>();
  for (const s of stopRows) {
    const dto: StopDto = {
      id: s.id,
      dayId: s.dayId,
      position: s.position,
      placeId: s.placeId,
      visitDurationSeconds: s.visitDurationSeconds,
      place: s.placeSnapshotJson as PlaceSnapshot,
      version: s.version,
    };
    stopsByDay.set(s.dayId, [...(stopsByDay.get(s.dayId) ?? []), dto]);
  }
  const days: DayDto[] = dayRows.map((d) => ({
    id: d.id,
    position: d.position,
    localDate: d.localDate,
    timezone: d.timezone,
    destinationLabel: d.destinationLabel,
    stops: stopsByDay.get(d.id) ?? [],
  }));
  const legs: LegDto[] = legRows.map((l) => ({
    id: l.id,
    fromStopId: l.fromStopId,
    toStopId: l.toStopId,
    mode: l.mode as LegDto["mode"],
    distanceM: l.distanceM,
    durationS: l.durationS,
    source: l.source,
    quality: l.quality as LegDto["quality"],
    stale: l.quality !== "MANUAL" && l.mode !== prefs.transport,
  }));
  const recording = recRows[0] ?? null;
  return {
    id: j.id,
    title: j.title,
    description: j.description,
    creationMode: j.creationMode as JourneyDto["creationMode"],
    planStatus: j.planStatus as JourneyDto["planStatus"],
    status: deriveStatus(j, recording),
    preferences: prefs,
    version: j.version,
    archivedAt: j.archivedAt?.toISOString() ?? null,
    createdAt: j.createdAt.toISOString(),
    updatedAt: j.updatedAt.toISOString(),
    sourcePublicationId: j.sourcePublicationId,
    days,
    legs,
    recording: recording ? recordingToDto(recording) : null,
    visitsCount: visitCount[0]?.n ?? 0,
  };
}
