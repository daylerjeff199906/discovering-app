import { and, eq, sql } from "drizzle-orm";
import { Pool } from "pg";
import { createDb } from "../index";
import { loadIquitosData, type IquitosPlace } from "../iquitos-places";
import * as s from "../schema";
import { databaseUrl } from "./env";

/**
 * Carga en el catálogo los lugares reales de `data/iquitos-places.json` (idempotente).
 *
 *   pnpm db:seed:iquitos [--dry-run] [--keep-demo]
 *
 * - `places`: upsert por (provider, provider_place_id) = ("iquitos-catalog", clave del JSON).
 * - `place_interests`: se reemplazan los intereses de esos lugares.
 * - `catalog_content` ("travel"): upsert por id de lugar con imagen, categoría y atribución (imageCredit).
 *   Conserva `enabled` si el lugar ya estaba en el catálogo y oculta los lugares de demostración
 *   que sustituyen (salvo `--keep-demo`). Sube la revisión solo si algo cambió.
 *
 * Las imágenes ya están en `apps/web/public/images/lugares/` (las genera `pnpm db:images:iquitos`);
 * este script no toca R2 ni el sistema de archivos.
 */
const dryRun = process.argv.includes("--dry-run");
const keepDemo = process.argv.includes("--keep-demo");
const DEMO_PROVIDER = "demo-seed";

type CatalogEntry = Record<string, unknown> & { id: string; enabled: boolean };
type CatalogData = { revision: number; places: CatalogEntry[] } & Record<string, unknown>;

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  return ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

async function main() {
  const url = databaseUrl();
  if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
    throw new Error("db:seed:iquitos está deshabilitado en producción: revisa los datos y cárgalos desde el panel de catálogo.");
  }
  const data = loadIquitosData();
  const missing = data.places.filter((p) => !p.image.file || !p.image.credit);
  if (missing.length) throw new Error(`Faltan imágenes o créditos (${missing.map((p) => p.key).join(", ")}). Ejecuta: pnpm db:images:iquitos`);

  const pool = new Pool({ connectionString: url, max: 2 });
  const db = createDb(pool);
  const verifiedAt = new Date(`${data.verifiedOn}T00:00:00Z`);
  const summary = { created: 0, updated: 0, hiddenDemo: 0, catalogChanged: false };

  try {
    await db.transaction(async (tx) => {
      const [stored] = await tx.select().from(s.catalogContent).where(eq(s.catalogContent.key, "travel")).for("update");
      if (!stored) throw new Error("Aún no existe el catálogo `travel`. Inicia la API y abre /api/v1/catalog una vez; luego repite el comando.");
      const catalog = stored.data as CatalogData;
      const nextPlaces = [...catalog.places];

      const interestRows = await tx.select().from(s.interests);
      const interestId = new Map(interestRows.map((r) => [r.slug, r.id]));

      const demoRows = await tx.select({ id: s.places.id, key: s.places.providerPlaceId }).from(s.places).where(eq(s.places.provider, DEMO_PROVIDER));
      const demoIdByKey = new Map(demoRows.map((r) => [r.key, r.id]));

      for (const p of data.places) {
        const unknown = p.interests.filter((slug) => !interestId.has(slug));
        if (unknown.length) throw new Error(`${p.key}: intereses desconocidos (${unknown.join(", ")}). Ejecuta antes pnpm db:seed.`);
        const values = {
          scope: "CATALOG" as const,
          name: p.name,
          description: p.description,
          countryCode: "PE",
          region: "Loreto",
          locality: p.locality,
          address: p.address ?? null,
          location: { lng: p.lng, lat: p.lat },
          timezone: "America/Lima",
          provider: data.provider,
          providerPlaceId: p.key,
          sourceUrl: p.sources[0]?.url ?? null,
          verifiedAt,
          typicalVisitMinutes: p.typicalVisitMinutes,
        };
        const [existing] = await tx.select({ id: s.places.id }).from(s.places).where(and(eq(s.places.provider, data.provider), eq(s.places.providerPlaceId, p.key)));
        if (existing) summary.updated++;
        else summary.created++;
        const placeId = dryRun
          ? (existing?.id ?? "(nuevo)")
          : (
              await tx
                .insert(s.places)
                .values(values)
                .onConflictDoUpdate({
                  target: [s.places.provider, s.places.providerPlaceId],
                  targetWhere: sql`${s.places.providerPlaceId} is not null`,
                  set: { ...values, updatedAt: new Date() },
                })
                .returning({ id: s.places.id })
            )[0]!.id;
        if (dryRun) {
          console.log(`${existing ? "~ actualizar" : "+ crear"}  ${p.key}  ${p.name}  [${p.lat}, ${p.lng}]  ${p.image.file}  (${p.image.credit!.author}, ${p.image.credit!.license})`);
          continue;
        }

        await tx.delete(s.placeInterests).where(eq(s.placeInterests.placeId, placeId));
        await tx.insert(s.placeInterests).values(p.interests.map((slug) => ({ placeId, interestId: interestId.get(slug)! })));

        const entry = catalogEntry(placeId, data.cityId, p, nextPlaces.find((e) => e.id === placeId)?.enabled ?? true);
        const idx = nextPlaces.findIndex((e) => e.id === placeId);
        if (idx >= 0) nextPlaces[idx] = entry;
        else nextPlaces.push(entry);

        const demoId = p.supersedesDemo ? demoIdByKey.get(p.supersedesDemo) : undefined;
        const demoIdx = demoId ? nextPlaces.findIndex((e) => e.id === demoId) : -1;
        if (!keepDemo && demoIdx >= 0 && nextPlaces[demoIdx]!.enabled) {
          nextPlaces[demoIdx] = { ...nextPlaces[demoIdx]!, enabled: false };
          summary.hiddenDemo++;
        }
      }

      if (dryRun) return;
      if (!deepEqual(nextPlaces, catalog.places)) {
        const updated: CatalogData = { ...catalog, revision: catalog.revision + 1, places: nextPlaces };
        await tx.update(s.catalogContent).set({ data: updated }).where(eq(s.catalogContent.key, "travel"));
        summary.catalogChanged = true;
      }
    });
  } finally {
    await pool.end();
  }

  if (dryRun) console.log(`\n(dry-run) ${summary.created} por crear, ${summary.updated} por actualizar. No se escribió nada.`);
  else
    console.log(
      `✔ Lugares reales de Iquitos: ${summary.created} creados, ${summary.updated} actualizados; ${summary.hiddenDemo} de demostración ocultados; catálogo ${summary.catalogChanged ? "actualizado (revisión +1)" : "sin cambios"}.`,
    );
}

function catalogEntry(id: string, cityId: string, p: IquitosPlace, enabled: boolean): CatalogEntry {
  return {
    id,
    cityId,
    name: p.name,
    description: p.description,
    category: p.category,
    imageUrl: p.image.file!,
    imageCredit: p.image.credit!,
    lat: p.lat,
    lng: p.lng,
    enabled,
    interests: p.interests,
  };
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
