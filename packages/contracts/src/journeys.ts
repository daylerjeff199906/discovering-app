import { z } from "zod";
import { localDateSchema, paceSchema, timezoneSchema, transportModeSchema, uuidSchema } from "./common";
import { placeSnapshotSchema } from "./places";

export const CREATION_MODES = ["AUTOMATIC", "MANUAL", "FREE"] as const;
export const creationModeSchema = z.enum(CREATION_MODES);
export type CreationMode = z.infer<typeof creationModeSchema>;

/** Estado visible derivado de plan + ejecución + archivo (una sola máquina de estados). */
export const JOURNEY_STATUSES = ["DRAFT", "PLANNED", "IN_PROGRESS", "PAUSED", "COMPLETED", "ARCHIVED"] as const;
export const journeyStatusSchema = z.enum(JOURNEY_STATUSES);
export type JourneyStatus = z.infer<typeof journeyStatusSchema>;

export const journeyPreferencesSchema = z.object({
  interests: z.array(z.string().max(40)).max(20).default([]),
  availableMinutesPerDay: z.number().int().min(30).max(1440).optional(),
  pace: paceSchema.default("MODERATE"),
  transport: transportModeSchema.default("WALK"),
  budget: z
    .object({
      minMinor: z.number().int().min(0).optional(),
      maxMinor: z.number().int().min(0).optional(),
      currency: z.string().length(3).optional(),
    })
    .optional(),
  destinationLabel: z.string().trim().max(120).optional(),
  start: z.object({ label: z.string().max(120).optional(), lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }).optional(),
  startDate: localDateSchema.optional(),
  endDate: localDateSchema.optional(),
});
export type JourneyPreferences = z.infer<typeof journeyPreferencesSchema>;

export const stopDtoSchema = z.object({
  id: uuidSchema,
  dayId: uuidSchema,
  position: z.number().int(),
  placeId: uuidSchema,
  visitDurationSeconds: z.number().int().nullable(),
  place: placeSnapshotSchema,
  version: z.number().int(),
});
export type StopDto = z.infer<typeof stopDtoSchema>;

export const dayDtoSchema = z.object({
  id: uuidSchema,
  position: z.number().int(),
  localDate: z.string().nullable(),
  timezone: z.string(),
  destinationLabel: z.string().nullable(),
  stops: z.array(stopDtoSchema),
});
export type DayDto = z.infer<typeof dayDtoSchema>;

export const LEG_QUALITIES = ["PROVIDER", "ESTIMATED", "MANUAL", "UNKNOWN"] as const;
export const legDtoSchema = z.object({
  id: uuidSchema,
  fromStopId: uuidSchema,
  toStopId: uuidSchema,
  mode: transportModeSchema,
  distanceM: z.number().nullable(),
  durationS: z.number().int().nullable(),
  source: z.string(),
  quality: z.enum(LEG_QUALITIES),
  stale: z.boolean(),
});
export type LegDto = z.infer<typeof legDtoSchema>;

export const recordingDtoSchema = z.object({
  id: uuidSchema,
  journeyId: uuidSchema,
  status: z.enum(["ACTIVE", "PAUSED", "COMPLETED"]),
  startedAt: z.string(),
  pausedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  version: z.number().int(),
  trackWatermarks: z.record(z.string(), z.number().int()),
});
export type RecordingDto = z.infer<typeof recordingDtoSchema>;

export const journeyDtoSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  creationMode: creationModeSchema,
  planStatus: z.enum(["DRAFT", "READY"]),
  status: journeyStatusSchema,
  preferences: journeyPreferencesSchema,
  version: z.number().int(),
  archivedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  sourcePublicationId: uuidSchema.nullable(),
  days: z.array(dayDtoSchema),
  legs: z.array(legDtoSchema),
  recording: recordingDtoSchema.nullable(),
  visitsCount: z.number().int(),
});
export type JourneyDto = z.infer<typeof journeyDtoSchema>;

export const journeySummaryDtoSchema = z.object({
  id: uuidSchema,
  title: z.string(),
  status: journeyStatusSchema,
  creationMode: creationModeSchema,
  destinationLabel: z.string().nullable(),
  stopsCount: z.number().int(),
  visitsCount: z.number().int(),
  updatedAt: z.string(),
  publicationSlug: z.string().nullable(),
  publicationVisibility: z.enum(["PRIVATE", "UNLISTED", "PUBLIC"]).nullable(),
});
export type JourneySummaryDto = z.infer<typeof journeySummaryDtoSchema>;

