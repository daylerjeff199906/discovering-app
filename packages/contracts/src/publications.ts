import { z } from "zod";
import { cursorQuerySchema, paceSchema, transportModeSchema, uuidSchema } from "./common";

export const VISIBILITIES = ["PRIVATE", "UNLISTED", "PUBLIC"] as const;
export const visibilitySchema = z.enum(VISIBILITIES);
export type Visibility = z.infer<typeof visibilitySchema>;
export const LOCATION_PRECISIONS = ["EXACT", "APPROXIMATE", "HIDDEN"] as const;
export const locationPrecisionSchema = z.enum(LOCATION_PRECISIONS);
export type LocationPrecision = z.infer<typeof locationPrecisionSchema>;

export const publishEntryInputSchema = z.object({
  visitId: uuidSchema,
  includeNote: z.boolean().default(false),
  /** La recomendación de la visita solo se publica si el autor lo elige. Gasto y transporte nunca se publican. */
  includeRecommendation: z.boolean().default(false),
  locationPrecision: locationPrecisionSchema.default("EXACT"),
  media: z
    .array(z.object({ assetId: uuidSchema, caption: z.string().trim().max(300).nullable().optional(), altText: z.string().trim().max(300).nullable().optional() }))
    .max(20)
    .default([]),
});

export const publishInputSchema = z.object({
  title: z.string().trim().min(1, "Ponle un título").max(120),
  description: z.string().trim().max(2000).nullable().optional(),
  visibility: visibilitySchema,
  coverAssetId: uuidSchema.nullable().optional(),
  locationLabel: z.string().trim().max(120).nullable().optional(),
  transportSummary: z.string().trim().max(120).nullable().optional(),
  shareExactTrack: z.boolean().default(false),
  entries: z.array(publishEntryInputSchema).min(1, "Elige al menos una visita").max(100),
  expectedRevision: z.number().int().min(0).optional(),
});
export type PublishInput = z.infer<typeof publishInputSchema>;

export const publicationStateDtoSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  visibility: visibilitySchema,
  moderationStatus: z.enum(["VISIBLE", "HIDDEN"]),
  revision: z.number().int().nullable(),
  firstPublishedAt: z.string().nullable(),
  updatedAt: z.string(),
  activeLinkCount: z.number().int(),
  /** Selección vigente, para precargar el editor de publicación. */
  current: publishInputSchema.omit({ expectedRevision: true }).nullable(),
});
export type PublicationStateDto = z.infer<typeof publicationStateDtoSchema>;

export const publicationCandidateSchema = z.object({
  visitId: uuidSchema,
  placeName: z.string(),
  visitedAt: z.string(),
  timezone: z.string(),
  note: z.string().nullable(),
  recommendation: z.string().nullable(),
  media: z.array(z.object({ id: uuidSchema, thumbUrl: z.string().nullable(), displayUrl: z.string().nullable(), caption: z.string().nullable() })),
});
export const publicationDraftDtoSchema = z.object({
  journeyId: uuidSchema,
  journeyTitle: z.string(),
  canPublish: z.boolean(),
  blockedReason: z.string().nullable(),
  publication: publicationStateDtoSchema.nullable(),
  candidates: z.array(publicationCandidateSchema),
  hasTrack: z.boolean(),
});
export type PublicationDraftDto = z.infer<typeof publicationDraftDtoSchema>;

export const setVisibilityInputSchema = z.object({ visibility: visibilitySchema });

export const shareLinkDtoSchema = z.object({ id: uuidSchema, createdAt: z.string(), expiresAt: z.string().nullable(), revokedAt: z.string().nullable() });
export const createShareLinkInputSchema = z.object({ expiresInDays: z.number().int().min(1).max(365).nullable().optional() });
export const shareLinkCreatedSchema = shareLinkDtoSchema.extend({ token: z.string(), url: z.string() });
export type ShareLinkDto = z.infer<typeof shareLinkDtoSchema>;
export type ShareLinkCreated = z.infer<typeof shareLinkCreatedSchema>;

/** ── DTO público: únicamente campos permitidos ───────────────── */
export const publicMediaSchema = z.object({ url: z.string(), thumbUrl: z.string(), caption: z.string().nullable(), altText: z.string().nullable() });
export const publicEntrySchema = z.object({
  position: z.number().int(),
  catalogPlaceId: uuidSchema.nullable(),
  displayName: z.string(),
  locationLabel: z.string().nullable(),
  location: z.object({ lng: z.number(), lat: z.number() }).nullable(),
  locationPrecision: locationPrecisionSchema,
  note: z.string().nullable(),
  recommendation: z.string().nullable(),
  visitedDate: z.string().nullable(),
  media: z.array(publicMediaSchema),
});
export type PublicEntry = z.infer<typeof publicEntrySchema>;

