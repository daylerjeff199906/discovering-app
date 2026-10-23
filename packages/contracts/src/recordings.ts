import { z } from "zod";
import { geoPointSchema, isoInstantSchema, timezoneSchema, transportModeSchema, uuidSchema } from "./common";
import { placeSnapshotSchema } from "./places";
import { assetDtoSchema } from "./media";

export const visitDtoSchema = z.object({
  id: uuidSchema,
  recordingId: uuidSchema,
  journeyId: uuidSchema,
  stopId: uuidSchema.nullable(),
  placeId: uuidSchema,
  place: placeSnapshotSchema,
  visitedAt: z.string(),
  endedAt: z.string().nullable(),
  timezone: z.string(),
  note: z.string().nullable(),
  /** Gasto opcional (unidad menor + moneda ISO). Privado: nunca se publica. */
  expenseMinor: z.number().int().nullable(),
  expenseCurrency: z.string().nullable(),
  transportMode: transportModeSchema.nullable(),
  /** Consejo para quien visite el lugar; solo se publica si el autor lo elige. */
  recommendation: z.string().nullable(),
  media: z.array(assetDtoSchema),
  version: z.number().int(),
  clientMutationId: z.string(),
});
export type VisitDto = z.infer<typeof visitDtoSchema>;

const newPlaceSchema = geoPointSchema.extend({
  name: z.string().trim().min(1, "Requerido").max(120),
  description: z.string().trim().max(500).nullable().optional(),
  locality: z.string().trim().max(120).nullable().optional(),
  region: z.string().trim().max(120).nullable().optional(),
  countryCode: z.string().length(2).nullable().optional(),
});

/** Campos opcionales de una visita. El gasto exige monto Y moneda a la vez (o ninguno). */
const visitExtrasShape = {
  expenseMinor: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
  expenseCurrency: z
    .string()
    .trim()
    .length(3)
    .transform((v) => v.toUpperCase())
    .nullable()
    .optional(),
  transportMode: transportModeSchema.nullable().optional(),
  recommendation: z.string().trim().max(1000).nullable().optional(),
};
const expensePaired = (v: { expenseMinor?: number | null; expenseCurrency?: string | null }) => (v.expenseMinor == null) === (v.expenseCurrency == null);
const expensePairedMessage = { path: ["expenseMinor"], message: "Indica el monto y la moneda del gasto" };

export const createVisitInputSchema = z
  .object({
    clientMutationId: z.string().min(8).max(64),
    placeId: uuidSchema.optional(),
    newPlace: newPlaceSchema.optional(),
    stopId: uuidSchema.nullable().optional(),
    visitedAt: isoInstantSchema,
    timezone: timezoneSchema,
    note: z.string().trim().max(4000).nullable().optional(),
    ...visitExtrasShape,
    /** Permite añadir una visita pasada a un recorrido ya finalizado (edición explícita). */
    retroactive: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.placeId) !== Boolean(v.newPlace), { path: ["placeId"], message: "Indica un lugar existente o uno nuevo" })
  .refine(expensePaired, expensePairedMessage);
export type CreateVisitInput = z.infer<typeof createVisitInputSchema>;

export const updateVisitInputSchema = z
  .object({
    visitedAt: isoInstantSchema.optional(),
    endedAt: isoInstantSchema.nullable().optional(),
    timezone: timezoneSchema.optional(),
    note: z.string().trim().max(4000).nullable().optional(),
    ...visitExtrasShape,
    expectedVersion: z.number().int().min(1),
  })
  .refine(expensePaired, expensePairedMessage);
export type UpdateVisitInput = z.infer<typeof updateVisitInputSchema>;

export const trackPointInputSchema = z.object({
  seq: z.number().int().min(0),
  recordedAt: isoInstantSchema,
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
  accuracyM: z.number().min(0).max(100000).nullable().optional(),
});
export const trackBatchInputSchema = z.object({
  segmentClientId: z.string().min(4).max(64),
  startedAt: isoInstantSchema,
  points: z.array(trackPointInputSchema).min(1).max(500),
});
export type TrackBatchInput = z.infer<typeof trackBatchInputSchema>;

export const trackBatchResultSchema = z.object({
  accepted: z.number().int(),
  duplicates: z.number().int(),
  rejected: z.number().int(),
  watermark: z.number().int(),
});
export type TrackBatchResult = z.infer<typeof trackBatchResultSchema>;

export const finishRecordingInputSchema = z.object({
  /** Última secuencia confirmada por el cliente para cada segmento. */
  watermarks: z.record(z.string(), z.number().int().min(0)).default({}),
  /** Descarta explícitamente los puntos que el cliente no logró sincronizar. */
  discardPending: z.boolean().optional(),
});
export type FinishRecordingInput = z.infer<typeof finishRecordingInputSchema>;

export const trackDtoSchema = z.object({
  segments: z.array(
    z.object({
      id: uuidSchema,
      clientSegmentId: z.string(),
      startedAt: z.string(),
      endedAt: z.string().nullable(),
      points: z.array(z.object({ seq: z.number().int(), recordedAt: z.string(), lng: z.number(), lat: z.number(), accuracyM: z.number().nullable() })),
    }),
  ),
});
export type TrackDto = z.infer<typeof trackDtoSchema>;