export const createJourneyInputSchema = z.object({
  title: z.string().trim().min(1, "Ponle un título").max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  creationMode: creationModeSchema,
  preferences: journeyPreferencesSchema.optional(),
  timezone: timezoneSchema.optional(),
  daysCount: z.number().int().min(0).max(30).optional(),
});
export type CreateJourneyInput = z.infer<typeof createJourneyInputSchema>;

export const updateJourneyInputSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  preferences: journeyPreferencesSchema.optional(),
  planStatus: z.enum(["DRAFT", "READY"]).optional(),
  expectedVersion: z.number().int().min(1),
});
export type UpdateJourneyInput = z.infer<typeof updateJourneyInputSchema>;

export const createDayInputSchema = z.object({
  localDate: localDateSchema.nullable().optional(),
  timezone: timezoneSchema.optional(),
  destinationLabel: z.string().trim().max(120).nullable().optional(),
  expectedVersion: z.number().int().min(1),
});
export const updateDayInputSchema = z.object({
  localDate: localDateSchema.nullable().optional(),
  timezone: timezoneSchema.optional(),
  destinationLabel: z.string().trim().max(120).nullable().optional(),
  expectedVersion: z.number().int().min(1),
});

export const createStopInputSchema = z.object({
  dayId: uuidSchema,
  placeId: uuidSchema,
  visitDurationSeconds: z.number().int().min(60).max(86400).nullable().optional(),
  expectedVersion: z.number().int().min(1),
});
export type CreateStopInput = z.infer<typeof createStopInputSchema>;

export const updateStopInputSchema = z.object({
  visitDurationSeconds: z.number().int().min(60).max(86400).nullable().optional(),
  expectedVersion: z.number().int().min(1),
});

export const reorderInputSchema = z.object({
  layout: z.array(z.object({ dayId: uuidSchema, stopIds: z.array(uuidSchema) })).max(60),
  expectedVersion: z.number().int().min(1),
});
export type ReorderInput = z.infer<typeof reorderInputSchema>;

export const versionedDeleteQuerySchema = z.object({ expectedVersion: z.coerce.number().int().min(1) });

export const journeyListQuerySchema = z.object({
  status: journeyStatusSchema.optional(),
  includeArchived: z.enum(["true", "false"]).default("false"),
});

export const setLegInputSchema = z.object({
  fromStopId: uuidSchema,
  toStopId: uuidSchema,
  mode: transportModeSchema,
  durationS: z.number().int().min(0).max(86400 * 14).nullable(),
  expectedVersion: z.number().int().min(1),
});

/** ── Planificación automática ───────────────────────────────── */
export const proposalInputSchema = z.object({
  destinationLabel: z.string().trim().min(1).max(120),
  center: z.object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) }).optional(),
  radiusM: z.number().int().min(500).max(100000).default(15000),
  daysCount: z.number().int().min(1).max(14).default(1),
  availableMinutesPerDay: z.number().int().min(60).max(1440).default(480),
  interests: z.array(z.string().max(40)).max(20).default([]),
  transport: transportModeSchema.default("WALK"),
  pace: paceSchema.default("MODERATE"),
  start: z.object({ lng: z.number(), lat: z.number(), label: z.string().max(120).optional() }).optional(),
  startDate: localDateSchema.optional(),
  expectedVersion: z.number().int().min(1),
});
export type ProposalInput = z.infer<typeof proposalInputSchema>;

export const proposalStopSchema = z.object({
  placeId: uuidSchema,
  place: placeSnapshotSchema,
  visitDurationSeconds: z.number().int(),
  durationEstimated: z.boolean(),
  hoursKnown: z.boolean(),
  matchedInterests: z.array(z.string()),
});
export const proposalLegSchema = z.object({
  fromPlaceId: uuidSchema,
  toPlaceId: uuidSchema,
  mode: transportModeSchema,
  distanceM: z.number().nullable(),
  durationS: z.number().int().nullable(),
  source: z.string(),
  quality: z.enum(LEG_QUALITIES),
});
export const proposalDtoSchema = z.object({
  journeyVersion: z.number().int(),
  destinationLabel: z.string(),
  days: z.array(z.object({ localDate: z.string().nullable(), stops: z.array(proposalStopSchema), legs: z.array(proposalLegSchema), plannedSeconds: z.number().int() })),
  partial: z.boolean(),
  warnings: z.array(z.object({ code: z.string(), message: z.string() })),
  dataSources: z.array(z.string()),
});
export type ProposalDto = z.infer<typeof proposalDtoSchema>;

export const applyProposalInputSchema = z.object({
  proposal: proposalDtoSchema,
  expectedVersion: z.number().int().min(1),
});
