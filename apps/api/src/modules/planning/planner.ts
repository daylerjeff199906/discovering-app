import type { Pace, PlaceSnapshot, ProposalDto, TransportMode } from "@por-aqui/contracts";
import { haversineM } from "../../common/geo";
import type { LngLat, Matrix } from "../../infrastructure/geo/providers";

export interface Candidate {
  id: string;
  snapshot: PlaceSnapshot;
  interests: string[];
  typicalMinutes: number | null;
  openingHours: Record<string, [string, string][]> | null;
}

export interface PlanParams {
  daysCount: number;
  minutesPerDay: number;
  interests: string[];
  pace: Pace;
  transport: TransportMode;
  start?: LngLat;
  /** YYYY-MM-DD del primer día, si se conoce (habilita la comprobación de horarios). */
  startDate?: string;
  dayStartMinutes?: number;
}

export type MatrixFn = (points: LngLat[], mode: TransportMode) => Promise<Matrix | null>;

export const MAX_STOPS_PER_DAY: Record<Pace, number> = { RELAXED: 3, MODERATE: 5, INTENSE: 7 };
export const DEFAULT_VISIT_MINUTES = 60;
const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

const toMin = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** ¿Está abierto durante [arrival, arrival+visit]? `null` = horario desconocido. */
export function openDuring(hours: Candidate["openingHours"], date: string | null, arrival: number, visit: number): boolean | null {
  if (!hours || !date) return null;
  const key = DAY_KEYS[new Date(`${date}T00:00:00Z`).getUTCDay()]!;
  const intervals = hours[key];
  if (!intervals) return null;
  return intervals.some(([o, c]) => toMin(o) <= arrival && arrival + visit <= toMin(c));
}

function pathLength(order: number[], dist: (a: number, b: number) => number, startIdx?: number): number {
  let total = startIdx !== undefined && order.length ? dist(startIdx, order[0]!) : 0;
  for (let i = 0; i < order.length - 1; i++) total += dist(order[i]!, order[i + 1]!);
  return total;
}

/** Mejora local 2-opt acotada (no promete un óptimo global). */
export function improveOrder(order: number[], dist: (a: number, b: number) => number, maxIterations = 200): number[] {
  const best = [...order];
  let improved = true;
  let iterations = 0;
  while (improved && iterations++ < maxIterations) {
    improved = false;
    for (let i = 0; i < best.length - 1; i++) {
      for (let k = i + 1; k < best.length; k++) {
        const candidate = [...best.slice(0, i), ...best.slice(i, k + 1).reverse(), ...best.slice(k + 1)];
        if (pathLength(candidate, dist) + 1e-6 < pathLength(best, dist)) {
          best.splice(0, best.length, ...candidate);
          improved = true;
        }
      }
    }
  }
  return best;
}

/**
 * Heurística explicable: selección voraz por afinidad de intereses y cercanía (haversine solo para ordenar),
 * límite de tiempo de visita por día y de paradas por ritmo, mejora 2-opt, y tiempos de traslado SOLO
 * si un proveedor los entrega. Nunca inventa horarios, lugares ni trayectos.
 */
