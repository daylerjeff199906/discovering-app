import { Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Put } from "@nestjs/common";
import { travelCatalogSchema, type TravelCatalog } from "@por-aqui/contracts";
import { catalogContent, places, savedPlaces, interests, placeInterests, type Db } from "@por-aqui/database";
import { and, eq, inArray } from "drizzle-orm";
import { Api, CurrentUser, Public, Roles, type AuthUser } from "../../common/decorators";
import { badRequest, versionConflict } from "../../common/errors";
import { DB } from "../../infrastructure/tokens";
import { PlacesService } from "./places.service";

@Controller("catalog")
export class CatalogController {
  constructor(@Inject(DB) private readonly db: Db, private readonly placeService: PlacesService) {}

  private async load(): Promise<TravelCatalog> {
    const [stored] = await this.db.select().from(catalogContent).where(eq(catalogContent.key, "travel"));
    if (stored) return travelCatalogSchema.parse(stored.data);
    const rows = await this.db.select().from(places).where(eq(places.scope, "CATALOG"));
    const tags = await this.placeService.interestsFor(rows.map((p) => p.id));
    const defaults = travelCatalogSchema.parse({
      revision: 0,
      banner: { title: "¿Dónde empieza tu próxima historia?", subtitle: "Destinos reales. Experiencias memorables.", planLabel: "Planear una aventura", recordLabel: "Registrar mi aventura" },
      cities: [{ id: "iquitos", name: "Iquitos", region: "Loreto", country: "Perú", description: "Calles llenas de historia, paseos junto al río y naturaleza amazónica. Descubre Iquitos y guarda tu propia historia.", imageUrl: "/images/iquitos-malecon.jpg", lat: -3.7491, lng: -73.2538, enabled: true, highlights: ["Amazonía peruana", "Cultura viva", "Paseos junto al río"] }],
      places: rows.filter((p) => p.locality === "Iquitos").map((p) => ({ id: p.id, cityId: "iquitos", name: p.name, description: p.description ?? "", category: "Lugar de interés", imageUrl: /bel[eé]n/i.test(p.name) ? "/images/iquitos-belen.jpg" : /malec|laguna|rescate/i.test(p.name) ? "/images/iquitos-malecon.jpg" : "/images/iquitos-plaza.jpg", lat: p.location.lat, lng: p.location.lng, enabled: true, interests: tags.get(p.id) ?? [] })),
    });
    await this.db.insert(catalogContent).values({ key: "travel", data: defaults }).onConflictDoNothing();
    const [current] = await this.db.select().from(catalogContent).where(eq(catalogContent.key, "travel"));
    return travelCatalogSchema.parse(current!.data);
  }

  @Public()
  @Get()
  @Api({ summary: "Ciudades, lugares y presentación del portal" })
  async get() {
    const c = await this.load();
    const cities = c.cities.filter((v) => v.enabled);
    return { ...c, cities, places: c.places.filter((p) => p.enabled && cities.some((city) => city.id === p.cityId)) };
  }

  @Get("admin")
  @Roles("MODERATOR")
  @Api({ summary: "Administrar el catálogo y el banner" })
  admin() { return this.load(); }

  @Put("admin")
  @Roles("MODERATOR")
  @Api({ summary: "Guardar ciudades, lugares y banner", body: travelCatalogSchema })
  async save(@Body() body: TravelCatalog) {
    await this.load();
    return this.db.transaction(async (tx) => {
      const [current] = await tx.select().from(catalogContent).where(eq(catalogContent.key, "travel")).for("update");
      const revision = travelCatalogSchema.parse(current!.data).revision;
      if (revision !== body.revision) throw versionConflict(revision);
      const allInterests = await tx.select().from(interests);
      for (const p of body.places) {
        const city = body.cities.find((c) => c.id === p.cityId)!;
        const values = { name: p.name, description: p.description, locality: city.name, region: city.region, countryCode: city.countryCode, location: { lng: p.lng, lat: p.lat } };
        const result = await tx.insert(places).values({ id: p.id, scope: "CATALOG", ...values }).onConflictDoUpdate({ target: places.id, set: values, setWhere: eq(places.scope, "CATALOG") }).returning({ id: places.id });
        if (!result.length) throw badRequest("INVALID_PLACE", "Ese identificador pertenece a un lugar personal.");
        if (p.interests.some((tag) => !allInterests.some((i) => i.slug === tag))) throw badRequest("INVALID_INTEREST", "Hay un interés desconocido.");
        await tx.delete(placeInterests).where(eq(placeInterests.placeId, p.id));
        const selected = allInterests.filter((i) => p.interests.includes(i.slug));
        if (selected.length) await tx.insert(placeInterests).values(selected.map((i) => ({ placeId: p.id, interestId: i.id })));
      }
      const data = { ...body, revision: revision + 1 };
      await tx.update(catalogContent).set({ data }).where(eq(catalogContent.key, "travel"));
      return data;
    });
  }

  @Get("saved-places")
  @Api({ summary: "Lugares guardados por mí" })
  async saved(@CurrentUser() user: AuthUser) {
    const rows = await this.db.select({ id: savedPlaces.placeId }).from(savedPlaces).where(eq(savedPlaces.userId, user.id));
    if (!rows.length) return [];
    const records = await this.db.select().from(places).where(inArray(places.id, rows.map((r) => r.id)));
    const tags = await this.placeService.interestsFor(records.map((p) => p.id));
    return records.map((p) => this.placeService.toDto(p, tags.get(p.id) ?? []));
  }

  @Put("saved-places/:id")
  @Api({ summary: "Guardar un lugar" })
  async savePlace(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.placeService.getDto(user, id);
    await this.db.insert(savedPlaces).values({ userId: user.id, placeId: id }).onConflictDoNothing();
    return { ok: true };
  }

  @Delete("saved-places/:id")
  @Api({ summary: "Quitar un lugar guardado" })
  async unsave(@CurrentUser() user: AuthUser, @Param("id", ParseUUIDPipe) id: string) {
    await this.db.delete(savedPlaces).where(and(eq(savedPlaces.userId, user.id), eq(savedPlaces.placeId, id)));
    return { ok: true };
  }
}
