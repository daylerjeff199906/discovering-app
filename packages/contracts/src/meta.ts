import { z } from "zod";

export const capabilitiesDtoSchema = z.object({
  appEnv: z.enum(["development", "demo", "production"]),
  demoContent: z.boolean(),
  routing: z.object({ available: z.boolean(), provider: z.string().nullable(), modes: z.array(z.string()) }),
  geocoder: z.object({ available: z.boolean(), provider: z.string().nullable() }),
  media: z.object({ maxBytes: z.number().int(), maxPerVisit: z.number().int(), mimeTypes: z.array(z.string()) }),
  track: z.object({ maxAccuracyM: z.number(), minDistanceM: z.number() }),
});
export type CapabilitiesDto = z.infer<typeof capabilitiesDtoSchema>;
