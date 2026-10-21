import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  createVisitInputSchema,
  finishRecordingInputSchema,
  trackBatchInputSchema,
  updateVisitInputSchema,
  type CreateVisitInput,
  type FinishRecordingInput,
  type TrackBatchInput,
  type UpdateVisitInput,
} from "@por-aqui/contracts";
import type { Response } from "express";
import { Api, type AuthUser, CurrentUser } from "../../common/decorators";
import { RecordingsService } from "./recordings.service";

const uuid = () => new ParseUUIDPipe();

@ApiTags("recordings")
@Controller()
export class RecordingsController {
  constructor(private readonly recordings: RecordingsService) {}

  @Get("journeys/:id/recording")
  @Api({ summary: "Ejecución del viaje: { recording } (null si no se inició)" })
  async get(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return { recording: await this.recordings.get(user, id) };
  }

  @Post("journeys/:id/recording/start")
  @HttpCode(200)
  @Api({ summary: "Iniciar (idempotente)" })
  start(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.recordings.start(user, id);
  }

  @Post("journeys/:id/recording/pause")
  @HttpCode(200)
  @Api({ summary: "Pausar: cierra los segmentos de trayecto abiertos" })
  pause(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.recordings.pause(user, id);
  }

  @Post("journeys/:id/recording/resume")
  @HttpCode(200)
  @Api({ summary: "Reanudar" })
  resume(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.recordings.resume(user, id);
  }

  @Post("journeys/:id/recording/finish")
  @HttpCode(200)
  @Api({ summary: "Finalizar con conciliación de watermarks (idempotente)", body: finishRecordingInputSchema })
  finish(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Body() body: FinishRecordingInput) {
    return this.recordings.finish(user, id, body);
  }

  @Get("journeys/:id/visits")
  @Api({ summary: "Visitas del viaje en orden cronológico" })
  journeyVisits(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.recordings.listJourneyVisits(user, id);
  }

  @Get("recordings/:id/visits")
  @Api({ summary: "Visitas de una ejecución" })
  visits(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.recordings.listVisits(user, id);
  }

  @Post("recordings/:id/visits")
  @Api({ summary: "Registrar visita (idempotente por clientMutationId; 201 nueva, 200 repetida)", body: createVisitInputSchema, status: 201 })
  async createVisit(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Body() body: CreateVisitInput, @Res({ passthrough: true }) res: Response) {
    const { visit, created } = await this.recordings.createVisit(user, id, body);
    res.status(created ? 201 : 200);
    return visit;
  }

  @Post("recordings/:id/track-batches")
  @HttpCode(200)
  @Api({ summary: "Lote idempotente de puntos GPS (único por segmento+secuencia)", body: trackBatchInputSchema })
  trackBatch(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Body() body: TrackBatchInput) {
    return this.recordings.trackBatch(user, id, body);
  }

  @Get("recordings/:id/track")
  @Api({ summary: "Trayecto registrado (solo el dueño)" })
  track(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.recordings.getTrack(user, id);
  }

  @Get("visits/:id")
  @Api({ summary: "Detalle de visita" })
  visit(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.recordings.getVisit(user, id);
  }

  @Patch("visits/:id")
  @Api({ summary: "Editar visita (fecha, nota); 409 si la versión cambió", body: updateVisitInputSchema })
  updateVisit(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Body() body: UpdateVisitInput) {
    return this.recordings.updateVisit(user, id, body);
  }

  @Delete("visits/:id")
  @Api({ summary: "Eliminar visita (409 si alguna foto está en una publicación)" })
  deleteVisit(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.recordings.deleteVisit(user, id);
  }
}
