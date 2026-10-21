import { z } from "zod";
import { uuidSchema } from "./common";

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MEDIA_STATUSES = ["PENDING", "UPLOADED", "PROCESSING", "READY", "FAILED"] as const;

export const assetDtoSchema = z.object({
  id: uuidSchema,
  status: z.enum(MEDIA_STATUSES),
  failureCode: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  thumbUrl: z.string().nullable(),
  displayUrl: z.string().nullable(),
  position: z.number().int(),
  caption: z.string().nullable(),
});
export type AssetDto = z.infer<typeof assetDtoSchema>;

export const createUploadInputSchema = z.object({
  mimeType: z.enum(ACCEPTED_IMAGE_TYPES, { error: "Formato no admitido. Usa JPEG, PNG o WebP." }),
  sizeBytes: z.number().int().min(1),
  fileName: z.string().max(200).optional(),
});
export type CreateUploadInput = z.infer<typeof createUploadInputSchema>;

export const uploadAuthorizationSchema = z.object({
  assetId: uuidSchema,
  method: z.literal("POST"),
  url: z.string(),
  fields: z.record(z.string(), z.string()),
  expiresAt: z.string(),
});
export type UploadAuthorization = z.infer<typeof uploadAuthorizationSchema>;

export const updateMediaInputSchema = z.object({ caption: z.string().trim().max(300).nullable().optional() });
