import { z } from "zod";

export const uuidSchema = z.uuid();

export const TRANSPORT_MODES = ["WALK", "BIKE", "CAR", "TRANSIT", "BOAT", "FLIGHT", "OTHER"] as const;
export const transportModeSchema = z.enum(TRANSPORT_MODES);
export type TransportMode = z.infer<typeof transportModeSchema>;

export const PACES = ["RELAXED", "MODERATE", "INTENSE"] as const;
export const paceSchema = z.enum(PACES);
export type Pace = z.infer<typeof paceSchema>;

export const geoPointSchema = z.object({
  lng: z.number().min(-180).max(180),
  lat: z.number().min(-90).max(90),
});
export type GeoPoint = z.infer<typeof geoPointSchema>;

/** Fecha de calendario sin hora (YYYY-MM-DD). */
export const localDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");

/** Zona IANA; se valida contra Intl cuando está disponible. */
export const timezoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Zona horaria inválida");

export const isoInstantSchema = z.iso.datetime({ offset: true });

export const cursorQuerySchema = z.object({
  cursor: z.string().max(300).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export const pageOf = <T extends z.ZodType>(item: T) =>
  z.object({ items: z.array(item), nextCursor: z.string().nullable() });

export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
  requestId: z.string().optional(),
  details: z.unknown().optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export const okSchema = z.object({ ok: z.literal(true) });

/** Códigos de error estables (la UI decide mensajes y acciones a partir de ellos). */
export const ERROR_CODES = {
  VALIDATION: "VALIDATION_ERROR",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  CONFLICT: "VERSION_CONFLICT",
  EMAIL_NOT_VERIFIED: "EMAIL_NOT_VERIFIED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  RATE_LIMITED: "RATE_LIMITED",
  CSRF: "CSRF_INVALID",
  TOKEN_INVALID: "TOKEN_INVALID",
  TOKEN_EXPIRED: "TOKEN_EXPIRED",
  RECORDING_CLOSED: "RECORDING_CLOSED",
  PENDING_TRACK_DATA: "PENDING_TRACK_DATA",
  MEDIA_IN_PUBLICATION: "MEDIA_IN_PUBLICATION",
  MEDIA_LIMIT: "MEDIA_LIMIT",
  UNSUPPORTED_MEDIA: "UNSUPPORTED_MEDIA",
  PROVIDER_UNAVAILABLE: "PROVIDER_UNAVAILABLE",
  NOT_AVAILABLE: "NOT_AVAILABLE",
  INTERNAL: "INTERNAL_ERROR",
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export const TERMS_VERSION = "2026-10-beta";
