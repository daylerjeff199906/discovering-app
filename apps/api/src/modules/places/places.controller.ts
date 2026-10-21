import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { createPlaceInputSchema, geocodeQuerySchema, placeSearchQuerySchema, type CreatePlaceInput, type PlaceSearchQuery } from "@por-aqui/contracts";
import { z } from "zod";
import { Api, type AuthUser, CurrentUser, OptionalUser, Public } from "../../common/decorators";
import { ParsedQuery } from "../../common/zod-input.interceptor";
import { PlacesService } from "./places.service";

@ApiTags("places")
@Controller("places")
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Public()
  @Get("search")
  @Api({ summary: "Buscar lugares (catálogo + lugares personales propios)", query: placeSearchQuerySchema })
  search(@OptionalUser() user: AuthUser | undefined, @ParsedQuery() q: PlaceSearchQuery) {
    return this.places.search(user, q);
  }

  @Public()
  @Get("destinations")
  @Api({ summary: "Destinos con lugares en el catálogo", query: z.object({ q: z.string().max(80).optional() }) })
  destinations(@ParsedQuery() q: { q?: string }) {
    return this.places.destinations(q.q);
  }

  @Get("geocode")
  @Api({ summary: "Geocodificación (solo si hay proveedor configurado)", query: geocodeQuerySchema })
  geocode(@ParsedQuery() q: { q: string }) {
    return this.places.geocode(q.q);
  }

  @Post()
  @HttpCode(201)
  @Api({ summary: "Crear un lugar personal (privado)", body: createPlaceInputSchema, status: 201 })
  async create(@CurrentUser() user: AuthUser, @Body() body: CreatePlaceInput) {
    const row = await this.places.createPersonal(user, body);
    return this.places.toDto(row, []);
  }

  @Public()
  @Get(":id")
  @Api({ summary: "Detalle de un lugar accesible" })
  get(@OptionalUser() user: AuthUser | undefined, @Param("id", ParseUUIDPipe) id: string) {
    return this.places.getDto(user, id);
  }
}
