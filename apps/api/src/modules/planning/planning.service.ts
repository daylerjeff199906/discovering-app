import { Inject, Injectable } from "@nestjs/common";
import type { JourneyDto, JourneyPreferences, PlaceSnapshot, ProposalDto, ProposalInput } from "@por-aqui/contracts";
import { journeyDays, journeyLegs, journeys, journeyStops, places, profiles, type Db } from "@por-aqui/database";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { AuthUser } from "../../common/decorators";
import { badRequest, versionConflict } from "../../common/errors";
import { RoutingPort } from "../../infrastructure/geo/providers";
import { DB } from "../../infrastructure/tokens";
import { buildJourneyDto, defaultPreferences } from "../journeys/journey.mapper";
import { JourneysService } from "../journeys/journeys.service";
import { PlacesService, placeSnapshot } from "../places/places.service";
import { planRoute, type Candidate } from "./planner";

@Injectable()
export class PlanningService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly journeys: JourneysService,
    private readonly places: PlacesService,
    private readonly routing: RoutingPort,
  ) {}

  async propose(user: AuthUser, journeyId: string, input: ProposalInput): Promise<ProposalDto> {
    const journey = await this.journeys.assertOwned(this.db, user.id, journeyId);
    if (journey.version !== input.expectedVersion) throw versionConflict(journey.version);

    let center = input.center;
    if (!center) {
      const dest = (await this.places.destinations(input.destinationLabel.split(",")[0]!.trim()))[0];
      center = dest?.center;
    }
    if (!center) {
      return { journeyVersion: journey.version, destinationLabel: input.destinationLabel, days: [], partial: true, warnings: [{ code: "NO_DATA", message: "No conocemos ese destino todavía. Elige otro o arma la ruta manualmente." }], dataSources: [] };
    }
    const rows = await this.db
      .select()
      .from(places)
      .where(and(eq(places.scope, "CATALOG"), sql`ST_DWithin(${places.location}::geography, ST_SetSRID(ST_MakePoint(${center.lng}, ${center.lat}), 4326)::geography, ${input.radiusM})`))
      .limit(80);
    const interestMap = await this.places.interestsFor(rows.map((r) => r.id));
    const candidates: Candidate[] = rows.map((r) => ({ id: r.id, snapshot: placeSnapshot(r), interests: interestMap.get(r.id) ?? [], typicalMinutes: r.typicalVisitMinutes, openingHours: (r.openingHours as Candidate["openingHours"]) ?? null }));

    return planRoute(
      candidates,
      {
        daysCount: input.daysCount,
        minutesPerDay: input.availableMinutesPerDay,
        interests: input.interests,
        pace: input.pace,
        transport: input.transport,
        start: input.start ? { lng: input.start.lng, lat: input.start.lat } : undefined,
        startDate: input.startDate,
      },
      (points, mode) => (this.routing.supports(mode) ? this.routing.matrix(points, mode) : Promise.resolve(null)),
      input.destinationLabel,
      journey.version,
    );
  }

  /** Aplica una propuesta de forma atómica. Si el viaje cambió mientras se calculaba, responde 409 y no pisa nada. */
  async apply(user: AuthUser, journeyId: string, proposal: ProposalDto, expectedVersion: number): Promise<JourneyDto> {
    if (proposal.days.length === 0) throw badRequest("PROPOSAL_EMPTY", "La propuesta no tiene días para aplicar.");
    const result = await this.db.transaction(async (tx) => {
      const version = await this.journeys.bump(tx, user.id, journeyId, expectedVersion);
      const [j] = await tx.select().from(journeys).where(eq(journeys.id, journeyId));
      const prefs = { ...defaultPreferences(), ...((j!.preferencesJson ?? {}) as Partial<JourneyPreferences>) } as JourneyPreferences;
      const [profile] = await tx.select({ tz: profiles.timezone }).from(profiles).where(eq(profiles.userId, user.id));

      // Las paradas se reconstruyen desde la BD: no se confía en los datos de lugar que envía el cliente.
      const placeIds = [...new Set(proposal.days.flatMap((d) => d.stops.map((s) => s.placeId)))];
      const rows = await tx.select().from(places).where(and(inArray(places.id, placeIds), eq(places.scope, "CATALOG")));
      const byId = new Map(rows.map((r) => [r.id, r]));
      if (rows.length !== placeIds.length) throw badRequest("PROPOSAL_INVALID", "La propuesta incluye lugares que no existen.");

      await tx.delete(journeyDays).where(eq(journeyDays.journeyId, journeyId));
      const stopIdByDayPlace = new Map<string, string>();
      for (const [i, day] of proposal.days.entries()) {
        const first = byId.get(day.stops[0]?.placeId ?? "");
        const [d] = await tx
          .insert(journeyDays)
          .values({ journeyId, position: i, localDate: day.localDate, timezone: first?.timezone ?? profile?.tz ?? "UTC", destinationLabel: proposal.destinationLabel })
          .returning({ id: journeyDays.id });
        for (const [pos, s] of day.stops.entries()) {
          const place = byId.get(s.placeId)!;
          const [stop] = await tx
            .insert(journeyStops)
            .values({ journeyId, dayId: d!.id, placeId: place.id, position: pos, visitDurationSeconds: Math.min(86400, Math.max(60, s.visitDurationSeconds)), placeSnapshotJson: placeSnapshot(place) satisfies PlaceSnapshot })
            .returning({ id: journeyStops.id });
          stopIdByDayPlace.set(`${i}:${place.id}`, stop!.id);
        }
        for (const l of day.legs) {
          const from = stopIdByDayPlace.get(`${i}:${l.fromPlaceId}`);
          const to = stopIdByDayPlace.get(`${i}:${l.toPlaceId}`);
          if (!from || !to || from === to) continue;
          await tx.insert(journeyLegs).values({ journeyId, fromStopId: from, toStopId: to, mode: l.mode, durationS: l.durationS, distanceM: l.distanceM, source: l.source, quality: l.quality, calculatedForVersion: version });
        }
      }
      await tx.update(journeys).set({ preferencesJson: { ...prefs, destinationLabel: proposal.destinationLabel } }).where(eq(journeys.id, journeyId));
      const [fresh] = await tx.select().from(journeys).where(eq(journeys.id, journeyId));
      return buildJourneyDto(tx, fresh!);
    });
    return result;
  }
}
