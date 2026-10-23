import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { ACCEPTED_IMAGE_TYPES, ERROR_CODES, type AssetDto, type CreateUploadInput, type UploadAuthorization } from "@por-aqui/contracts";
import { mediaAssets, profiles, publicationEntries, publicationMedia, publicationVersions, publications, users, visitMedia, visits, type Db, type DbExecutor } from "@por-aqui/database";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import sharp, { type Metadata } from "sharp";
import { hmac, safeEqual, sha256 } from "../../common/crypto";
import type { AuthUser } from "../../common/decorators";
import { AppError, badRequest, notFound } from "../../common/errors";
import { ENV, type Env } from "../../config/env";
import { OutboxService } from "../../infrastructure/outbox.service";
import { assetIdOfKey, assetPrefix, derivedKey, originalKey, prefixOfOriginal, USERS_ROOT, type MediaFolder } from "../../infrastructure/storage/keys";
import { StoragePort } from "../../infrastructure/storage/storage";
import { DB } from "../../infrastructure/tokens";
import { assetToDto } from "./media.mapper";

type AssetRow = typeof mediaAssets.$inferSelect;
export type Variant = "thumb" | "display";

const FORMAT_TO_MIME: Record<string, string> = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp" };

@Injectable()
export class MediaService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly storage: StoragePort,
    private readonly outbox: OutboxService,
  ) {}

  /* ───────────── Reserva y confirmación ───────────── */

  private async reserve(user: AuthUser, purpose: "VISIT_PHOTO" | "AVATAR", input: CreateUploadInput, visitId?: string): Promise<{ asset: AssetRow; auth: UploadAuthorization }> {
    if (input.sizeBytes > this.env.MEDIA_MAX_BYTES) {
      throw new AppError(400, ERROR_CODES.MEDIA_LIMIT, `La foto supera el máximo de ${Math.round(this.env.MEDIA_MAX_BYTES / 1048576)} MB.`, { sizeBytes: ["Archivo demasiado grande"] });
    }
    if (!(ACCEPTED_IMAGE_TYPES as readonly string[]).includes(input.mimeType)) throw new AppError(400, ERROR_CODES.UNSUPPORTED_MEDIA, "Formato no admitido. Usa JPEG, PNG o WebP.");

    // Carpeta del perfil según el tipo: avatar, o el lugar de la visita.
    let folder: MediaFolder = { kind: "avatar" };
    if (visitId) {
      const [visit] = await this.db.select({ placeId: visits.placeId }).from(visits).where(and(eq(visits.id, visitId), eq(visits.ownerId, user.id)));
      if (!visit) throw notFound("No encontramos esa visita.");
      folder = { kind: "place", placeId: visit.placeId };
    }
    const id = randomUUID();
    const key = originalKey(assetPrefix(user.id, folder, id));
    const target = await this.storage.createUploadUrl(key, input.mimeType, input.sizeBytes, this.env.UPLOAD_URL_TTL_SECONDS);

    const asset = await this.db.transaction(async (tx) => {
      const [{ n: total }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(mediaAssets).where(eq(mediaAssets.ownerId, user.id))) as [{ n: number }];
      if (total >= this.env.MEDIA_MAX_PER_USER) throw new AppError(400, ERROR_CODES.MEDIA_LIMIT, "Alcanzaste el límite de fotos de tu cuenta.");
      if (visitId) {
        // Bloquea la visita para que dos reservas simultáneas no superen el límite por visita.
        const [v] = await tx.select({ id: visits.id }).from(visits).where(and(eq(visits.id, visitId), eq(visits.ownerId, user.id))).for("update");
        if (!v) throw notFound("No encontramos esa visita.");
        const [{ n, max }] = (await tx
          .select({ n: sql<number>`count(*)::int`, max: sql<number>`coalesce(max(${visitMedia.position}), -1)::int` })
          .from(visitMedia)
          .innerJoin(mediaAssets, eq(mediaAssets.id, visitMedia.assetId))
          .where(and(eq(visitMedia.visitId, visitId), sql`${mediaAssets.status} <> 'FAILED' AND NOT (${mediaAssets.status} = 'PENDING' AND ${mediaAssets.uploadExpiresAt} < now())`))) as [{ n: number; max: number }];
        if (n >= this.env.MEDIA_MAX_PER_VISIT) throw new AppError(400, ERROR_CODES.MEDIA_LIMIT, `Cada visita admite hasta ${this.env.MEDIA_MAX_PER_VISIT} fotos.`);
        const [row] = await tx
          .insert(mediaAssets)
          .values({ id, ownerId: user.id, purpose, originalKey: key, mimeClaimed: input.mimeType, uploadExpiresAt: target.expiresAt })
          .returning();
        const [{ pos }] = (await tx.select({ pos: sql<number>`coalesce(max(${visitMedia.position}), -1)::int + 1` }).from(visitMedia).where(eq(visitMedia.visitId, visitId))) as [{ pos: number }];
        await tx.insert(visitMedia).values({ visitId, assetId: id, ownerId: user.id, position: Math.max(pos, max + 1) });
        return row!;
      }
      const [row] = await tx.insert(mediaAssets).values({ id, ownerId: user.id, purpose, originalKey: key, mimeClaimed: input.mimeType, uploadExpiresAt: target.expiresAt }).returning();
      return row!;
    });
    return { asset, auth: { assetId: asset.id, method: target.method, url: target.url, headers: target.headers, expiresAt: target.expiresAt.toISOString() } };
  }

  async reserveVisitUpload(user: AuthUser, visitId: string, input: CreateUploadInput) {
    return (await this.reserve(user, "VISIT_PHOTO", input, visitId)).auth;
  }

  async reserveAvatarUpload(user: AuthUser, input: CreateUploadInput) {
    return (await this.reserve(user, "AVATAR", input)).auth;
  }

  private async owned(exec: DbExecutor, userId: string, assetId: string): Promise<AssetRow> {
    const [a] = await exec.select().from(mediaAssets).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.ownerId, userId))).limit(1);
    if (!a) throw notFound("No encontramos esa foto.");
    return a;
  }

  private async dtoOf(asset: AssetRow): Promise<AssetDto> {
    const [vm] = await this.db.select().from(visitMedia).where(eq(visitMedia.assetId, asset.id));
    return assetToDto(asset, vm?.position ?? 0, vm?.caption ?? null);
  }

  /** Confirmar la subida NO equivale a READY: el worker verifica bytes y genera derivados. */
  async complete(user: AuthUser, assetId: string): Promise<AssetDto> {
    const asset = await this.owned(this.db, user.id, assetId);
    if (asset.status !== "PENDING") return this.dtoOf(asset); // idempotente
    const info = await this.storage.head(asset.originalKey);
    if (!info) {
      if (asset.uploadExpiresAt.getTime() < Date.now()) {
        const [u] = await this.db.update(mediaAssets).set({ status: "FAILED", failureCode: "UPLOAD_EXPIRED" }).where(eq(mediaAssets.id, assetId)).returning();
        return this.dtoOf(u!);
      }
      throw badRequest("UPLOAD_MISSING", "Todavía no recibimos el archivo. Inténtalo de nuevo.");
    }
    if (info.size > this.env.MEDIA_MAX_BYTES || info.size < 1) {
      await this.storage.deleteMany([asset.originalKey]);
      const [u] = await this.db.update(mediaAssets).set({ status: "FAILED", failureCode: "TOO_LARGE", sizeBytes: info.size }).where(eq(mediaAssets.id, assetId)).returning();
      return this.dtoOf(u!);
    }
    const updated = await this.db.transaction(async (tx) => {
      const [u] = await tx.update(mediaAssets).set({ status: "UPLOADED", sizeBytes: info.size }).where(and(eq(mediaAssets.id, assetId), eq(mediaAssets.status, "PENDING"))).returning();
      if (u) await this.outbox.add(tx, "MEDIA_PROCESS", assetId, { assetId });
      return u ?? asset;
    });
    return this.dtoOf(updated);
  }

  async get(user: AuthUser, assetId: string): Promise<AssetDto> {
    return this.dtoOf(await this.owned(this.db, user.id, assetId));
  }

  async retry(user: AuthUser, assetId: string): Promise<AssetDto> {
    const asset = await this.owned(this.db, user.id, assetId);
    if (asset.status !== "FAILED" || ["TOO_LARGE", "UNSUPPORTED_FORMAT", "UPLOAD_EXPIRED"].includes(asset.failureCode ?? "")) {
      throw badRequest("RETRY_NOT_POSSIBLE", "Esta foto no se puede reintentar. Sube otra.");
    }
    const updated = await this.db.transaction(async (tx) => {
      const [u] = await tx.update(mediaAssets).set({ status: "UPLOADED", failureCode: null }).where(eq(mediaAssets.id, assetId)).returning();
      await this.outbox.add(tx, "MEDIA_PROCESS", assetId, { assetId });
      return u!;
    });
    return this.dtoOf(updated);
  }

  /**
   * Reordena las fotos de una visita. `assetIds` debe ser exactamente el conjunto actual (una lista parcial o con
   * ajenas se rechaza). La restricción única (visita, posición) exige mover primero a un rango temporal.
   */
  async reorderVisitMedia(user: AuthUser, visitId: string, assetIds: string[]): Promise<{ ok: true }> {
    await this.db.transaction(async (tx) => {
      const [visit] = await tx.select({ id: visits.id }).from(visits).where(and(eq(visits.id, visitId), eq(visits.ownerId, user.id))).for("update");
      if (!visit) throw notFound("No encontramos esa visita.");
      const current = await tx.select({ assetId: visitMedia.assetId }).from(visitMedia).where(and(eq(visitMedia.visitId, visitId), eq(visitMedia.ownerId, user.id)));
      const have = new Set(current.map((r) => r.assetId));
      if (new Set(assetIds).size !== assetIds.length || assetIds.length !== have.size || assetIds.some((id) => !have.has(id))) {
        throw badRequest("INVALID_ORDER", "El orden debe incluir todas las fotos de la visita, sin repetir.");
      }
      await tx.update(visitMedia).set({ position: sql`${visitMedia.position} + 100000` }).where(eq(visitMedia.visitId, visitId));
      for (const [i, id] of assetIds.entries()) {
        await tx.update(visitMedia).set({ position: i }).where(and(eq(visitMedia.visitId, visitId), eq(visitMedia.assetId, id)));
      }
    });
    return { ok: true };
  }

  async setCaption(user: AuthUser, assetId: string, caption: string | null): Promise<AssetDto> {
    const asset = await this.owned(this.db, user.id, assetId);
    await this.db.update(visitMedia).set({ caption }).where(and(eq(visitMedia.assetId, assetId), eq(visitMedia.ownerId, user.id)));
    return this.dtoOf(asset);
  }

  /* ───────────── Borrado con política explícita ───────────── */

  /** ¿Algún snapshot publicado referencia estos archivos? */
  private async publishedReferences(exec: DbExecutor, assetIds: string[]): Promise<string[]> {
    if (assetIds.length === 0) return [];
    const inMedia = await exec.select({ id: publicationMedia.assetId }).from(publicationMedia).where(inArray(publicationMedia.assetId, assetIds));
    const inCover = await exec.select({ id: publicationVersions.coverAssetId }).from(publicationVersions).where(inArray(publicationVersions.coverAssetId, assetIds));
    return [...new Set([...inMedia.map((r) => r.id), ...inCover.map((r) => r.id!).filter(Boolean)])];
  }

  /**
   * Política: no se borran bytes que una publicación todavía referencia. Hay que actualizar la publicación
   * (sin esa foto) o retirarla primero; así nunca quedan referencias públicas rotas.
   */
  async deleteAssets(tx: DbExecutor, userId: string, assetIds: string[]) {
    if (assetIds.length === 0) return;
    const used = await this.publishedReferences(tx, assetIds);
    if (used.length > 0) {
      throw new AppError(409, ERROR_CODES.MEDIA_IN_PUBLICATION, "Esta foto está en una publicación. Actualiza o retira la publicación antes de eliminarla.", undefined, { assetIds: used });
    }
    const rows = await tx.select().from(mediaAssets).where(and(inArray(mediaAssets.id, assetIds), eq(mediaAssets.ownerId, userId)));
    if (rows.length === 0) return;
    await tx.update(profiles).set({ avatarAssetId: null }).where(inArray(profiles.avatarAssetId, assetIds));
    await tx.delete(mediaAssets).where(inArray(mediaAssets.id, rows.map((r) => r.id)));
    // Se borra la carpeta entera del archivo (original + todas las versiones) y, por si acaso, cada clave conocida.
    const keys = rows.flatMap((r) => [r.originalKey, r.thumbnailKey, r.displayKey].filter((k): k is string => Boolean(k)));
    const prefixes = rows.map((r) => prefixOfOriginal(r.originalKey)).filter((p): p is string => Boolean(p)).map((p) => `${p}/`);
    await this.outbox.add(tx, "MEDIA_DELETE", null, { keys, prefixes });
  }

  async deleteVisitAssets(tx: DbExecutor, userId: string, visitId: string) {
    const rows = await tx.select({ id: visitMedia.assetId }).from(visitMedia).where(and(eq(visitMedia.visitId, visitId), eq(visitMedia.ownerId, userId)));
    await this.deleteAssets(tx, userId, rows.map((r) => r.id));
  }

  async delete(user: AuthUser, assetId: string): Promise<{ ok: true }> {
    await this.owned(this.db, user.id, assetId);
    await this.db.transaction((tx) => this.deleteAssets(tx, user.id, [assetId]));
    return { ok: true };
  }

  /**
   * Limpieza de reservas huérfanas: subidas que nunca se confirmaron y ya vencieron (más 1 h de gracia).
   * Nunca tocan archivos usados por publicaciones (no pueden estarlo: no llegaron a READY).
   */
  async cleanupOrphans(limit = 100): Promise<number> {
    const rows = await this.db
      .select({ id: mediaAssets.id, ownerId: mediaAssets.ownerId })
      .from(mediaAssets)
      .where(and(eq(mediaAssets.status, "PENDING"), sql`${mediaAssets.uploadExpiresAt} < now() - interval '1 hour'`))
      .limit(limit);
    for (const r of rows) await this.db.transaction((tx) => this.deleteAssets(tx, r.ownerId, [r.id]));
    return rows.length;
  }

  /**
   * Red de seguridad: borra de R2 los objetos de `users/…` cuya fila ya no existe en la base de datos
   * (borrados a mano, restauraciones, eventos perdidos). Ignora lo de la última hora para no pisar subidas en curso.
   */
  async reconcileStorage(maxObjects = 50_000): Promise<number> {
    const cutoff = Date.now() - 3_600_000;
    const byAsset = new Map<string, string[]>();
    for (const o of await this.storage.list(USERS_ROOT, maxObjects)) {
      const id = assetIdOfKey(o.key);
      if (!id || o.lastModified.getTime() > cutoff) continue;
      byAsset.set(id, [...(byAsset.get(id) ?? []), o.key]);
    }
    const ids = [...byAsset.keys()];
    const known = new Set<string>();
    for (let i = 0; i < ids.length; i += 500) {
      const rows = await this.db.select({ id: mediaAssets.id }).from(mediaAssets).where(inArray(mediaAssets.id, ids.slice(i, i + 500)));
      for (const r of rows) known.add(r.id);
    }
    const orphans = ids.filter((id) => !known.has(id)).flatMap((id) => byAsset.get(id)!);
    await this.storage.deleteMany(orphans);
    return orphans.length;
  }

  /* ───────────── Procesamiento (worker) ───────────── */

  /**
   * Idempotente: verifica bytes reales, limita píxeles, normaliza orientación, elimina EXIF/GPS y crea derivados
   * con claves versionadas. Puede ejecutarse dos veces sin duplicar resultados.
   */
  async process(assetId: string): Promise<"READY" | "FAILED" | "SKIPPED"> {
    const [asset] = await this.db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId));
    if (!asset || asset.status === "READY") return "SKIPPED";
    if (asset.status === "FAILED" && asset.failureCode !== "PROCESSING_ERROR") return "SKIPPED";
    await this.db.update(mediaAssets).set({ status: "PROCESSING" }).where(eq(mediaAssets.id, assetId));

    const fail = async (code: string, deleteOriginal = false) => {
      if (deleteOriginal) await this.storage.deleteMany([asset.originalKey]);
      await this.db.update(mediaAssets).set({ status: "FAILED", failureCode: code }).where(eq(mediaAssets.id, assetId));
      return "FAILED" as const;
    };

    const info = await this.storage.head(asset.originalKey);
    if (!info) return fail("OBJECT_MISSING");
    if (info.size > this.env.MEDIA_MAX_BYTES) return fail("TOO_LARGE", true);

    let original: Buffer;
    try {
      original = await this.storage.getBuffer(asset.originalKey, this.env.MEDIA_MAX_BYTES);
    } catch (err) {
      if (err instanceof Error && err.message === "OBJECT_TOO_LARGE") return fail("TOO_LARGE", true);
      throw err; // fallo transitorio: BullMQ reintenta
    }

    // La firma real del archivo manda; el MIME declarado por el cliente no es prueba.
    let meta: Metadata;
    try {
      meta = await sharp(original, { limitInputPixels: this.env.MEDIA_MAX_PIXELS }).metadata();
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      if (/pixel limit/i.test(message)) return fail("TOO_MANY_PIXELS", true);
      return fail("UNSUPPORTED_FORMAT", true);
    }
    const mime = meta.format ? FORMAT_TO_MIME[meta.format] : undefined;
    if (!mime) return fail("UNSUPPORTED_FORMAT", true);
    if ((meta.pages ?? 1) > 1) return fail("UNSUPPORTED_FORMAT", true); // sin animaciones

    const sizes = asset.purpose === "AVATAR" ? { thumb: 256, display: 640 } : { thumb: 480, display: 1600 };
    try {
      const base = () => sharp(original, { limitInputPixels: this.env.MEDIA_MAX_PIXELS }).rotate(); // aplica EXIF.orientation y descarta metadatos
      const thumb = await base().resize({ width: sizes.thumb, height: sizes.thumb, fit: "cover" }).webp({ quality: 78 }).toBuffer();
      const display = await base().resize({ width: sizes.display, height: sizes.display, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });

      const version = asset.derivativeVersion + 1;
      const prefix = prefixOfOriginal(asset.originalKey) ?? `derived/${assetId}`; // claves anteriores a la estructura por perfil
      const thumbKey = derivedKey(prefix, version, "thumb");
      const displayKey = derivedKey(prefix, version, "display");
      await this.storage.put(thumbKey, thumb, "image/webp");
      await this.storage.put(displayKey, display.data, "image/webp");

      await this.db.transaction(async (tx) => {
        await tx
          .update(mediaAssets)
          .set({ status: "READY", failureCode: null, mimeVerified: mime, width: display.info.width, height: display.info.height, checksum: sha256(original.toString("base64")), thumbnailKey: thumbKey, displayKey, derivativeVersion: version })
          .where(eq(mediaAssets.id, assetId));
        if (asset.purpose === "AVATAR") {
          const [old] = await tx.select({ id: profiles.avatarAssetId }).from(profiles).where(eq(profiles.userId, asset.ownerId));
          await tx.update(profiles).set({ avatarAssetId: assetId }).where(eq(profiles.userId, asset.ownerId));
          if (old?.id && old.id !== assetId) await this.deleteAssets(tx, asset.ownerId, [old.id]);
        }
      });
      // Los derivados anteriores (reprocesado) quedan huérfanos con su clave versionada y se limpian.
      if (asset.thumbnailKey || asset.displayKey) await this.storage.deleteMany([asset.thumbnailKey, asset.displayKey].filter((k): k is string => Boolean(k)));
      return "READY";
    } catch (err) {
      await this.db.update(mediaAssets).set({ status: "FAILED", failureCode: "PROCESSING_ERROR" }).where(eq(mediaAssets.id, assetId));
      throw err;
    }
  }

  /* ───────────── Lectura autorizada ───────────── */

  signTicket(assetId: string): string {
    const exp = Math.floor(Date.now() / 1000) + this.env.MEDIA_TICKET_TTL_SECONDS;
    return `${exp}.${hmac(this.env.APP_ENCRYPTION_KEY, `media:${assetId}:${exp}`)}`;
  }

  private verifyTicket(assetId: string, ticket: string): boolean {
    const [exp, sig] = ticket.split(".");
    if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
    return safeEqual(sig, hmac(this.env.APP_ENCRYPTION_KEY, `media:${assetId}:${exp}`));
  }

  /** URL de lectura con ticket de vida corta: para historias por enlace, sin incrustar el token del enlace. */
  ticketUrl(assetId: string, variant: Variant, derivativeVersion: number): string {
    return `/api/v1/media/${assetId}/content?variant=${variant}&v=${derivativeVersion}&t=${this.signTicket(assetId)}`;
  }

  /**
   * Reglas de lectura (se evalúan en cada petición, así retirar/ocultar una publicación corta el acceso):
   * dueño · avatar de perfil · publicación PUBLIC+VISIBLE · ticket vigente de historia por enlace · moderador con reporte abierto.
   */
  async authorizeRead(viewer: AuthUser | undefined, assetId: string, ticket: string | undefined): Promise<{ asset: AssetRow; publicCache: boolean }> {
    const [asset] = await this.db.select().from(mediaAssets).where(eq(mediaAssets.id, assetId));
    if (!asset || asset.status !== "READY") throw notFound();
    if (viewer && viewer.id === asset.ownerId) return { asset, publicCache: false };

    if (asset.purpose === "AVATAR") {
      const [p] = await this.db
        .select({ id: profiles.userId })
        .from(profiles)
        .innerJoin(users, eq(users.id, profiles.userId))
        .where(and(eq(profiles.avatarAssetId, assetId), eq(users.accountStatus, "ACTIVE")));
      if (p) return { asset, publicCache: true };
    }

    // Publicada: el activo debe pertenecer a la versión ACTIVA de una publicación visible.
    const published = await this.db
      .select({ visibility: publications.visibility, id: publications.id })
      .from(publications)
      .innerJoin(publicationVersions, eq(publicationVersions.id, publications.activeVersionId))
      .leftJoin(publicationEntries, eq(publicationEntries.versionId, publicationVersions.id))
      .leftJoin(publicationMedia, eq(publicationMedia.entryId, publicationEntries.id))
      .where(
        and(
          eq(publications.moderationStatus, "VISIBLE"),
          sql`${publications.visibility} in ('PUBLIC','UNLISTED')`,
          or(eq(publicationMedia.assetId, assetId), eq(publicationVersions.coverAssetId, assetId)),
        ),
      );
    if (published.some((p) => p.visibility === "PUBLIC")) return { asset, publicCache: true };
    if (published.length > 0 && ticket && this.verifyTicket(assetId, ticket)) return { asset, publicCache: false };

    if (viewer?.role === "MODERATOR") {
      // Un moderador solo ve el snapshot de publicaciones reportadas (abiertas) u ocultas, nunca diarios privados.
      const reviewable = await this.db.execute(sql`
        SELECT 1 FROM publications p
        JOIN publication_versions v ON v.id = p.active_version_id
        LEFT JOIN publication_entries e ON e.version_id = v.id
        LEFT JOIN publication_media m ON m.entry_id = e.id
        WHERE (m.asset_id = ${assetId} OR v.cover_asset_id = ${assetId})
          AND (p.moderation_status = 'HIDDEN' OR EXISTS (SELECT 1 FROM reports r WHERE r.publication_id = p.id AND r.status = 'OPEN'))
        LIMIT 1`);
      if (reviewable.rows.length) return { asset, publicCache: false };
    }
    throw notFound();
  }

  async openContent(asset: AssetRow, variant: Variant) {
    const key = variant === "thumb" ? asset.thumbnailKey : asset.displayKey;
    if (!key) throw notFound();
    return this.storage.getStream(key);
  }
}

