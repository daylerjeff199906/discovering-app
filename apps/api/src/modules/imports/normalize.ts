import { IMPORT_ERROR_CODES, type ImportOptions, type ImportPreview } from "@por-aqui/contracts";
import { AppError } from "../../common/errors";
import { haversineM } from "../../common/geo";
import type { ParsedFile } from "./parsers";

export interface ImportLimits {
  maxAccuracyM: number;
  minDistanceM: number;
  maxPoints: number;
  maxWaypoints: number;
}

export interface NormalizedPoint {
  seq: number;
  recordedAt: Date;
  lng: number;
  lat: number;
  accuracyM: number | null;
}

export interface NormalizedSegment {
  clientSegmentId: string;
  startedAt: Date;
  endedAt: Date;
  points: NormalizedPoint[];
}

export interface NormalizedWaypoint {
  name: string;
  description: string | null;
  address: string | null;
  lng: number;
  lat: number;
  visitedAt: Date;
  endedAt: Date | null;
  /** false si la fecha se dedujo del orden del archivo (el waypoint no traía fecha). */
  timed: boolean;
}

export interface NormalizedImport {
  parsed: ParsedFile;
  segments: NormalizedSegment[];
  waypoints: NormalizedWaypoint[];
  pointsDiscarded: number;
  distanceM: number;
  startedAt: Date | null;
  endedAt: Date | null;
  hasTimestamps: boolean;
  warnings: string[];
}

/** Puntos con fecha más allá de este margen se descartan, igual que en la grabación en vivo. */
const FUTURE_HORIZON_MS = 5 * 60_000;
/** Separación entre puntos cuando el archivo no trae fechas. */
const SYNTHETIC_STEP_MS = 1000;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Aplica a lo leído del archivo las mismas reglas que la grabación en vivo (precisión máxima, fechas futuras,
 * distancia mínima entre puntos) y las del límite de tamaño. No toca la base de datos.
 */
