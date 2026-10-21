import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createUploadInputSchema, updateMediaInputSchema, type CreateUploadInput } from "@por-aqui/contracts";
import type { Response } from "express";
import { z } from "zod";
import { Api, type AuthUser, CurrentUser, OptionalUser, Public, RateLimit } from "../../common/decorators";
import { ParsedQuery } from "../../common/zod-input.interceptor";
import { MediaService } from "./media.service";

const uuid = () => new ParseUUIDPipe();
const contentQuery = z.object({ variant: z.enum(["thumb", "display"]).default("display"), v: z.coerce.number().optional(), t: z.string().max(200).optional() });

@ApiTags("media")
@Controller()
export class MediaController {
  constructor(private readonly media: MediaService) {}

  @Post("visits/:id/media/uploads")
  @HttpCode(201)
  @RateLimit({ key: "upload", limit: 120, windowSec: 600 })
  @Api({ summary: "Reservar subida: devuelve un POST prefirmado de corta duración con límite de tamaño", body: createUploadInputSchema, status: 201 })
  reserve(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Body() body: CreateUploadInput) {
    return this.media.reserveVisitUpload(user, id, body);
  }

  @Post("me/avatar/uploads")
  @HttpCode(201)
  @RateLimit({ key: "upload", limit: 120, windowSec: 600 })
  @Api({ summary: "Reservar subida de avatar", body: createUploadInputSchema, status: 201 })
  reserveAvatar(@CurrentUser() user: AuthUser, @Body() body: CreateUploadInput) {
    return this.media.reserveAvatarUpload(user, body);
  }

  @Post("media/:id/complete")
  @HttpCode(200)
  @Api({ summary: "Confirmar la subida (idempotente). El worker deja la foto READY tras verificarla." })
  complete(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.media.complete(user, id);
  }

  @Get("media/:id")
  @Api({ summary: "Estado de procesamiento de una foto propia" })
  status(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.media.get(user, id);
  }

  @Post("media/:id/retry")
  @HttpCode(200)
  @Api({ summary: "Reintentar el procesamiento de una foto con error recuperable" })
  retry(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.media.retry(user, id);
  }

  @Patch("media/:id")
  @Api({ summary: "Editar el pie de foto", body: updateMediaInputSchema })
  caption(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Body() body: { caption?: string | null }) {
    return this.media.setCaption(user, id, body.caption ?? null);
  }

  @Delete("media/:id")
  @Api({ summary: "Eliminar foto (409 MEDIA_IN_PUBLICATION si una publicación la usa)" })
  remove(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.media.delete(user, id);
  }

  /**
   * Contenido: SOLO derivados (miniatura / lectura); nunca el original. La autorización se evalúa en cada petición.
   */
  @Public()
  @Get("media/:id/content")
  @Api({ summary: "Bytes de un derivado, previa autorización (dueño, publicación visible, avatar o ticket vigente)", query: contentQuery })
  async content(@OptionalUser() user: AuthUser | undefined, @Param("id", uuid()) id: string, @ParsedQuery() q: z.infer<typeof contentQuery>, @Res() res: Response) {
    const { asset, publicCache } = await this.media.authorizeRead(user, id, q.t);
    const { stream, size } = await this.media.openContent(asset, q.variant);
    res.setHeader("Content-Type", "image/webp");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Cache-Control", publicCache ? "public, max-age=300" : "private, max-age=300");
    if (size !== null) res.setHeader("Content-Length", String(size));
    stream.on("error", () => res.destroy());
    stream.pipe(res);
  }
}
