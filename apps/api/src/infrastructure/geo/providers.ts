import type { GeocodeResult, TransportMode } from "@por-aqui/contracts";
import type { Env } from "../../config/env";
import { haversineM } from "../../common/geo";

export interface LngLat {
  lng: number;
  lat: number;
}

export interface Matrix {
  /** durations[i][j] en segundos; null = desconocido */
  durations: (number | null)[][];
  distances: (number | null)[][];
  source: string;
  quality: "PROVIDER" | "ESTIMATED";
}

/**
 * Puerto de rutas. Una geocodificación NO calcula una ruta, y la distancia en línea recta NUNCA se
 * presenta como trayecto caminable: sin proveedor, el resultado es `null` ("Por definir").
 */
export abstract class RoutingPort {
  abstract readonly name: string | null;
  abstract supports(mode: TransportMode): boolean;
  abstract matrix(points: LngLat[], mode: TransportMode): Promise<Matrix | null>;
  get available(): boolean {
    return this.name !== null;
  }
}

class NoRouting extends RoutingPort {
  readonly name = null;
  supports() {
    return false;
  }
  async matrix() {
    return null;
  }
}

/** Proveedor determinista SOLO para pruebas/demo: velocidades fijas y factor de rodeo. Se marca ESTIMATED. */
class FixtureRouting extends RoutingPort {
  readonly name = "fixture";
  private static SPEEDS: Partial<Record<TransportMode, number>> = { WALK: 1.25, BIKE: 4.2, CAR: 9, TRANSIT: 6 };
  supports(mode: TransportMode) {
    return mode in FixtureRouting.SPEEDS;
  }
  async matrix(points: LngLat[], mode: TransportMode): Promise<Matrix | null> {
    const speed = FixtureRouting.SPEEDS[mode];
    if (!speed) return null;
    const dist = points.map((a) => points.map((b) => Math.round(haversineM(a, b) * 1.3)));
    return { distances: dist, durations: dist.map((row) => row.map((d) => Math.round(d / speed))), source: "fixture", quality: "ESTIMATED" };
  }
}

/** OSRM (HTTP /table). Servidor configurable; el demo público de OSRM no es apto para producción. */
class OsrmRouting extends RoutingPort {
  readonly name = "osrm";
  private static PROFILES: Partial<Record<TransportMode, string>> = { WALK: "foot", BIKE: "bike", CAR: "driving" };
  constructor(private readonly baseUrl: string, private readonly userAgent: string) {
    super();
  }
  supports(mode: TransportMode) {
    return mode in OsrmRouting.PROFILES;
  }
  async matrix(points: LngLat[], mode: TransportMode): Promise<Matrix | null> {
    const profile = OsrmRouting.PROFILES[mode];
    if (!profile || points.length < 2) return null;
    const coords = points.map((p) => `${p.lng},${p.lat}`).join(";");
    const url = `${this.baseUrl.replace(/\/$/, "")}/table/v1/${profile}/${coords}?annotations=duration,distance`;
    const res = await fetch(url, { headers: { "User-Agent": this.userAgent }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const json = (await res.json()) as { code: string; durations?: (number | null)[][]; distances?: (number | null)[][] };
    if (json.code !== "Ok" || !json.durations) return null;
    return {
      durations: json.durations.map((r) => r.map((v) => (v == null ? null : Math.round(v)))),
      distances: (json.distances ?? json.durations.map((r) => r.map(() => null))).map((r) => r.map((v) => (v == null ? null : Math.round(v)))),
      source: "osrm",
      quality: "PROVIDER",
    };
  }
}

export function createRouting(env: Env): RoutingPort {
  if (env.ROUTING_PROVIDER === "fixture") return new FixtureRouting();
  if (env.ROUTING_PROVIDER === "osrm" && env.OSRM_BASE_URL) return new OsrmRouting(env.OSRM_BASE_URL, env.GEO_USER_AGENT);
  return new NoRouting();
}

export abstract class GeocoderPort {
  abstract readonly name: string | null;
  abstract search(q: string): Promise<GeocodeResult["results"]>;
}

class NoGeocoder extends GeocoderPort {
  readonly name = null;
  async search() {
    return [];
  }
}

/** Nominatim: respetar su política de uso (1 req/s, User-Agent propio, sin autocompletado masivo). */
class NominatimGeocoder extends GeocoderPort {
  readonly name = "nominatim";
  constructor(private readonly baseUrl: string, private readonly userAgent: string) {
    super();
  }
  async search(q: string) {
    const url = `${this.baseUrl.replace(/\/$/, "")}/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, { headers: { "User-Agent": this.userAgent, "Accept-Language": "es" }, signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error(`Nominatim ${res.status}`);
    const rows = (await res.json()) as {
      display_name: string;
      lat: string;
      lon: string;
      address?: { country_code?: string; city?: string; town?: string; village?: string; state?: string };
    }[];
    return rows.map((r) => ({
      label: r.display_name,
      lng: Number(r.lon),
      lat: Number(r.lat),
      countryCode: r.address?.country_code?.toUpperCase() ?? null,
      locality: r.address?.city ?? r.address?.town ?? r.address?.village ?? null,
      region: r.address?.state ?? null,
    }));
  }
}

export function createGeocoder(env: Env): GeocoderPort {
  if (env.GEOCODER_PROVIDER === "nominatim") return new NominatimGeocoder(env.NOMINATIM_BASE_URL, env.GEO_USER_AGENT);
  return new NoGeocoder();
}
