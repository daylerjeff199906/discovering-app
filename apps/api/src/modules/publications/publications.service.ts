import { randomInt } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import {
  ERROR_CODES,
  type BookmarkItem,
  type CopyResult,
  type ExploreQuery,
  type PlaceSnapshot,
  type PublicEntry,
  type PublicProfileDto,
  type PublicRouteCard,
  type PublicRouteDto,
  type PublicationDraftDto,
  type PublicationStateDto,
  type PublishInput,
  type ShareLinkCreated,
  type ShareLinkDto,
  type Visibility,
} from "@por-aqui/contracts";
import {
  bookmarks,
  journeyDays,
  journeys,
  journeyStops,
  mediaAssets,
  places,
  profiles,
  publicationEntries,
  publicationMedia,
  publicationVersions,
  publications,
  recordings,
  reports,
  shareLinks,
  trackPoints,
  trackSegments,
  users,
  visitMedia,
  visits,
  type Db,
  type DbExecutor,
} from "@por-aqui/database";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { randomToken, sha256 } from "../../common/crypto";
import type { AuthUser } from "../../common/decorators";
import { AppError, badRequest, forbidden, notFound, versionConflict } from "../../common/errors";
import { approximate, decodeCursor, encodeCursor, localDateOf, simplifyLine, slugify } from "../../common/geo";
import { ENV, type Env } from "../../config/env";
import { DB } from "../../infrastructure/tokens";
import { defaultPreferences } from "../journeys/journey.mapper";
import { assetUrl, loadVisitMedia } from "../media/media.mapper";
import { MediaService } from "../media/media.service";

type PubRow = typeof publications.$inferSelect;
type VersionRow = typeof publicationVersions.$inferSelect;

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => "\\" + c);

/** Una publicación es legible por el público solo si cumple TODAS estas condiciones. */
const publicVisible = sql`${publications.visibility} = 'PUBLIC' and ${publications.moderationStatus} = 'VISIBLE' and ${publications.activeVersionId} is not null and ${users.accountStatus} = 'ACTIVE'`;