export const publicAuthorSchema = z.object({ username: z.string(), displayName: z.string(), avatarUrl: z.string().nullable(), isDemo: z.boolean() });

export const publicRouteDtoSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  author: publicAuthorSchema,
  cover: z.object({ url: z.string(), thumbUrl: z.string(), altText: z.string().nullable() }).nullable(),
  locationLabel: z.string().nullable(),
  transportSummary: z.string().nullable(),
  interests: z.array(z.string()),
  durationDays: z.number().int().nullable(),
  entries: z.array(publicEntrySchema),
  track: z.array(z.array(z.tuple([z.number(), z.number()]))).nullable(),
  publishedAt: z.string().nullable(),
  updatedAt: z.string(),
  visibility: z.enum(["UNLISTED", "PUBLIC"]),
  bookmarked: z.boolean().nullable(),
  isDemo: z.boolean(),
});
export type PublicRouteDto = z.infer<typeof publicRouteDtoSchema>;

export const publicRouteCardSchema = z.object({
  id: uuidSchema,
  slug: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  author: publicAuthorSchema,
  coverThumbUrl: z.string().nullable(),
  locationLabel: z.string().nullable(),
  transportSummary: z.string().nullable(),
  interests: z.array(z.string()),
  durationDays: z.number().int().nullable(),
  stopsCount: z.number().int(),
  publishedAt: z.string().nullable(),
  isDemo: z.boolean(),
});
export type PublicRouteCard = z.infer<typeof publicRouteCardSchema>;

export const exploreQuerySchema = cursorQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  destination: z.string().trim().max(100).optional(),
  interest: z.string().max(40).optional(),
  transport: transportModeSchema.optional(),
  pace: paceSchema.optional(),
  minDays: z.coerce.number().int().min(1).max(60).optional(),
  maxDays: z.coerce.number().int().min(1).max(60).optional(),
});
export type ExploreQuery = z.infer<typeof exploreQuerySchema>;

export const publicProfileDtoSchema = z.object({
  username: z.string(),
  displayName: z.string(),
  bio: z.string().nullable(),
  avatarUrl: z.string().nullable(),
  isDemo: z.boolean(),
  routes: z.array(publicRouteCardSchema),
  nextCursor: z.string().nullable(),
});
export type PublicProfileDto = z.infer<typeof publicProfileDtoSchema>;

export const copyPublicationInputSchema = z.object({
  clientMutationId: z.string().min(8).max(64),
  shareToken: z.string().max(200).optional(),
});
export const copyResultSchema = z.object({ journeyId: uuidSchema, skippedStops: z.number().int(), stopsCopied: z.number().int() });
export type CopyResult = z.infer<typeof copyResultSchema>;

export const bookmarkInputSchema = z.object({ publicationId: uuidSchema });
export const bookmarkItemSchema = z.object({
  publicationId: uuidSchema,
  available: z.boolean(),
  savedAt: z.string(),
  card: publicRouteCardSchema.nullable(),
});
export type BookmarkItem = z.infer<typeof bookmarkItemSchema>;

export const REPORT_REASONS = ["INAPPROPRIATE", "PRIVACY", "SPAM", "COPYRIGHT", "OTHER"] as const;
export const createReportInputSchema = z.object({
  publicationId: uuidSchema,
  reason: z.enum(REPORT_REASONS),
  detail: z.string().trim().max(1000).nullable().optional(),
});
export const reportDtoSchema = z.object({
  id: uuidSchema,
  publicationId: uuidSchema,
  publicationSlug: z.string(),
  publicationTitle: z.string().nullable(),
  moderationStatus: z.enum(["VISIBLE", "HIDDEN"]),
  reason: z.string(),
  detail: z.string().nullable(),
  status: z.enum(["OPEN", "RESOLVED", "DISMISSED"]),
  createdAt: z.string(),
});
export type ReportDto = z.infer<typeof reportDtoSchema>;
export const moderationActionInputSchema = z.object({
  action: z.enum(["HIDE", "RESTORE"]),
  reason: z.string().trim().min(5, "Indica el motivo (mínimo 5 caracteres)").max(500),
  reportId: uuidSchema.optional(),
  resolveReport: z.enum(["RESOLVED", "DISMISSED"]).optional(),
});
export type ModerationActionInput = z.infer<typeof moderationActionInputSchema>;
