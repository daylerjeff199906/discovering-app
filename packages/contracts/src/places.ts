import { z } from "zod";
import { geoPointSchema, timezoneSchema, uuidSchema } from "./common";

export const PLACE_SCOPES = ["CATALOG", "PERSONAL"] as const;

/** Copia privada del lugar guardada en paradas y visitas (no cambia si el catálogo cambia). */
export const placeSnapshotSchema = z.object({
  name: z.string(),
  description: z.string().nullable(),
  lng: z.number(),
  lat: z.number(),
  locality: z.string().nullable(),
  region: z.string().nullable(),
  countryCode: z.string().nullable(),
  address: z.string().nullable(),
  scope: z.enum(PLACE_SCOPES),
});
export type PlaceSnapshot = z.infer<typeof placeSnapshotSchema>;

export const placeDtoSchema = placeSnapshotSchema.extend({
  id: uuidSchema,
  interests: z.array(z.string()),
  typicalVisitMinutes: z.number().int().nullable(),
  timezone: z.string().nullable(),
  openingHours: z.record(z.string(), z.array(z.tuple([z.string(), z.string()]))).nullable(),
  provider: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  distanceM: z.number().nullable(),
});
export type PlaceDto = z.infer<typeof placeDtoSchema>;

export const createPlaceInputSchema = geoPointSchema.extend({
  name: z.string().trim().min(1, "Requerido").max(120),
  description: z.string().trim().max(500).nullable().optional(),
  locality: z.string().trim().max(120).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  countryCode: z
    .string()
    .length(2)
    .transform((v) => v.toUpperCase())
    .nullable()
    .optional(),
  address: z.string().trim().max(200).nullable().optional(),
  timezone: timezoneSchema.nullable().optional(),
});
export type CreatePlaceInput = z.infer<typeof createPlaceInputSchema>;

export const placeSearchQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  radiusM: z.coerce.number().int().min(100).max(500000).optional(),
  countryCode: z.string().length(2).optional(),
  locality: z.string().max(120).optional(),
  interest: z.string().max(40).optional(),
  scope: z.enum(["all", "catalog", "mine"]).default("all"),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type PlaceSearchQuery = z.infer<typeof placeSearchQuerySchema>;

export const geocodeQuerySchema = z.object({ q: z.string().trim().min(2).max(120) });
export const geocodeResultSchema = z.object({
  available: z.boolean(),
  provider: z.string().nullable(),
  results: z.array(
    z.object({ label: z.string(), lng: z.number(), lat: z.number(), countryCode: z.string().nullable(), locality: z.string().nullable(), region: z.string().nullable() }),
  ),
});
export type GeocodeResult = z.infer<typeof geocodeResultSchema>;