@Injectable()
export class PublicationsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly media: MediaService,
  ) {}

  /* ═════════════ Autor: borrador y publicación ═════════════ */

  private async ownedJourney(exec: DbExecutor, userId: string, journeyId: string) {
    const [j] = await exec.select().from(journeys).where(and(eq(journeys.id, journeyId), eq(journeys.ownerId, userId))).limit(1);
    if (!j) throw notFound("No encontramos esa aventura.");
    return j;
  }

  private stateOf(pub: PubRow, version: VersionRow | null, linkCount: number): PublicationStateDto {
    return {
      id: pub.id,
      slug: pub.slug,
      visibility: pub.visibility as Visibility,
      moderationStatus: pub.moderationStatus as "VISIBLE" | "HIDDEN",
      revision: version?.revision ?? null,
      firstPublishedAt: pub.firstPublishedAt?.toISOString() ?? null,
      updatedAt: pub.updatedAt.toISOString(),
      activeLinkCount: linkCount,
      current: (version?.selectionJson as PublicationStateDto["current"]) ?? null,
    };
  }

  private async linkCount(exec: DbExecutor, publicationId: string): Promise<number> {
    const [r] = await exec
      .select({ n: sql<number>`count(*)::int` })
      .from(shareLinks)
      .where(and(eq(shareLinks.publicationId, publicationId), isNull(shareLinks.revokedAt), or(isNull(shareLinks.expiresAt), sql`${shareLinks.expiresAt} > now()`)));
    return r?.n ?? 0;
  }

  async getDraft(user: AuthUser, journeyId: string): Promise<PublicationDraftDto> {
    const journey = await this.ownedJourney(this.db, user.id, journeyId);
    const [rec] = await this.db.select().from(recordings).where(eq(recordings.journeyId, journeyId));
    const rows = await this.db.select().from(visits).where(eq(visits.journeyId, journeyId)).orderBy(asc(visits.visitedAt), asc(visits.id));
    const media = await loadVisitMedia(this.db, rows.map((r) => r.id));

    let blockedReason: string | null = null;
    if (!rec) blockedReason = "Todavía no registraste visitas en esta aventura.";
    else if (rec.status !== "COMPLETED") blockedReason = "Finaliza el recorrido para poder publicarlo.";
    else if (rows.length === 0) blockedReason = "Registra al menos una visita para publicar.";
    else if (!user.emailVerified) blockedReason = "Verifica tu correo para publicar.";

    const [pub] = await this.db.select().from(publications).where(eq(publications.journeyId, journeyId));
    let version: VersionRow | null = null;
    if (pub?.activeVersionId) version = (await this.db.select().from(publicationVersions).where(eq(publicationVersions.id, pub.activeVersionId)))[0] ?? null;

    let hasTrack = false;
    if (rec) {
      const r = await this.db.execute(sql`select 1 from track_points tp join track_segments ts on ts.id = tp.segment_id where ts.recording_id = ${rec.id} limit 1`);
      hasTrack = r.rows.length > 0;
    }
    return {
      journeyId,
      journeyTitle: journey.title,
      canPublish: blockedReason === null,
      blockedReason,
      publication: pub ? this.stateOf(pub, version, await this.linkCount(this.db, pub.id)) : null,
      candidates: rows.map((v) => ({
        visitId: v.id,
        placeName: (v.placeSnapshotJson as PlaceSnapshot).name,
        visitedAt: v.visitedAt.toISOString(),
        timezone: v.timezone,
        note: v.note,
        recommendation: v.recommendation,
        media: (media.get(v.id) ?? []).filter((m) => m.status === "READY").map((m) => ({ id: m.id, thumbUrl: m.thumbUrl, displayUrl: m.displayUrl, caption: m.caption })),
      })),
      hasTrack,
    };
  }

  private async uniqueSlug(exec: DbExecutor, title: string): Promise<string> {
    for (let i = 0; i < 6; i++) {
      const suffix = Array.from({ length: 6 }, () => "abcdefghjkmnpqrstuvwxyz23456789"[randomInt(31)]).join("");
      const slug = `${slugify(title)}-${suffix}`;
      const [hit] = await exec.select({ id: publications.id }).from(publications).where(eq(publications.slug, slug)).limit(1);
      if (!hit) return slug;
    }
    throw new AppError(500, ERROR_CODES.INTERNAL, "No pudimos generar el enlace de la publicación.");
  }

  /**
   * Publicar = crear una INSTANTÁNEA sanitizada y seleccionada. Cambios privados posteriores no aparecen
   * hasta «Actualizar publicación». Todo ocurre en una transacción con la aventura bloqueada.
   */
  async publish(user: AuthUser, journeyId: string, input: PublishInput): Promise<PublicationStateDto> {
    return this.db.transaction(async (tx) => {
      const [journey] = await tx.select().from(journeys).where(and(eq(journeys.id, journeyId), eq(journeys.ownerId, user.id))).for("update");
      if (!journey) throw notFound("No encontramos esa aventura.");
      const [rec] = await tx.select().from(recordings).where(eq(recordings.journeyId, journeyId));
      if (!rec || rec.status !== "COMPLETED") throw badRequest("NOT_COMPLETED", "Finaliza el recorrido antes de publicarlo.");

      const [existing] = await tx.select().from(publications).where(eq(publications.journeyId, journeyId)).for("update");
      if (existing && input.expectedRevision !== undefined && input.expectedRevision !== existing.revision) throw versionConflict(existing.revision);

      // Visitas elegidas: únicas, de esta aventura.
      const visitIds = input.entries.map((e) => e.visitId);
      if (new Set(visitIds).size !== visitIds.length) throw badRequest("ENTRIES_DUPLICATED", "Hay visitas repetidas en la selección.");
      const visitRows = await tx.select().from(visits).where(and(inArray(visits.id, visitIds), eq(visits.journeyId, journeyId), eq(visits.ownerId, user.id)));
      if (visitRows.length !== visitIds.length) throw badRequest("ENTRIES_INVALID", "Alguna visita no pertenece a esta aventura.");
      const visitById = new Map(visitRows.map((v) => [v.id, v]));

      // Fotos elegidas: deben ser de ESA visita, del autor y estar READY.
      const assetIds = input.entries.flatMap((e) => e.media.map((m) => m.assetId));
      if (new Set(assetIds).size !== assetIds.length) throw badRequest("MEDIA_DUPLICATED", "Hay fotos repetidas en la selección.");
      const links = assetIds.length
        ? await tx
            .select({ visitId: visitMedia.visitId, assetId: visitMedia.assetId, status: mediaAssets.status })
            .from(visitMedia)
            .innerJoin(mediaAssets, eq(mediaAssets.id, visitMedia.assetId))
            .where(and(inArray(visitMedia.assetId, assetIds), eq(visitMedia.ownerId, user.id), eq(mediaAssets.purpose, "VISIT_PHOTO")))
        : [];
      const linkOf = new Map(links.map((l) => [l.assetId, l]));
      for (const e of input.entries) {
        for (const m of e.media) {
          const l = linkOf.get(m.assetId);
          if (!l || l.visitId !== e.visitId) throw badRequest("MEDIA_INVALID", "Una foto no pertenece a la visita indicada.");
          if (l.status !== "READY") throw badRequest("MEDIA_NOT_READY", "Una foto todavía se está procesando.");
        }
      }
      if (input.coverAssetId && !assetIds.includes(input.coverAssetId)) throw badRequest("COVER_INVALID", "La portada debe ser una de las fotos seleccionadas.");

      const [profile] = await tx.select().from(profiles).where(eq(profiles.userId, user.id));
      const prefs = { ...defaultPreferences(), ...((journey.preferencesJson ?? {}) as object) } as ReturnType<typeof defaultPreferences>;

      // Entradas publicables (nunca se serializa el Journey completo).
      const ordered = [...input.entries].sort((a, b) => {
        const va = visitById.get(a.visitId)!;
        const vb = visitById.get(b.visitId)!;
        return va.visitedAt.getTime() - vb.visitedAt.getTime();
      });
      const dates = new Set<string>();
      const entries = ordered.map((e, idx) => {
        const v = visitById.get(e.visitId)!;
        const snap = v.placeSnapshotJson as PlaceSnapshot;
        const local = localDateOf(v.visitedAt, v.timezone);
        dates.add(local);
        const point = e.locationPrecision === "HIDDEN" ? null : e.locationPrecision === "APPROXIMATE" ? approximate(snap) : { lng: snap.lng, lat: snap.lat };
        return {
          position: idx,
          displayName: snap.name,
          locationLabel: [snap.locality, snap.region, snap.countryCode].filter(Boolean).join(", ") || null,
          publicLocation: point,
          locationPrecision: e.locationPrecision,
          note: e.includeNote ? v.note : null,
          recommendation: e.includeRecommendation ? v.recommendation : null,
          visitedLocalDate: local,
          catalogPlaceId: snap.scope === "CATALOG" ? v.placeId : null,
          media: e.media,
        };
      });

      let sanitizedTrack: [number, number][][] | null = null;
      if (input.shareExactTrack) sanitizedTrack = await this.sanitizedTrack(tx, rec.id);

      const [pub] = existing
        ? [existing]
        : await tx.insert(publications).values({ journeyId, authorId: user.id, slug: await this.uniqueSlug(tx, input.title), visibility: "PRIVATE" }).returning();
      const revision = (existing?.revision ?? 0) + 1;
      const selection = { ...input, expectedRevision: undefined };
      delete (selection as { expectedRevision?: number }).expectedRevision;

      const [version] = await tx
        .insert(publicationVersions)
        .values({
          publicationId: pub!.id,
          revision,
          title: input.title,
          description: input.description ?? null,
          authorDisplaySnapshot: { username: profile!.username, displayName: profile!.displayName, avatarAssetId: profile!.avatarAssetId, isDemo: profile!.isDemo },
          coverAssetId: input.coverAssetId ?? null,
          locationLabel: input.locationLabel ?? prefs.destinationLabel ?? null,
          transportSummary: input.transportSummary ?? null,
          transportMode: prefs.transport,
          pace: prefs.pace,
          interestSlugs: prefs.interests,
          durationDays: Math.max(1, dates.size),
          shareExactTrack: input.shareExactTrack,
          sanitizedTrack,
          selectionJson: selection,
        })
        .returning();

      for (const e of entries) {
        const [entry] = await tx
          .insert(publicationEntries)
          .values({ versionId: version!.id, position: e.position, displayName: e.displayName, locationLabel: e.locationLabel, publicLocation: e.publicLocation, locationPrecision: e.locationPrecision, note: e.note, recommendation: e.recommendation, visitedLocalDate: e.visitedLocalDate, catalogPlaceId: e.catalogPlaceId })
          .returning({ id: publicationEntries.id });
        for (const [i, m] of e.media.entries()) {
          await tx.insert(publicationMedia).values({ entryId: entry!.id, assetId: m.assetId, position: i, caption: m.caption ?? null, altText: m.altText ?? null });
        }
      }

      const goingPublic = input.visibility !== "PRIVATE";
      await tx
        .update(publications)
        .set({
          activeVersionId: version!.id,
          revision,
          visibility: input.visibility,
          firstPublishedAt: pub!.firstPublishedAt ?? (goingPublic ? new Date() : null),
        })
        .where(eq(publications.id, pub!.id));
      // Solo se conserva la versión activa: así las fotos eliminadas no quedan referenciadas por versiones antiguas.
      await tx.delete(publicationVersions).where(and(eq(publicationVersions.publicationId, pub!.id), sql`${publicationVersions.id} <> ${version!.id}`));
      if (!goingPublic) await tx.update(shareLinks).set({ revokedAt: new Date() }).where(and(eq(shareLinks.publicationId, pub!.id), isNull(shareLinks.revokedAt)));

      const [fresh] = await tx.select().from(publications).where(eq(publications.id, pub!.id));
      return this.stateOf(fresh!, version!, await this.linkCount(tx, pub!.id));
    });
  }

  private async sanitizedTrack(tx: DbExecutor, recordingId: string): Promise<[number, number][][] | null> {
    const segs = await tx.select().from(trackSegments).where(eq(trackSegments.recordingId, recordingId)).orderBy(asc(trackSegments.startedAt));
    const out: [number, number][][] = [];
    for (const s of segs) {
      const pts = await tx.select({ loc: trackPoints.location }).from(trackPoints).where(eq(trackPoints.segmentId, s.id)).orderBy(asc(trackPoints.clientSequence));
      let line: [number, number][] = pts.map((p) => [Math.round(p.loc.lng * 1e5) / 1e5, Math.round(p.loc.lat * 1e5) / 1e5]);
      for (let tol = 0.00003; line.length > 400 && tol < 0.01; tol *= 2) line = simplifyLine(line, tol);
      if (line.length >= 2) out.push(line);
    }
    return out.length ? out : null;
  }

  private async ownedPublication(exec: DbExecutor, userId: string, publicationId: string): Promise<PubRow> {
    const [p] = await exec.select().from(publications).where(and(eq(publications.id, publicationId), eq(publications.authorId, userId))).limit(1);
    if (!p) throw notFound("No encontramos esa publicación.");
    return p;
  }

  async setVisibility(user: AuthUser, publicationId: string, visibility: Visibility): Promise<PublicationStateDto> {
    return this.db.transaction(async (tx) => {
      const pub = await this.ownedPublication(tx, user.id, publicationId);
      if (visibility !== "PRIVATE" && !pub.activeVersionId) throw badRequest("NO_ACTIVE_VERSION", "Publica primero una versión.");
      await tx.update(publications).set({ visibility, firstPublishedAt: pub.firstPublishedAt ?? (visibility === "PRIVATE" ? null : new Date()) }).where(eq(publications.id, pub.id));
      // Retirar la publicación revoca los enlaces compartidos.
      if (visibility === "PRIVATE") await tx.update(shareLinks).set({ revokedAt: new Date() }).where(and(eq(shareLinks.publicationId, pub.id), isNull(shareLinks.revokedAt)));
      const [fresh] = await tx.select().from(publications).where(eq(publications.id, pub.id));
      const [version] = fresh!.activeVersionId ? await tx.select().from(publicationVersions).where(eq(publicationVersions.id, fresh!.activeVersionId)) : [null];
      return this.stateOf(fresh!, version ?? null, await this.linkCount(tx, pub.id));
    });
  }

  async deletePublication(user: AuthUser, journeyId: string): Promise<{ ok: true }> {
    await this.ownedJourney(this.db, user.id, journeyId);
    await this.db.delete(publications).where(and(eq(publications.journeyId, journeyId), eq(publications.authorId, user.id)));
    return { ok: true };
  }

  /* ═════════════ Enlaces compartidos ═════════════ */

  async createShareLink(user: AuthUser, publicationId: string, expiresInDays: number | null | undefined): Promise<ShareLinkCreated> {
    const pub = await this.ownedPublication(this.db, user.id, publicationId);
    if (pub.visibility === "PRIVATE") throw badRequest("PUBLICATION_PRIVATE", "Cambia la visibilidad a «Solo con enlace» o «Comunidad» para crear enlaces.");
    if (pub.moderationStatus === "HIDDEN") throw forbidden("Esta publicación está oculta por moderación.");
    const token = randomToken();
    const expiresAt = expiresInDays ? new Date(Date.now() + expiresInDays * 86_400_000) : null;
    const [row] = await this.db.insert(shareLinks).values({ publicationId, tokenHash: sha256(token), expiresAt }).returning();
    return { id: row!.id, createdAt: row!.createdAt.toISOString(), expiresAt: expiresAt?.toISOString() ?? null, revokedAt: null, token, url: `${this.env.PUBLIC_SITE_URL}/s/${token}` };
  }

  async listShareLinks(user: AuthUser, publicationId: string): Promise<ShareLinkDto[]> {
    await this.ownedPublication(this.db, user.id, publicationId);
    const rows = await this.db.select().from(shareLinks).where(eq(shareLinks.publicationId, publicationId)).orderBy(desc(shareLinks.createdAt));
    return rows.map((r) => ({ id: r.id, createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt?.toISOString() ?? null, revokedAt: r.revokedAt?.toISOString() ?? null }));
  }

  async revokeShareLink(user: AuthUser, publicationId: string, linkId: string): Promise<{ ok: true }> {
    await this.ownedPublication(this.db, user.id, publicationId);
    await this.db.update(shareLinks).set({ revokedAt: new Date() }).where(and(eq(shareLinks.id, linkId), eq(shareLinks.publicationId, publicationId), isNull(shareLinks.revokedAt)));
    return { ok: true };
  }

  /* ═════════════ Lectura pública (DTO explícito) ═════════════ */

  private authorOf(v: VersionRow) {
    const a = v.authorDisplaySnapshot;
    return { username: a.username, displayName: a.displayName, avatarUrl: null as string | null, isDemo: a.isDemo };
  }

  /** El avatar es público si el perfil lo tiene asignado; se resuelve contra el perfil vigente. */
  private async avatarUrls(usernames: string[]): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (usernames.length === 0) return map;
    const rows = await this.db
      .select({ u: profiles.usernameNormalized, a: profiles.avatarAssetId, ver: mediaAssets.derivativeVersion })
      .from(profiles)
      .innerJoin(mediaAssets, eq(mediaAssets.id, profiles.avatarAssetId))
      .where(inArray(profiles.usernameNormalized, usernames.map((u) => u.toLowerCase())));
    for (const r of rows) map.set(r.u, assetUrl({ id: r.a!, derivativeVersion: r.ver }, "thumb"));
    return map;
  }

  private async toPublicRoute(pub: PubRow, version: VersionRow, opts: { viewerId?: string; ticketed: boolean }): Promise<PublicRouteDto> {
    const entryRows = await this.db
      .select({ e: publicationEntries })
      .from(publicationEntries)
      .where(eq(publicationEntries.versionId, version.id))
      .orderBy(asc(publicationEntries.position));
    const mediaRows = entryRows.length
      ? await this.db
          .select({ m: publicationMedia, a: mediaAssets })
          .from(publicationMedia)
          .innerJoin(mediaAssets, eq(mediaAssets.id, publicationMedia.assetId))
          .where(inArray(publicationMedia.entryId, entryRows.map((r) => r.e.id)))
          .orderBy(asc(publicationMedia.position))
      : [];
    const url = (a: { id: string; derivativeVersion: number }, variant: "thumb" | "display") => (opts.ticketed ? this.media.ticketUrl(a.id, variant, a.derivativeVersion) : assetUrl(a, variant));

    const entries: PublicEntry[] = entryRows.map(({ e }) => ({
      position: e.position,
      catalogPlaceId: e.catalogPlaceId,
      displayName: e.displayName,
      locationLabel: e.locationLabel,
      location: e.publicLocation ? { lng: e.publicLocation.lng, lat: e.publicLocation.lat } : null,
      locationPrecision: e.locationPrecision as PublicEntry["locationPrecision"],
      note: e.note,
      recommendation: e.recommendation,
      visitedDate: e.visitedLocalDate,
      media: mediaRows.filter((r) => r.m.entryId === e.id).map((r) => ({ url: url(r.a, "display"), thumbUrl: url(r.a, "thumb"), caption: r.m.caption, altText: r.m.altText })),
    }));

    let cover: PublicRouteDto["cover"] = null;
    if (version.coverAssetId) {
      const [a] = await this.db.select().from(mediaAssets).where(eq(mediaAssets.id, version.coverAssetId));
      const alt = mediaRows.find((r) => r.a.id === version.coverAssetId)?.m.altText ?? null;
      if (a) cover = { url: url(a, "display"), thumbUrl: url(a, "thumb"), altText: alt };
    }
    let bookmarked: boolean | null = null;
    if (opts.viewerId) {
      const [b] = await this.db.select().from(bookmarks).where(and(eq(bookmarks.userId, opts.viewerId), eq(bookmarks.publicationId, pub.id)));
      bookmarked = Boolean(b);
    }
    const author = this.authorOf(version);
    author.avatarUrl = (await this.avatarUrls([author.username])).get(author.username.toLowerCase()) ?? null;
    return {
      id: pub.id,
      slug: pub.slug,
      title: version.title,
      description: version.description,
      author,
      cover,
      locationLabel: version.locationLabel,
      transportSummary: version.transportSummary,
      interests: version.interestSlugs,
      durationDays: version.durationDays,
      entries,
      track: version.shareExactTrack ? (version.sanitizedTrack as [number, number][][] | null) : null,
      publishedAt: pub.firstPublishedAt?.toISOString() ?? null,
      updatedAt: version.createdAt.toISOString(),
      visibility: pub.visibility === "PUBLIC" ? "PUBLIC" : "UNLISTED",
      bookmarked,
      isDemo: version.authorDisplaySnapshot.isDemo,
    };
  }

  /** Solo para moderación: el snapshot publicado, con URLs de vida corta aunque la publicación esté oculta. */
  previewForModeration(pub: PubRow, version: VersionRow): Promise<PublicRouteDto> {
    return this.toPublicRoute(pub, version, { ticketed: true });
  }

  async routeBySlug(viewer: AuthUser | undefined, slug: string): Promise<PublicRouteDto> {
    const [row] = await this.db
      .select({ pub: publications, ver: publicationVersions })
      .from(publications)
      .innerJoin(publicationVersions, eq(publicationVersions.id, publications.activeVersionId))
      .innerJoin(users, eq(users.id, publications.authorId))
      .where(and(eq(publications.slug, slug), publicVisible));
    // Sin token una publicación UNLISTED/PRIVATE o retirada es simplemente "no disponible", sin revelar su contenido anterior.
    if (!row) throw new AppError(404, ERROR_CODES.NOT_AVAILABLE, "Esta historia no está disponible.");
    return this.toPublicRoute(row.pub, row.ver, { viewerId: viewer?.id, ticketed: false });
  }

  async routeByShareToken(viewer: AuthUser | undefined, token: string): Promise<PublicRouteDto> {
    const [row] = await this.db
      .select({ pub: publications, ver: publicationVersions })
      .from(shareLinks)
      .innerJoin(publications, eq(publications.id, shareLinks.publicationId))
      .innerJoin(publicationVersions, eq(publicationVersions.id, publications.activeVersionId))
      .innerJoin(users, eq(users.id, publications.authorId))
      .where(
        and(
          eq(shareLinks.tokenHash, sha256(token)),
          isNull(shareLinks.revokedAt),
          or(isNull(shareLinks.expiresAt), sql`${shareLinks.expiresAt} > now()`),
          eq(publications.moderationStatus, "VISIBLE"),
          sql`${publications.visibility} in ('PUBLIC','UNLISTED')`,
          eq(users.accountStatus, "ACTIVE"),
        ),
      );
    if (!row) throw new AppError(404, ERROR_CODES.NOT_AVAILABLE, "Este enlace no está disponible.");
    return this.toPublicRoute(row.pub, row.ver, { viewerId: viewer?.id, ticketed: row.pub.visibility === "UNLISTED" });
  }

  private cardFrom(r: { pub: PubRow; ver: VersionRow; stops: number; coverVersion: number | null }, avatars: Map<string, string>): PublicRouteCard {
    const author = this.authorOf(r.ver);
    return {
      id: r.pub.id,
      slug: r.pub.slug,
      title: r.ver.title,
      description: r.ver.description,
      author: { ...author, avatarUrl: avatars.get(author.username.toLowerCase()) ?? null },
      coverThumbUrl: r.ver.coverAssetId && r.coverVersion !== null ? assetUrl({ id: r.ver.coverAssetId, derivativeVersion: r.coverVersion }, "thumb") : null,
      locationLabel: r.ver.locationLabel,
      transportSummary: r.ver.transportSummary,
      interests: r.ver.interestSlugs,
      durationDays: r.ver.durationDays,
      stopsCount: r.stops,
      publishedAt: r.pub.firstPublishedAt?.toISOString() ?? null,
      isDemo: r.ver.authorDisplaySnapshot.isDemo,
    };
  }

  private cardQuery(extra: SQL[], cursor: (string | number)[] | null, limit: number) {
    const conds: SQL[] = [publicVisible, ...extra];
    if (cursor && typeof cursor[0] === "string" && typeof cursor[1] === "string") {
      conds.push(sql`(${publications.firstPublishedAt}, ${publications.id}) < (${new Date(cursor[0])}, ${cursor[1]}::uuid)`);
    }
    return this.db
      .select({
        pub: publications,
        ver: publicationVersions,
        stops: sql<number>`(select count(*)::int from publication_entries pe where pe.version_id = ${publicationVersions.id})`,
        coverVersion: mediaAssets.derivativeVersion,
      })
      .from(publications)
      .innerJoin(publicationVersions, eq(publicationVersions.id, publications.activeVersionId))
      .innerJoin(users, eq(users.id, publications.authorId))
      .leftJoin(mediaAssets, eq(mediaAssets.id, publicationVersions.coverAssetId))
      .where(and(...conds))
      .orderBy(desc(publications.firstPublishedAt), desc(publications.id))
      .limit(limit + 1);
  }

  private async pageOfCards(rows: Awaited<ReturnType<PublicationsService["cardQuery"]>>, limit: number) {
    const hasMore = rows.length > limit;
    const page = rows.slice(0, limit);
    const avatars = await this.avatarUrls(page.map((r) => r.ver.authorDisplaySnapshot.username));
    const last = page[page.length - 1];
    return {
      items: page.map((r) => this.cardFrom(r, avatars)),
      nextCursor: hasMore && last ? encodeCursor([last.pub.firstPublishedAt!.toISOString(), last.pub.id]) : null,
    };
  }

  /** Feed: solo PUBLIC + VISIBLE + versión activa. Paginación por cursor estable (fecha, id). */
  async explore(q: ExploreQuery) {
    const extra: SQL[] = [];
    if (q.q) {
      const like = `%${escapeLike(q.q)}%`;
      extra.push(sql`(unaccent(${publicationVersions.title}) ILIKE unaccent(${like}) OR unaccent(coalesce(${publicationVersions.description}, '')) ILIKE unaccent(${like}) OR unaccent(coalesce(${publicationVersions.locationLabel}, '')) ILIKE unaccent(${like}))`);
    }
    if (q.destination) extra.push(sql`unaccent(coalesce(${publicationVersions.locationLabel}, '')) ILIKE unaccent(${`%${escapeLike(q.destination)}%`})`);
    if (q.interest) extra.push(sql`${q.interest} = ANY(${publicationVersions.interestSlugs})`);
    if (q.transport) extra.push(eq(publicationVersions.transportMode, q.transport));
    if (q.pace) extra.push(eq(publicationVersions.pace, q.pace));
    if (q.minDays) extra.push(sql`${publicationVersions.durationDays} >= ${q.minDays}`);
    if (q.maxDays) extra.push(sql`${publicationVersions.durationDays} <= ${q.maxDays}`);
    const rows = await this.cardQuery(extra, decodeCursor(q.cursor), q.limit);
    return this.pageOfCards(rows, q.limit);
  }

  async publicProfile(username: string, cursor: string | undefined, limit: number): Promise<PublicProfileDto> {
    const [p] = await this.db
      .select({ p: profiles, status: users.accountStatus })
      .from(profiles)
      .innerJoin(users, eq(users.id, profiles.userId))
      .where(eq(profiles.usernameNormalized, username.toLowerCase()));
    if (!p || p.status !== "ACTIVE") throw new AppError(404, ERROR_CODES.NOT_AVAILABLE, "Este perfil no está disponible.");
    const rows = await this.cardQuery([eq(publications.authorId, p.p.userId)], decodeCursor(cursor), limit);
    const page = await this.pageOfCards(rows, limit);
    const avatar = p.p.avatarAssetId ? (await this.avatarUrls([p.p.username])).get(p.p.username.toLowerCase()) ?? null : null;
    return { username: p.p.username, displayName: p.p.displayName, bio: p.p.bio, avatarUrl: avatar, isDemo: p.p.isDemo, routes: page.items, nextCursor: page.nextCursor };
  }

  /* ═════════════ Guardados ═════════════ */

  private async publicPublication(exec: DbExecutor, publicationId: string) {
    const [row] = await exec
      .select({ pub: publications, ver: publicationVersions })
      .from(publications)
      .innerJoin(publicationVersions, eq(publicationVersions.id, publications.activeVersionId))
      .innerJoin(users, eq(users.id, publications.authorId))
      .where(and(eq(publications.id, publicationId), publicVisible));
    return row ?? null;
  }

  async addBookmark(user: AuthUser, publicationId: string): Promise<{ bookmarked: true }> {
    if (!(await this.publicPublication(this.db, publicationId))) throw new AppError(404, ERROR_CODES.NOT_AVAILABLE, "Esta historia no está disponible.");
    await this.db.insert(bookmarks).values({ userId: user.id, publicationId }).onConflictDoNothing();
    return { bookmarked: true };
  }

  async removeBookmark(user: AuthUser, publicationId: string): Promise<{ bookmarked: false }> {
    await this.db.delete(bookmarks).where(and(eq(bookmarks.userId, user.id), eq(bookmarks.publicationId, publicationId)));
    return { bookmarked: false };
  }

  async bookmarkStatus(user: AuthUser, publicationId: string): Promise<{ bookmarked: boolean }> {
    const [b] = await this.db.select().from(bookmarks).where(and(eq(bookmarks.userId, user.id), eq(bookmarks.publicationId, publicationId)));
    return { bookmarked: Boolean(b) };
  }

  /** Un guardado no amplía permisos: si la publicación dejó de ser pública se muestra «No disponible», sin su contenido anterior. */
  async listBookmarks(user: AuthUser): Promise<BookmarkItem[]> {
    const marks = await this.db.select().from(bookmarks).where(eq(bookmarks.userId, user.id)).orderBy(desc(bookmarks.createdAt));
    if (marks.length === 0) return [];
    const rows = await this.cardQuery([inArray(publications.id, marks.map((m) => m.publicationId))], null, 200);
    const page = await this.pageOfCards(rows, 200);
    const byId = new Map(page.items.map((c) => [c.id, c]));
    return marks.map((m) => {
      const card = byId.get(m.publicationId) ?? null;
      return { publicationId: m.publicationId, available: card !== null, savedAt: m.createdAt.toISOString(), card };
    });
  }

  /* ═════════════ Usar como base ═════════════ */

  /**
   * Copia SOLO las paradas permitidas a un borrador propio, con atribución. Nunca fotos, notas ni GPS.
   * Atómico e idempotente por clientMutationId.
   */
  async copy(user: AuthUser, publicationId: string, input: { clientMutationId: string; shareToken?: string }): Promise<CopyResult> {
    const [dup] = await this.db.select().from(journeys).where(and(eq(journeys.ownerId, user.id), eq(journeys.idempotencyKey, input.clientMutationId)));
    if (dup) {
      const [{ n }] = (await this.db.select({ n: sql<number>`count(*)::int` }).from(journeyStops).where(eq(journeyStops.journeyId, dup.id))) as [{ n: number }];
      return { journeyId: dup.id, stopsCopied: n, skippedStops: 0 };
    }

    let target = await this.publicPublication(this.db, publicationId);
    if (!target && input.shareToken) {
      const [viaLink] = await this.db
        .select({ pub: publications, ver: publicationVersions })
        .from(shareLinks)
        .innerJoin(publications, eq(publications.id, shareLinks.publicationId))
        .innerJoin(publicationVersions, eq(publicationVersions.id, publications.activeVersionId))
        .innerJoin(users, eq(users.id, publications.authorId))
        .where(and(eq(publications.id, publicationId), eq(shareLinks.tokenHash, sha256(input.shareToken)), isNull(shareLinks.revokedAt), or(isNull(shareLinks.expiresAt), sql`${shareLinks.expiresAt} > now()`), eq(publications.moderationStatus, "VISIBLE"), sql`${publications.visibility} in ('PUBLIC','UNLISTED')`, eq(users.accountStatus, "ACTIVE")));
      target = viaLink ?? null;
    }
    if (!target) throw new AppError(404, ERROR_CODES.NOT_AVAILABLE, "Esta historia no está disponible.");

    const entryRows = await this.db.select({ e: publicationEntries }).from(publicationEntries).where(eq(publicationEntries.versionId, target.ver.id)).orderBy(asc(publicationEntries.position));
    const [profile] = await this.db.select({ tz: profiles.timezone }).from(profiles).where(eq(profiles.userId, user.id));

    return this.db.transaction(async (tx) => {
      const [journey] = await tx
        .insert(journeys)
        .values({
          ownerId: user.id,
          title: `${target!.ver.title} (mi versión)`,
          creationMode: "MANUAL",
          planStatus: "DRAFT",
          preferencesJson: { interests: target!.ver.interestSlugs, pace: (target!.ver.pace ?? "MODERATE") as never, transport: (target!.ver.transportMode ?? "WALK") as never, destinationLabel: target!.ver.locationLabel ?? undefined },
          sourcePublicationId: target!.pub.id,
          idempotencyKey: input.clientMutationId,
        })
        .returning({ id: journeys.id });

      const groups = new Map<string, typeof entryRows>();
      for (const r of entryRows) groups.set(r.e.visitedLocalDate ?? "", [...(groups.get(r.e.visitedLocalDate ?? "") ?? []), r]);
      const keys = [...groups.keys()].sort();
      let copied = 0;
      let skipped = 0;
      let dayPos = 0;
      for (const key of keys) {
        const group = groups.get(key)!;
        const stops: { placeId: string; snapshot: PlaceSnapshot }[] = [];
        for (const { e } of group) {
          let placeId: string | null = null;
          let snapshot: PlaceSnapshot | null = null;
          if (e.catalogPlaceId) {
            const [cat] = await tx.select().from(places).where(and(eq(places.id, e.catalogPlaceId), eq(places.scope, "CATALOG")));
            if (cat) {
              placeId = cat.id;
              snapshot = { name: cat.name, description: cat.description, lng: cat.location.lng, lat: cat.location.lat, locality: cat.locality, region: cat.region, countryCode: cat.countryCode, address: cat.address, scope: "CATALOG" };
            }
          }
          if (!placeId && e.publicLocation) {
            const [created] = await tx
              .insert(places)
              .values({ scope: "PERSONAL", ownerId: user.id, name: e.displayName, location: { lng: e.publicLocation.lng, lat: e.publicLocation.lat }, locality: e.locationLabel?.split(",")[0]?.trim() ?? null })
              .returning();
            placeId = created!.id;
            snapshot = { name: created!.name, description: null, lng: created!.location.lng, lat: created!.location.lat, locality: created!.locality, region: null, countryCode: null, address: null, scope: "PERSONAL" };
          }
          if (placeId && snapshot) stops.push({ placeId, snapshot });
          else skipped++;
        }
        if (stops.length === 0) continue;
        const [day] = await tx
          .insert(journeyDays)
          .values({ journeyId: journey!.id, position: dayPos++, timezone: profile?.tz ?? "UTC", destinationLabel: target!.ver.locationLabel })
          .returning({ id: journeyDays.id });
        for (const [i, s] of stops.entries()) {
          await tx.insert(journeyStops).values({ journeyId: journey!.id, dayId: day!.id, placeId: s.placeId, position: i, placeSnapshotJson: s.snapshot });
          copied++;
        }
      }
      return { journeyId: journey!.id, stopsCopied: copied, skippedStops: skipped };
    });
  }

  /* ═════════════ Reportes y moderación ═════════════ */

  async report(user: AuthUser, input: { publicationId: string; reason: string; detail?: string | null }): Promise<{ ok: true }> {
    if (!(await this.publicPublication(this.db, input.publicationId))) throw new AppError(404, ERROR_CODES.NOT_AVAILABLE, "Esta historia no está disponible.");
    await this.db
      .insert(reports)
      .values({ reporterId: user.id, publicationId: input.publicationId, reason: input.reason, detail: input.detail ?? null })
      .onConflictDoNothing();
    return { ok: true };
  }
}
