import { z } from "zod";
const image = z.string().max(1000).refine((v) => /^\/images\/[\w./-]+$/.test(v) || /^https:\/\/[^\s]+$/.test(v), "Usa una imagen de /images/ o una URL HTTPS");
export const catalogCitySchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/).max(80), name: z.string().trim().min(1).max(100), region: z.string().max(100), country: z.string().max(100), countryCode: z.string().regex(/^[A-Z]{2}$/).default("PE"),
  description: z.string().max(1000), imageUrl: image, lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), enabled: z.boolean(),
  highlights: z.array(z.string().max(100)).max(6),
});
export const catalogPlaceSchema = z.object({
  id: z.uuid(), cityId: z.string().max(80), name: z.string().trim().min(1).max(120), description: z.string().max(1000),
  category: z.string().max(100), imageUrl: image, lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180),
  enabled: z.boolean(), interests: z.array(z.string().max(40)).max(20),
});
export const travelCatalogSchema = z.object({
  revision: z.number().int().min(0),
  modes: z.array(z.object({ id: z.enum(["auto", "manual", "libre"]), title: z.string().min(1).max(90), body: z.string().max(500), image: image })).length(3).default([
    { id: "auto", title: "Armar automáticamente", body: "Cuéntanos qué te gusta y te propondremos un camino. Podrás darle tu toque antes de salir.", image: "/images/explore-freely-iquitos.webp" },
    { id: "manual", title: "Armar manualmente", body: "Elige cada lugar y organiza las paradas a tu manera.", image: "/images/follow-route-iquitos.webp" },
    { id: "libre", title: "Registrar mientras exploro", body: "Guarda tus visitas, fotos y recuerdos sobre la marcha.", image: "/images/explore-freely-iquitos.webp" },
  ]),
  banner: z.object({ title: z.string().min(1).max(180), subtitle: z.string().max(300), planLabel: z.string().min(1).max(70), recordLabel: z.string().min(1).max(70) }),
  cities: z.array(catalogCitySchema).min(1).max(100), places: z.array(catalogPlaceSchema).max(1000),
}).superRefine((v, ctx) => {
  if (new Set(v.cities.map((c) => c.id)).size !== v.cities.length || new Set(v.places.map((p) => p.id)).size !== v.places.length) ctx.addIssue({ code: "custom", message: "Los identificadores deben ser únicos" });
  if (new Set(v.modes.map((m) => m.id)).size !== 3) ctx.addIssue({ code: "custom", message: "Configura las tres formas de crear un viaje" });
  if (!v.cities.some((c) => c.enabled)) ctx.addIssue({ code: "custom", message: "Activa al menos una ciudad" });
  if (v.places.some((p) => !v.cities.some((c) => c.id === p.cityId))) ctx.addIssue({ code: "custom", message: "Cada lugar debe pertenecer a una ciudad" });
});
export type TravelCatalog = z.infer<typeof travelCatalogSchema>;
export type CatalogCity = z.infer<typeof catalogCitySchema>;
export type CatalogPlace = z.infer<typeof catalogPlaceSchema>;
