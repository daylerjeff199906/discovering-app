import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  createDayInputSchema,
  createJourneyInputSchema,
  createStopInputSchema,
  journeyListQuerySchema,
  reorderInputSchema,
  setLegInputSchema,
  updateDayInputSchema,
  updateJourneyInputSchema,
  updateStopInputSchema,
  versionedDeleteQuerySchema,
  type CreateJourneyInput,
  type CreateStopInput,
  type ReorderInput,
  type UpdateJourneyInput,
} from "@por-aqui/contracts";
import { z } from "zod";
import { Api, type AuthUser, CurrentUser } from "../../common/decorators";
import { ParsedQuery } from "../../common/zod-input.interceptor";
import { JourneysService } from "./journeys.service";

const uuid = () => new ParseUUIDPipe();

@ApiTags("journeys")
@Controller("journeys")
export class JourneysController {
  constructor(private readonly journeys: JourneysService) {}

  @Get()
  @Api({ summary: "Mis viajes", query: journeyListQuerySchema })
  list(@CurrentUser() user: AuthUser, @ParsedQuery() q: z.infer<typeof journeyListQuerySchema>) {
    return this.journeys.list(user, { status: q.status, includeArchived: q.includeArchived === "true" });
  }

  @Post()
  @HttpCode(201)
  @Api({ summary: "Crear viaje (automático, manual o libre)", body: createJourneyInputSchema, status: 201 })
  create(@CurrentUser() user: AuthUser, @Body() body: CreateJourneyInput) {
    return this.journeys.create(user, body);
  }

  @Get(":id")
  @Api({ summary: "Detalle del viaje con días, paradas, tramos y ejecución" })
  get(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.journeys.get(user, id);
  }

  @Delete(":id")
  @Api({ summary: "Eliminar mi viaje y sus recuerdos y publicación" })
  delete(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.journeys.delete(user, id);
  }

  @Patch(":id")
  @Api({ summary: "Editar datos/preferencias (control optimista por versión)", body: updateJourneyInputSchema })
  update(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Body() body: UpdateJourneyInput) {
    return this.journeys.update(user, id, body);
  }

  @Post(":id/duplicate")
  @HttpCode(201)
  @Api({ summary: "Duplicar plan (sin visitas ni recuerdos)", status: 201 })
  duplicate(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.journeys.duplicate(user, id);
  }

  @Post(":id/archive")
  @HttpCode(200)
  @Api({ summary: "Archivar" })
  archive(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.journeys.setArchived(user, id, true);
  }

  @Post(":id/unarchive")
  @HttpCode(200)
  @Api({ summary: "Desarchivar" })
  unarchive(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.journeys.setArchived(user, id, false);
  }

  @Post(":id/days")
  @HttpCode(201)
  @Api({ summary: "Añadir día", body: createDayInputSchema, status: 201 })
  addDay(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Body() body: z.infer<typeof createDayInputSchema>) {
    return this.journeys.addDay(user, id, body);
  }

  @Patch(":id/days/:dayId")
  @Api({ summary: "Editar día", body: updateDayInputSchema })
  updateDay(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Param("dayId", uuid()) dayId: string, @Body() body: z.infer<typeof updateDayInputSchema>) {
    return this.journeys.updateDay(user, id, dayId, body);
  }

  @Delete(":id/days/:dayId")
  @Api({ summary: "Quitar día", query: versionedDeleteQuerySchema })
  deleteDay(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Param("dayId", uuid()) dayId: string, @ParsedQuery() q: { expectedVersion: number }) {
    return this.journeys.deleteDay(user, id, dayId, q.expectedVersion);
  }

  @Post(":id/stops")
  @HttpCode(201)
  @Api({ summary: "Añadir parada", body: createStopInputSchema, status: 201 })
  addStop(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Body() body: CreateStopInput) {
    return this.journeys.addStop(user, id, body);
  }

  @Patch(":id/stops/:stopId")
  @Api({ summary: "Editar parada (duración de visita)", body: updateStopInputSchema })
  updateStop(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Param("stopId", uuid()) stopId: string, @Body() body: z.infer<typeof updateStopInputSchema>) {
    return this.journeys.updateStop(user, id, stopId, body);
  }

  @Delete(":id/stops/:stopId")
  @Api({ summary: "Quitar parada (las visitas registradas se conservan)", query: versionedDeleteQuerySchema })
  deleteStop(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Param("stopId", uuid()) stopId: string, @ParsedQuery() q: { expectedVersion: number }) {
    return this.journeys.deleteStop(user, id, stopId, q.expectedVersion);
  }

  @Post(":id/reorder")
  @HttpCode(200)
  @Api({ summary: "Reordenar el plan completo (días y paradas) en una transacción", body: reorderInputSchema })
  reorder(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Body() body: ReorderInput) {
    return this.journeys.reorder(user, id, body);
  }

  @Put(":id/legs")
  @Api({ summary: "Fijar a mano un tramo (p. ej. barco o vuelo) con duración opcional", body: setLegInputSchema })
  setLeg(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string, @Body() body: z.infer<typeof setLegInputSchema>) {
    return this.journeys.setManualLeg(user, id, body);
  }

  @Post(":id/legs/recalculate")
  @HttpCode(200)
  @Api({ summary: "Recalcular tramos con el proveedor de rutas (no sobrescribe si el viaje cambió)" })
  recalc(@CurrentUser() user: AuthUser, @Param("id", uuid()) id: string) {
    return this.journeys.recalculateLegs(user, id);
  }
}
