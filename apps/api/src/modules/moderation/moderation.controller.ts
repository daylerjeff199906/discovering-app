import { Body, Controller, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { moderationActionInputSchema, type ModerationActionInput, type PublicRouteDto, type ReportDto } from "@por-aqui/contracts";
import { moderationActions, publicationVersions, publications, reports, type Db } from "@por-aqui/database";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { Api, type AuthUser, CurrentUser, Roles } from "../../common/decorators";
import { notFound } from "../../common/errors";
import { ParsedQuery } from "../../common/zod-input.interceptor";
import { DB } from "../../infrastructure/tokens";
import { PublicationsService } from "../publications/publications.service";

const listQuery = z.object({ status: z.enum(["OPEN", "RESOLVED", "DISMISSED"]).default("OPEN") });

/**
 * La moderación solo ve reportes y el SNAPSHOT publicado; no tiene acceso general a diarios privados.
 */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly pubs: PublicationsService,
  ) {}

  async listReports(status: "OPEN" | "RESOLVED" | "DISMISSED"): Promise<ReportDto[]> {
    const rows = await this.db
      .select({ r: reports, p: publications, v: publicationVersions })
      .from(reports)
      .innerJoin(publications, eq(publications.id, reports.publicationId))
      .leftJoin(publicationVersions, eq(publicationVersions.id, publications.activeVersionId))
      .where(eq(reports.status, status))
      .orderBy(desc(reports.createdAt))
      .limit(200);
    return rows.map(({ r, p, v }) => ({
      id: r.id,
      publicationId: p.id,
      publicationSlug: p.slug,
      publicationTitle: v?.title ?? null,
      moderationStatus: p.moderationStatus as "VISIBLE" | "HIDDEN",
      reason: r.reason,
      detail: r.detail,
      status: r.status as ReportDto["status"],
      createdAt: r.createdAt.toISOString(),
    }));
  }

  async preview(publicationId: string): Promise<PublicRouteDto> {
    const [row] = await this.db
      .select({ pub: publications, ver: publicationVersions })
      .from(publications)
      .innerJoin(publicationVersions, eq(publicationVersions.id, publications.activeVersionId))
      .where(eq(publications.id, publicationId));
    if (!row) throw notFound("Esta publicación no tiene contenido publicado.");
    return this.pubs.previewForModeration(row.pub, row.ver);
  }

  async act(moderator: AuthUser, publicationId: string, input: ModerationActionInput): Promise<{ ok: true; moderationStatus: "VISIBLE" | "HIDDEN" }> {
    const status = input.action === "HIDE" ? "HIDDEN" : "VISIBLE";
    await this.db.transaction(async (tx) => {
      const updated = await tx.update(publications).set({ moderationStatus: status }).where(eq(publications.id, publicationId)).returning({ id: publications.id });
      if (updated.length === 0) throw notFound("No encontramos esa publicación.");
      await tx.insert(moderationActions).values({ moderatorId: moderator.id, publicationId, reportId: input.reportId ?? null, action: input.action, reason: input.reason });
      if (input.reportId && input.resolveReport) {
        await tx.update(reports).set({ status: input.resolveReport }).where(and(eq(reports.id, input.reportId), eq(reports.publicationId, publicationId)));
      }
    });
    return { ok: true, moderationStatus: status };
  }
}

@ApiTags("moderation")
@Roles("MODERATOR")
@Controller("moderation")
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get("reports")
  @Api({ summary: "Reportes (solo moderadores)", query: listQuery })
  reports(@ParsedQuery() q: z.infer<typeof listQuery>) {
    return this.moderation.listReports(q.status);
  }

  @Get("publications/:id/preview")
  @Api({ summary: "Vista previa del snapshot publicado, incluso si está oculto" })
  preview(@Param("id", new ParseUUIDPipe()) id: string) {
    return this.moderation.preview(id);
  }

  @Post("publications/:id/actions")
  @HttpCode(200)
  @Api({ summary: "Ocultar / restituir con motivo (auditado)", body: moderationActionInputSchema })
  act(@CurrentUser() user: AuthUser, @Param("id", new ParseUUIDPipe()) id: string, @Body() body: ModerationActionInput) {
    return this.moderation.act(user, id, body);
  }
}

