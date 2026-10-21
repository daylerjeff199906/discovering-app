import type { AssetDto } from "@por-aqui/contracts";
import { mediaAssets, visitMedia, type DbExecutor } from "@por-aqui/database";
import { asc, inArray, eq } from "drizzle-orm";

type AssetRow = typeof mediaAssets.$inferSelect;

/** URLs relativas al origen único; el contenido se autoriza en cada petición (no hay buckets públicos). */
export function assetUrl(asset: Pick<AssetRow, "id" | "derivativeVersion">, variant: "thumb" | "display"): string {
  return `/api/v1/media/${asset.id}/content?variant=${variant}&v=${asset.derivativeVersion}`;
}

export function assetToDto(asset: AssetRow, position = 0, caption: string | null = null): AssetDto {
  const ready = asset.status === "READY";
  return {
    id: asset.id,
    status: asset.status as AssetDto["status"],
    failureCode: asset.failureCode,
    width: asset.width,
    height: asset.height,
    thumbUrl: ready ? assetUrl(asset, "thumb") : null,
    displayUrl: ready ? assetUrl(asset, "display") : null,
    position,
    caption,
  };
}

export async function loadVisitMedia(exec: DbExecutor, visitIds: string[]): Promise<Map<string, AssetDto[]>> {
  const map = new Map<string, AssetDto[]>();
  if (visitIds.length === 0) return map;
  const rows = await exec
    .select({ a: mediaAssets, vm: visitMedia })
    .from(visitMedia)
    .innerJoin(mediaAssets, eq(mediaAssets.id, visitMedia.assetId))
    .where(inArray(visitMedia.visitId, visitIds))
    .orderBy(asc(visitMedia.position));
  for (const r of rows) {
    const list = map.get(r.vm.visitId) ?? [];
    list.push(assetToDto(r.a, r.vm.position, r.vm.caption));
    map.set(r.vm.visitId, list);
  }
  return map;
}