export function normalizeImport(parsed: ParsedFile, options: Pick<ImportOptions, "from" | "to" | "startAt" | "importWaypoints">, limits: ImportLimits, now = Date.now()): NormalizedImport {
  const warnings = [...parsed.warnings];
  const from = options.from ? Date.parse(options.from) : null;
  const to = options.to ? Date.parse(options.to) : null;
  if (from !== null && to !== null && from > to) throw new AppError(400, "VALIDATION_ERROR", "La fecha «desde» es posterior a «hasta».", { from: ["Debe ser anterior a «hasta»"] });
  const startAt = options.startAt ? Date.parse(options.startAt) : null;
  if (startAt !== null && startAt > now + FUTURE_HORIZON_MS) throw new AppError(400, "VALIDATION_ERROR", "La fecha de inicio no puede estar en el futuro.", { startAt: ["Fecha futura"] });
  const inRange = (t: number) => (from === null || t >= from) && (to === null || t <= to);

  const rawCount = parsed.segments.reduce((n, s) => n + s.points.length, 0);
  // Un segmento "tiene fechas" solo si todos sus puntos las traen; si no, se generan para todo el segmento.
  const timedSegments = parsed.segments.filter((s) => s.points.every((p) => p.time !== null));
  const untimedCount = parsed.segments.filter((s) => !timedSegments.includes(s)).reduce((n, s) => n + s.points.length, 0);
  const hasTimestamps = parsed.segments.length === 0 ? parsed.waypoints.some((w) => w.time !== null) : untimedCount === 0;
  if (untimedCount > 0) {
    warnings.push(startAt === null ? "El archivo no trae fechas para parte del trayecto: se usará la fecha de hoy. Indica una fecha de inicio si quieres otra." : "El archivo no trae fechas para parte del trayecto: se calcularon a partir de la fecha de inicio indicada.");
  }

  let synthetic = startAt ?? now - untimedCount * SYNTHETIC_STEP_MS;
  let discarded = 0;
  const segments: NormalizedSegment[] = [];
  let kept = 0;
  let distanceM = 0;

  for (const seg of parsed.segments) {
    const timed = timedSegments.includes(seg);
    const pts = seg.points.map((p) => ({ ...p }));
    if (timed) pts.sort((a, b) => a.time! - b.time!); // estable: respeta el orden original en empates
    else
      for (const p of pts) {
        p.time = synthetic;
        synthetic += SYNTHETIC_STEP_MS;
      }

    const accepted: NormalizedPoint[] = [];
    let prev: { lng: number; lat: number } | null = null;
    for (const p of pts) {
      const t = p.time!;
      const bad = (p.accuracyM !== null && (p.accuracyM < 0 || p.accuracyM > limits.maxAccuracyM)) || t > now + FUTURE_HORIZON_MS || !inRange(t);
      if (bad || (prev && haversineM(prev, p) < limits.minDistanceM)) {
        discarded++;
        continue;
      }
      if (prev) distanceM += haversineM(prev, p);
      prev = p;
      accepted.push({ seq: accepted.length, recordedAt: new Date(t), lng: p.lng, lat: p.lat, accuracyM: p.accuracyM });
    }
    kept += accepted.length;
    if (accepted.length) {
      segments.push({
        clientSegmentId: `imp-${segments.length + 1}`,
        startedAt: accepted[0]!.recordedAt,
        endedAt: accepted[accepted.length - 1]!.recordedAt,
        points: accepted,
      });
    }
  }
  if (kept > limits.maxPoints) {
    throw new AppError(422, IMPORT_ERROR_CODES.TOO_MANY_POINTS, `El recorrido tiene ${kept.toLocaleString("es")} puntos y el máximo es ${limits.maxPoints.toLocaleString("es")}. Divide el archivo o limita el rango de fechas.`);
  }

  // Lugares: sin fecha se ordenan al inicio del recorrido, un segundo aparte, para conservar el orden del archivo.
  const waypoints: NormalizedWaypoint[] = [];
  if (options.importWaypoints) {
    const anchor = segments[0]?.startedAt.getTime() ?? startAt ?? now - parsed.waypoints.length * SYNTHETIC_STEP_MS;
    let outOfRange = 0;
    let future = 0;
    let untimed = 0;
    parsed.waypoints.forEach((w, i) => {
      const t = w.time ?? anchor + i * SYNTHETIC_STEP_MS;
      if (w.time !== null && !inRange(w.time)) outOfRange++;
      else if (t > now + FUTURE_HORIZON_MS) future++;
      else {
        const end = w.endTime !== null && w.time !== null && w.endTime >= w.time ? new Date(w.endTime) : null;
        if (w.time === null) untimed++;
        waypoints.push({ name: w.name, description: w.description, address: w.address, lng: w.lng, lat: w.lat, visitedAt: new Date(t), endedAt: end, timed: w.time !== null });
      }
    });
    if (outOfRange) warnings.push(`${plural(outOfRange, "lugar quedó", "lugares quedaron")} fuera del rango de fechas.`);
    if (future) warnings.push(`${plural(future, "lugar tiene", "lugares tienen")} fecha futura y se omitió.`);
    if (untimed) warnings.push(`${plural(untimed, "lugar no trae", "lugares no traen")} fecha: se ordenaron según el archivo.`);
    waypoints.sort((a, b) => a.visitedAt.getTime() - b.visitedAt.getTime());
  }
  if (waypoints.length > limits.maxWaypoints) {
    throw new AppError(422, IMPORT_ERROR_CODES.TOO_MANY_WAYPOINTS, `El archivo tiene ${waypoints.length.toLocaleString("es")} lugares y el máximo es ${limits.maxWaypoints.toLocaleString("es")}. Limita el rango de fechas o importa solo el trayecto.`);
  }

  if (segments.length === 0 && waypoints.length === 0) {
    throw new AppError(
      422,
      IMPORT_ERROR_CODES.EMPTY,
      rawCount === 0 && parsed.waypoints.length === 0
        ? "No encontramos trayectos ni lugares en el archivo."
        : "Tras aplicar los filtros no queda nada que importar (puntos imprecisos, repetidos, fuera del rango de fechas o sin lugares seleccionados).",
    );
  }
  if (parsed.skipped) warnings.push(`${plural(parsed.skipped, "punto con coordenadas inválidas se omitió", "puntos con coordenadas inválidas se omitieron")}.`);
  if (discarded) warnings.push(`${plural(discarded, "punto se descartó", "puntos se descartaron")} por precisión, repetición, fecha o rango.`);

  const times = [...segments.flatMap((s) => [s.startedAt.getTime(), s.endedAt.getTime()]), ...waypoints.map((w) => w.visitedAt.getTime())];
  return {
    parsed,
    segments,
    waypoints,
    pointsDiscarded: discarded,
    distanceM: Math.round(distanceM),
    startedAt: times.length ? new Date(Math.min(...times)) : null,
    endedAt: times.length ? new Date(Math.max(...times)) : null,
    hasTimestamps,
    warnings,
  };
}

export const PREVIEW_WAYPOINTS = 20;

export function toPreview(n: NormalizedImport, suggestedTitle: string): ImportPreview {
  const all = [...n.segments.flatMap((s) => s.points), ...n.waypoints.map((w) => ({ lng: w.lng, lat: w.lat }))];
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const p of all) {
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
  }
  return {
    format: n.parsed.format,
    suggestedTitle,
    pointsCount: n.segments.reduce((c, s) => c + s.points.length, 0),
    pointsDiscarded: n.pointsDiscarded,
    segmentsCount: n.segments.length,
    distanceM: n.distanceM,
    startedAt: n.startedAt?.toISOString() ?? null,
    endedAt: n.endedAt?.toISOString() ?? null,
    hasTimestamps: n.hasTimestamps,
    waypointsCount: n.waypoints.length,
    waypoints: n.waypoints.slice(0, PREVIEW_WAYPOINTS).map((w) => ({ name: w.name, lng: w.lng, lat: w.lat, at: w.timed ? w.visitedAt.toISOString() : null })),
    bounds: all.length ? { minLng, minLat, maxLng, maxLat } : null,
    warnings: n.warnings,
  };
}
