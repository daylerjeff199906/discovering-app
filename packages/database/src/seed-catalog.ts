import { eq, sql } from "drizzle-orm";
import type { createDb } from "./index";
import * as s from "./schema";
import { INTERESTS, PLACES } from "./seed-data";

/** Intereses y catálogo de lugares de DEMOSTRACIÓN (idempotente). */
export async function seedCatalog(db: ReturnType<typeof createDb>): Promise<void> {
    for (const i of INTERESTS) {
      await db.insert(s.interests).values(i).onConflictDoUpdate({ target: s.interests.slug, set: { labelEs: i.labelEs } });
    }
    const interestRows = await db.select().from(s.interests);
    const interestId = new Map(interestRows.map((r) => [r.slug, r.id]));

    for (const p of PLACES) {
      const [row] = await db
        .insert(s.places)
        .values({
          scope: "CATALOG",
          name: p.name,
          description: `${p.description} (datos de demostración, ubicación aproximada)`,
          countryCode: p.countryCode,
          region: p.region,
          locality: p.locality,
          location: { lng: p.lng, lat: p.lat },
          timezone: p.timezone,
          provider: "demo-seed",
          providerPlaceId: p.key,
          typicalVisitMinutes: p.minutes,
        })
        .onConflictDoUpdate({
          target: [s.places.provider, s.places.providerPlaceId],
          targetWhere: sql`${s.places.providerPlaceId} is not null`,
          set: { name: p.name, description: `${p.description} (datos de demostración, ubicación aproximada)`, location: { lng: p.lng, lat: p.lat }, typicalVisitMinutes: p.minutes },
        })
        .returning({ id: s.places.id });
      await db.delete(s.placeInterests).where(eq(s.placeInterests.placeId, row!.id));
      const links = p.interests.map((slug) => ({ placeId: row!.id, interestId: interestId.get(slug)! }));
      if (links.length) await db.insert(s.placeInterests).values(links);
    }
    console.log(`✔ ${INTERESTS.length} intereses y ${PLACES.length} lugares de demostración`);
}
