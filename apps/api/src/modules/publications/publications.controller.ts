import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  bookmarkInputSchema,
  copyPublicationInputSchema,
  createReportInputSchema,
  createShareLinkInputSchema,
  exploreQuerySchema,
  publishInputSchema,
  setVisibilityInputSchema,
  type ExploreQuery,
  type PublishInput,
} from "@por-aqui/contracts";
import { z } from "zod";
import { Api, type AuthUser, CurrentUser, OptionalUser, Public, RateLimit, RequireVerified } from "../../common/decorators";
import { ParsedQuery } from "../../common/zod-input.interceptor";
import { PublicationsService } from "./publications.service";

const uuid = () => new ParseUUIDPipe();
const profileQuery = z.object({ cursor: z.string().max(300).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) });

/** Autor: publicar, visibilidad y enlaces. */
@ApiTags("publications")
@Controller()
export class PublicationsController {
  constructor(private readonly pubs: PublicationsService) {}

  @Get("journeys/:id/publication")
  @Api({ summary: "Vista previa de publicación: candidatos (visitas/fotos/notas) y estado actual" })
  draft(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.pubs.getDraft(user, id);
  }

  @Put("journeys/:id/publication")
  @RequireVerified()
  @Api({ summary: "Publicar o actualizar: crea una instantánea sanitizada (solo cuenta verificada y recorrido finalizado)", body: publishInputSchema })
  publish(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Body() body: PublishInput) {
    return this.pubs.publish(user, id, body);
  }

  @Delete("journeys/:id/publication")
  @Api({ summary: "Eliminar la publicación (no borra la visita privada)" })
  remove(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.pubs.deletePublication(user, id);
  }

  @Put("publications/:id/visibility")
  @RequireVerified()
  @Api({ summary: "Cambiar visibilidad PRIVATE / UNLISTED / PUBLIC (PRIVATE retira y revoca enlaces)", body: setVisibilityInputSchema })
  visibility(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Body() body: z.infer<typeof setVisibilityInputSchema>) {
    return this.pubs.setVisibility(user, id, body.visibility);
  }

  @Get("publications/:id/share-links")
  @Api({ summary: "Enlaces compartidos (el token solo se muestra al crearlo)" })
  links(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.pubs.listShareLinks(user, id);
  }

  @Post("publications/:id/share-links")
  @HttpCode(201)
  @RequireVerified()
  @Api({ summary: "Crear enlace revocable", body: createShareLinkInputSchema, status: 201 })
  createLink(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Body() body: z.infer<typeof createShareLinkInputSchema>) {
    return this.pubs.createShareLink(user, id, body.expiresInDays);
  }

  @Delete("publications/:id/share-links/:linkId")
  @Api({ summary: "Revocar enlace" })
  revokeLink(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Param("linkId", uuid()) linkId: string) {
    return this.pubs.revokeShareLink(user, id, linkId);
  }

  @Post("publications/:id/copy")
  @HttpCode(201)
  @Api({ summary: "Usar como base: copia paradas permitidas a un borrador propio (sin fotos, notas ni GPS)", body: copyPublicationInputSchema, status: 201 })
  copy(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Body() body: z.infer<typeof copyPublicationInputSchema>) {
    return this.pubs.copy(user, id, body);
  }
}

/** Lectura pública. Cada respuesta es un DTO explícito de campos permitidos. */
@ApiTags("public")
@Controller()
export class PublicController {
  constructor(private readonly pubs: PublicationsService) {}

  @Public()
  @Get("public/explore")
  @Api({ summary: "Recorridos públicos (PUBLIC + VISIBLE), paginación por cursor", query: exploreQuerySchema })
  explore(@ParsedQuery() q: ExploreQuery) {
    return this.pubs.explore(q);
  }

  @Public()
  @Get("public/routes/:slug")
  @Api({ summary: "Historia pública por slug" })
  route(@OptionalUser() user: AuthUser | undefined, @Param("slug") slug: string) {
    return this.pubs.routeBySlug(user, slug);
  }

  @Public()
  @Get("public/profiles/:username")
  @Api({ summary: "Perfil público y sus historias públicas", query: profileQuery })
  profile(@Param("username") username: string, @ParsedQuery() q: z.infer<typeof profileQuery>) {
    return this.pubs.publicProfile(username, q.cursor, q.limit);
  }

  @Public()
  @Get("shared/:token")
  @RateLimit({ key: "shared", limit: 120, windowSec: 60 })
  @Api({ summary: "Historia por enlace (UNLISTED); noindex/no-store en la capa web" })
  shared(@OptionalUser() user: AuthUser | undefined, @Param("token") token: string) {
    return this.pubs.routeByShareToken(user, token);
  }
}

@ApiTags("bookmarks")
@Controller("bookmarks")
export class BookmarksController {
  constructor(private readonly pubs: PublicationsService) {}

  @Get()
  @Api({ summary: "Mis guardados (los no disponibles aparecen sin contenido)" })
  list(@CurrentUser() user: AuthUser) {
    return this.pubs.listBookmarks(user);
  }

  @Post()
  @HttpCode(201)
  @Api({ summary: "Guardar inspiración (idempotente)", body: bookmarkInputSchema, status: 201 })
  add(@CurrentUser() user: AuthUser, @Body() body: z.infer<typeof bookmarkInputSchema>) {
    return this.pubs.addBookmark(user, body.publicationId);
  }

  @Get(":publicationId")
  @Api({ summary: "¿Está guardada?" })
  status(@CurrentUser() user: AuthUser, @Param("publicationId", uuid()) id: string) {
    return this.pubs.bookmarkStatus(user, id);
  }

  @Delete(":publicationId")
  @Api({ summary: "Quitar guardado" })
  remove(@CurrentUser() user: AuthUser, @Param("publicationId", uuid()) id: string) {
    return this.pubs.removeBookmark(user, id);
  }
}

@ApiTags("reports")
@Controller("reports")
export class ReportsController {
  constructor(private readonly pubs: PublicationsService) {}

  @Post()
  @HttpCode(201)
  @RateLimit({ key: "report", limit: 10, windowSec: 3600 })
  @Api({ summary: "Reportar una publicación (crea una tarea de moderación)", body: createReportInputSchema, status: 201 })
  create(@CurrentUser() user: AuthUser, @Body() body: z.infer<typeof createReportInputSchema>) {
    return this.pubs.report(user, body);
  }
}
