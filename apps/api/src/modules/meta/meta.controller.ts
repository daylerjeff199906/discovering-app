import { Controller, Get, Inject, ServiceUnavailableException } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { CapabilitiesDto, InterestDto } from "@por-aqui/contracts";
import { interests, type Db } from "@por-aqui/database";
import type { Redis } from "ioredis";
import { sql } from "drizzle-orm";
import { Api, Public } from "../../common/decorators";
import { ENV, type Env } from "../../config/env";
import { RoutingPort } from "../../infrastructure/geo/providers";
import { GeocoderPort } from "../../infrastructure/geo/providers";
import { DB, REDIS } from "../../infrastructure/tokens";

@ApiTags("meta")
@Controller()
export class MetaController {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
    private readonly routing: RoutingPort,
    private readonly geocoder: GeocoderPort,
  ) {}

  @Public()
  @Get("meta/capabilities")
  @Api({ summary: "Qué proveedores y límites están disponibles (para degradar la UI con honestidad)" })
  capabilities(): CapabilitiesDto {
    const modes = (["WALK", "BIKE", "CAR", "TRANSIT", "BOAT", "FLIGHT", "OTHER"] as const).filter((m) => this.routing.supports(m));
    return {
      appEnv: this.env.APP_ENV,
      demoContent: this.env.ENABLE_DEMO_CONTENT,
      routing: { available: this.routing.available, provider: this.routing.name, modes },
      geocoder: { available: this.geocoder.name !== null, provider: this.geocoder.name },
      media: { maxBytes: this.env.MEDIA_MAX_BYTES, maxPerVisit: this.env.MEDIA_MAX_PER_VISIT, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
      auth: { google: Boolean(this.env.GOOGLE_CLIENT_ID && this.env.GOOGLE_CLIENT_SECRET) },
      track: { maxAccuracyM: this.env.TRACK_MAX_ACCURACY_M, minDistanceM: this.env.TRACK_MIN_DISTANCE_M },
      import: { maxBytes: this.env.IMPORT_MAX_BYTES, maxPoints: this.env.IMPORT_MAX_POINTS, maxWaypoints: this.env.IMPORT_MAX_WAYPOINTS },
    };
  }

  @Public()
  @Get("meta/interests")
  @Api({ summary: "Intereses disponibles" })
  async interests(): Promise<InterestDto[]> {
    const rows = await this.db.select().from(interests).orderBy(interests.labelEs);
    return rows.map((r) => ({ slug: r.slug, label: r.labelEs }));
  }

  @Public()
  @Get("health/live")
  @Api({ summary: "Liveness" })
  live() {
    return { status: "ok" };
  }

  @Public()
  @Get("health/ready")
  @Api({ summary: "Readiness: base de datos y Redis" })
  async ready() {
    try {
      await this.db.execute(sql`select 1`);
      await this.redis.ping();
    } catch {
      throw new ServiceUnavailableException("No disponible");
    }
    return { status: "ready" };
  }
}