export async function planRoute(candidates: Candidate[], params: PlanParams, matrix: MatrixFn, destinationLabel: string, journeyVersion: number): Promise<ProposalDto> {
  const warnings: ProposalDto["warnings"] = [];
  const sources = new Set<string>([`Catálogo de lugares (${candidates.length} candidatos)`]);
  const maxPerDay = MAX_STOPS_PER_DAY[params.pace];
  const wanted = new Set(params.interests);

  const scored = candidates.map((c) => ({ c, score: wanted.size ? c.interests.filter((i) => wanted.has(i)).length : 1 }));
  let pool = scored.filter((s) => s.score > 0);
  if (wanted.size && pool.length < Math.min(params.daysCount * 2, candidates.length)) {
    pool = scored.map((s) => ({ ...s, score: Math.max(s.score, 0.1) }));
    warnings.push({ code: "FEW_INTEREST_MATCHES", message: "Pocos lugares coinciden con tus intereses; se añadieron otros del destino." });
  }
  if (pool.length === 0) {
    warnings.push({ code: "NO_DATA", message: "No hay lugares en el catálogo para este destino. Añade lugares manualmente." });
    return { journeyVersion, destinationLabel, days: [], partial: true, warnings, dataSources: [...sources] };
  }

  const days: ProposalDto["days"] = [];
  const remaining = new Set(pool.map((p) => p.c.id));
  const byId = new Map(pool.map((p) => [p.c.id, p]));
  let routingMissing = false;
  const unknownHours = new Set<string>();

  for (let d = 0; d < params.daysCount && remaining.size > 0; d++) {
    const date = params.startDate ? addDays(params.startDate, d) : null;
    const anchor: LngLat = params.start ?? centroid([...remaining].map((id) => byId.get(id)!.c.snapshot));
    const chosen: string[] = [];
    let usedMin = 0;
    let cursor: LngLat = anchor;

    while (chosen.length < maxPerDay) {
      let best: { id: string; value: number; minutes: number } | null = null;
      for (const id of remaining) {
        const { c, score } = byId.get(id)!;
        const minutes = c.typicalMinutes ?? DEFAULT_VISIT_MINUTES;
        if (usedMin + minutes > params.minutesPerDay) continue;
        const open = openDuring(c.openingHours, date, (params.dayStartMinutes ?? 540) + usedMin, minutes);
        if (open === false) continue;
        const dist = haversineM(cursor, c.snapshot);
        const value = score * 5000 - dist;
        if (!best || value > best.value) best = { id, value, minutes };
      }
      if (!best) break;
      chosen.push(best.id);
      remaining.delete(best.id);
      usedMin += best.minutes;
      cursor = byId.get(best.id)!.c.snapshot;
    }
    if (chosen.length === 0) continue;

    const pts = chosen.map((id) => byId.get(id)!.c.snapshot);
    const straight = (a: number, b: number) => haversineM(pts[a]!, pts[b]!);
    // Se mantiene el primero cercano al ancla; el resto se optimiza.
    const order = [0, ...improveOrder(chosen.slice(1).map((_, i) => i + 1), straight)];
    let ordered = order.map((i) => chosen[i]!);
    let m = ordered.length >= 2 ? await matrix(ordered.map((id) => byId.get(id)!.c.snapshot), params.transport) : null;

    // Con traslados conocidos, se recorta si no entra en el tiempo disponible.
    const visitMinutes = (ids: string[]) => ids.reduce((acc, id) => acc + (byId.get(id)!.c.typicalMinutes ?? DEFAULT_VISIT_MINUTES), 0);
    const travelMinutes = (mx: Matrix | null, n: number) => {
      if (!mx) return 0;
      let s = 0;
      for (let i = 0; i < n - 1; i++) s += (mx.durations[i]?.[i + 1] ?? 0) / 60;
      return s;
    };
    while (ordered.length > 1 && m && visitMinutes(ordered) + travelMinutes(m, ordered.length) > params.minutesPerDay) {
      const dropped = ordered.pop()!;
      remaining.add(dropped);
      m = ordered.length >= 2 ? await matrix(ordered.map((id) => byId.get(id)!.c.snapshot), params.transport) : null;
    }
    if (m) sources.add(`Rutas: ${m.source}${m.quality === "ESTIMATED" ? " (estimado)" : ""}`);
    else if (ordered.length >= 2) routingMissing = true;

    // Comprobación de horarios con llegadas reales (visita + traslado conocido).
    let clock = params.dayStartMinutes ?? 540;
    const kept: string[] = [];
    for (let i = 0; i < ordered.length; i++) {
      const { c } = byId.get(ordered[i]!)!;
      const minutes = c.typicalMinutes ?? DEFAULT_VISIT_MINUTES;
      if (kept.length > 0 && m) clock += (m.durations[i - 1]?.[i] ?? 0) / 60;
      const open = openDuring(c.openingHours, date, clock, minutes);
      if (open === false) {
        warnings.push({ code: "CLOSED_AT_ARRIVAL", message: `${c.snapshot.name} estaría cerrado a la hora prevista; se omitió del día ${d + 1}.` });
        continue;
      }
      if (open === null) unknownHours.add(c.snapshot.name);
      kept.push(ordered[i]!);
      clock += minutes;
    }
    if (kept.length !== ordered.length) {
      ordered = kept;
      m = ordered.length >= 2 ? await matrix(ordered.map((id) => byId.get(id)!.c.snapshot), params.transport) : null;
    }
    if (ordered.length === 0) continue;

    const stops = ordered.map((id) => {
      const { c } = byId.get(id)!;
      return {
        placeId: c.id,
        place: c.snapshot,
        visitDurationSeconds: (c.typicalMinutes ?? DEFAULT_VISIT_MINUTES) * 60,
        durationEstimated: c.typicalMinutes === null,
        hoursKnown: c.openingHours !== null,
        matchedInterests: c.interests.filter((i) => wanted.has(i)),
      };
    });
    const legs = ordered.slice(0, -1).map((id, i) => ({
      fromPlaceId: id,
      toPlaceId: ordered[i + 1]!,
      mode: params.transport,
      distanceM: m?.distances[i]?.[i + 1] ?? null,
      durationS: m?.durations[i]?.[i + 1] ?? null,
      source: m?.source ?? "none",
      quality: (m ? m.quality : "UNKNOWN") as "PROVIDER" | "ESTIMATED" | "UNKNOWN",
    }));
    const plannedSeconds = stops.reduce((a, s) => a + s.visitDurationSeconds, 0) + legs.reduce((a, l) => a + (l.durationS ?? 0), 0);
    days.push({ localDate: date, stops, legs, plannedSeconds });
  }

  if (routingMissing) {
    warnings.push({ code: "ROUTING_UNAVAILABLE", message: `Sin proveedor de rutas para el modo elegido: los traslados quedan «Por definir». Los lugares se ordenaron por cercanía aproximada.` });
    sources.add("Sin proveedor de rutas");
  }
  if (unknownHours.size) warnings.push({ code: "HOURS_UNKNOWN", message: `Horario desconocido: ${[...unknownHours].join(", ")}. Verifica antes de ir.` });
  const estimatedDurations = days.flatMap((day) => day.stops).filter((s) => s.durationEstimated).length;
  if (estimatedDurations) warnings.push({ code: "DURATION_ESTIMATED", message: `${estimatedDurations} tiempo(s) de visita son estimados (${DEFAULT_VISIT_MINUTES} min por omisión).` });

  const partial = days.length < params.daysCount;
  if (partial) warnings.push({ code: "PARTIAL", message: `Solo se pudieron completar ${days.length} de ${params.daysCount} día(s) con los lugares disponibles.` });
  return { journeyVersion, destinationLabel, days, partial, warnings, dataSources: [...sources] };
}

function centroid(points: { lng: number; lat: number }[]): LngLat {
  const n = points.length || 1;
  return { lng: points.reduce((a, p) => a + p.lng, 0) / n, lat: points.reduce((a, p) => a + p.lat, 0) / n };
}
