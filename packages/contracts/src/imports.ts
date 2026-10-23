import { z } from "zod";
import { isoInstantSchema, timezoneSchema, uuidSchema } from "./common";

/** Formatos reconocidos al importar (se detectan por el contenido, no por la extensión). */
export const IMPORT_FORMATS = ["GPX", "KML", "TAKEOUT_TIMELINE", "TAKEOUT_PLACES"] as const;
export const importFormatSchema = z.enum(IMPORT_FORMATS);
export type ImportFormat = z.infer<typeof importFormatSchema>;

/** Códigos de error propios de la importación (la UI muestra el mensaje del servidor). */
export const IMPORT_ERROR_CODES = {
  NO_FILE: "IMPORT_NO_FILE",
  TOO_LARGE: "IMPORT_TOO_LARGE",
  UNSUPPORTED: "IMPORT_UNSUPPORTED_FORMAT",
  INVALID: "IMPORT_INVALID_FILE",
  EMPTY: "IMPORT_EMPTY",
  TOO_MANY_POINTS: "IMPORT_TOO_MANY_POINTS",
  TOO_MANY_WAYPOINTS: "IMPORT_TOO_MANY_WAYPOINTS",
} as const;

/**
 * Opciones de importación. Llegan como campos de texto del formulario multipart, por eso
 * los booleanos admiten "true"/"false" y las cadenas vacías se tratan como ausentes.
 */
const emptyToUndefined = (v: unknown) => (v === "" || v === null ? undefined : v);
export const importOptionsSchema = z.object({
  /** Título de la aventura; si falta se deduce del archivo. */
  title: z.preprocess(emptyToUndefined, z.string().trim().min(1).max(120).optional()),
  timezone: z.preprocess(emptyToUndefined, timezoneSchema.optional()),
  /** Importar también los waypoints/lugares como visitas. */
  importWaypoints: z.preprocess((v) => (v === "false" ? false : v === "true" ? true : v), z.boolean().default(true)),
  /** Limita lo importado a un rango de fechas (instantes ISO). Útil con Takeout, que mezcla meses o años. */
  from: z.preprocess(emptyToUndefined, isoInstantSchema.optional()),
  to: z.preprocess(emptyToUndefined, isoInstantSchema.optional()),
  /** Fecha de inicio para archivos sin marcas de tiempo (p. ej. un LineString de KML). */
  startAt: z.preprocess(emptyToUndefined, isoInstantSchema.optional()),
});
export type ImportOptions = z.infer<typeof importOptionsSchema>;
export type ImportOptionsInput = z.input<typeof importOptionsSchema>;

export const importWaypointPreviewSchema = z.object({
  name: z.string(),
  lng: z.number(),
  lat: z.number(),
  at: z.string().nullable(),
});

/** Vista previa: lo que se importaría, sin guardar nada. */
export const importPreviewSchema = z.object({
  format: importFormatSchema,
  suggestedTitle: z.string(),
  /** Puntos GPS que quedarían tras el filtrado por precisión y distancia mínima. */
  pointsCount: z.number().int(),
  /** Puntos leídos del archivo que se descartaron (precisión, repetidos, fechas futuras o fuera de rango). */
  pointsDiscarded: z.number().int(),
  segmentsCount: z.number().int(),
  distanceM: z.number(),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  /** false si el archivo no trae fechas: se generan a partir de `startAt` o de la fecha de importación. */
  hasTimestamps: z.boolean(),
  waypointsCount: z.number().int(),
  /** Primeros waypoints, para revisarlos antes de confirmar. */
  waypoints: z.array(importWaypointPreviewSchema),
  bounds: z.object({ minLng: z.number(), minLat: z.number(), maxLng: z.number(), maxLat: z.number() }).nullable(),
  warnings: z.array(z.string()),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;

export const importResultSchema = z.object({
  journeyId: uuidSchema,
  recordingId: uuidSchema,
  pointsCount: z.number().int(),
  visitsCount: z.number().int(),
  placesCreated: z.number().int(),
  placesReused: z.number().int(),
  warnings: z.array(z.string()),
});
export type ImportResult = z.infer<typeof importResultSchema>;
