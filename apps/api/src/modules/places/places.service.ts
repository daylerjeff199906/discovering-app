import { Inject, Injectable } from "@nestjs/common";
import type { CreatePlaceInput, GeocodeResult, PlaceDto, PlaceSearchQuery, PlaceSnapshot } from "@por-aqui/contracts";
import { interests, placeInterests, places, type Db, type DbExecutor } from "@por-aqui/database";
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import type { AuthUser } from "../../common/decorators";
import { notFound } from "../../common/errors";
import { GeocoderPort } from "../../infrastructure/geo/providers";
import { DB } from "../../infrastructure/tokens";

export type PlaceRow = typeof places.$inferSelect;

export function placeSnapshot(row: PlaceRow): PlaceSnapshot {
  return {
    name: row.name,
    description: row.description,
    lng: row.location.lng,
    lat: row.location.lat,
    locality: row.locality,
    region: row.region,
    countryCode: row.countryCode,
    address: row.address,
    scope: row.scope as PlaceSnapshot["scope"],
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);
const enabledCatalogPlace = sql`NOT EXISTS (SELECT 1 FROM catalog_content cc, jsonb_array_elements(cc.data->'places') p WHERE cc.key = 'travel' AND p->>'id' = ${places.id}::text AND (p->>'enabled' = 'false' OR EXISTS (SELECT 1 FROM jsonb_array_elements(cc.data->'cities') c WHERE c->>'id' = p->>'cityId' AND c->>'enabled' = 'false')))`;

/** Condición de acceso: catálogo o lugar personal propio. */
export const accessiblePlace = (userId: string): SQL => or(eq(places.scope, "CATALOG"), and(eq(places.scope, "PERSONAL"), eq(places.ownerId, userId)))!;

@Injectable()
export class PlacesService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly geocoder: GeocoderPort,
  ) {}

  async interestsFor(ids: string[], exec: DbExecutor = this.db): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (ids.length === 0) return map;
    const rows = await exec
      .select({ placeId: placeInterests.placeId, slug: interests.slug })
      .from(placeInterests)
      .innerJoin(interests, eq(interests.id, placeInterests.interestId))
      .where(inArray(placeInterests.placeId, ids));
    for (const r of rows) map.set(r.placeId, [...(map.get(r.placeId) ?? []), r.slug]);
    return map;
  }

  toDto(row: PlaceRow, interestSlugs: string[], distanceM: number | null = null): PlaceDto {
    return {
      ...placeSnapshot(row),
      id: row.id,
      interests: interestSlugs,
      typicalVisitMinutes: row.typicalVisitMinutes,
      timezone: row.timezone,
      openingHours: (row.openingHours as PlaceDto["openingHours"]) ?? null,
      provider: row.provider,
      verifiedAt: row.verifiedAt?.toISOString() ?? null,
      distanceM,
    };
  }

  async search(user: AuthUser | undefined, q: PlaceSearchQuery): Promise<PlaceDto[]> {
    const conds: SQL[] = [];
    conds.push(enabledCatalogPlace);
    if (q.scope === "catalog" || !user) conds.push(eq(places.scope, "CATALOG"));
    else if (q.scope === "mine") conds.push(and(eq(places.scope, "PERSONAL"), eq(places.ownerId, user.id))!);
    else conds.push(accessiblePlace(user.id));

    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      conds.push(
        sql`(unaccent(${places.name}) ILIKE unaccent(${like}) OR unaccent(coalesce(${places.locality}, '')) ILIKE unaccent(${like}) OR unaccent(coalesce(${places.description}, '')) ILIKE unaccent(${like}))`,
      );
    }
    if (q.countryCode) conds.push(eq(places.countryCode, q.countryCode.toUpperCase()));
    if (q.locality) conds.push(sql`unaccent(${places.locality}) ILIKE unaccent(${escapeLike(q.locality)})`);
    if (q.interest) {
      conds.push(
        sql`EXISTS (SELECT 1 FROM place_interests pi JOIN interests i ON i.id = pi.interest_id WHERE pi.place_id = ${places.id} AND i.slug = ${q.interest})`,
      );
    }
    const hasNear = q.lng !== undefined && q.lat !== undefined;
    const point = hasNear ? sql`ST_SetSRID(ST_MakePoint(${q.lng!}, ${q.lat!}), 4326)::geography` : null;
    // Radio en METROS: geography con índice GiST funcional (places_location_geography_gist).
    if (point) conds.push(sql`ST_DWithin(${places.location}::geography, ${point}, ${q.radiusM ?? 20000})`);

    const distance = point ? sql<number>`ST_Distance(${places.location}::geography, ${point})` : sql<number | null>`NULL`;
    const rows = await this.db
      .select({ p: places, d: distance })
      .from(places)
      .where(and(...conds))
      .orderBy(point ? sql`${distance} asc` : sql`${places.name} asc`)
      .limit(q.limit);

    const map = await this.interestsFor(rows.map((r) => r.p.id));
    return rows.map((r) => this.toDto(r.p, map.get(r.p.id) ?? [], r.d == null ? null : Math.round(Number(r.d))));
  }

  async destinations(q: string | undefined) {
    const like = q ? `%${escapeLike(q)}%` : null;
    const rows = await this.db.execute<{ locality: string; region: string | null; country_code: string | null; count: string; lng: number; lat: number }>(sql`
      SELECT locality, region, country_code, count(*)::text AS count,
             avg(ST_X(location)) AS lng, avg(ST_Y(location)) AS lat
      FROM places
      WHERE scope = 'CATALOG' AND locality IS NOT NULL
        AND ${enabledCatalogPlace}
        ${like ? sql`AND unaccent(locality) ILIKE unaccent(${like})` : sql``}
      GROUP BY locality, region, country_code
      ORDER BY count(*) DESC, locality
      LIMIT 20`);
    return rows.rows.map((r) => ({
      label: [r.locality, r.region, r.country_code].filter(Boolean).join(", "),
      locality: r.locality,
      region: r.region,
      countryCode: r.country_code,
      placesCount: Number(r.count),
      center: { lng: Number(r.lng), lat: Number(r.lat) },
    }));
  }

  async getAccessible(user: AuthUser | undefined, id: string, exec: DbExecutor = this.db): Promise<PlaceRow> {
    const cond = user ? accessiblePlace(user.id) : eq(places.scope, "CATALOG");
    const [row] = await exec.select().from(places).where(and(eq(places.id, id), cond)).limit(1);
    if (!row) throw notFound("Ese lugar no existe o no es accesible.");
    return row;
  }

  async getDto(user: AuthUser | undefined, id: string): Promise<PlaceDto> {
    const row = await this.getAccessible(user, id);
    const map = await this.interestsFor([row.id]);
    return this.toDto(row, map.get(row.id) ?? []);
  }

  /** Los lugares personales son privados por defecto y no aparecen en búsquedas ajenas. */
  async createPersonal(
    user: AuthUser,
    input: Pick<CreatePlaceInput, "name" | "lng" | "lat"> & Partial<CreatePlaceInput>,
    exec: DbExecutor = this.db,
  ): Promise<PlaceRow> {
    const [row] = await exec
      .insert(places)
      .values({
        scope: "PERSONAL",
        ownerId: user.id,
        name: input.name,
        description: input.description ?? null,
        countryCode: input.countryCode ?? null,
        region: input.region ?? null,
        locality: input.locality ?? null,
        address: input.address ?? null,
        timezone: input.timezone ?? null,
        location: { lng: input.lng, lat: input.lat },
      })
      .returning();
    return row!;
  }

  async geocode(q: string): Promise<GeocodeResult> {
    if (this.geocoder.name === null) return { available: false, provider: null, results: [] };
    return { available: true, provider: this.geocoder.name, results: await this.geocoder.search(q) };
  }
}
