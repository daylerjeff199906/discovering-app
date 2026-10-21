import type { JourneyDto, StopDto, TransportMode, VisitDto } from "@por-aqui/contracts";
import type { TrailState } from "@por-aqui/ui";
import { legText } from "./format";

export interface FlatStop extends StopDto {
  dayIndex: number;
  /** Número continuo en todo el viaje (para el mapa). */
  index: number;
}

export function flattenStops(j: JourneyDto): FlatStop[] {
  let n = 0;
  return j.days.flatMap((d, dayIndex) => d.stops.map((s) => ({ ...s, dayIndex, index: ++n })));
}

/** Pendiente / actual / visitado a partir de las visitas registradas. «Actual» = la primera parada sin visitar de un recorrido en curso. */
export function stopStates(j: JourneyDto, visits: VisitDto[]): Map<string, TrailState> {
  const visited = new Set(visits.map((v) => v.stopId).filter(Boolean));
  const live = j.status === "IN_PROGRESS" || j.status === "PAUSED";
  const out = new Map<string, TrailState>();
  let currentAssigned = false;
  for (const s of flattenStops(j)) {
    if (visited.has(s.id)) out.set(s.id, "visited");
    else if (live && !currentAssigned) {
      out.set(s.id, "current");
      currentAssigned = true;
    } else out.set(s.id, "pending");
  }
  return out;
}

export function connectorFor(j: JourneyDto, stops: StopDto[], i: number): string | undefined {
  const next = stops[i + 1];
  if (!next) return undefined;
  const leg = j.legs.find((l) => l.fromStopId === stops[i]!.id && l.toStopId === next.id);
  return legText(leg, (leg?.mode ?? j.preferences.transport) as TransportMode);
}

export function summarize(j: JourneyDto) {
  const stops = flattenStops(j);
  const known = stops.filter((s) => s.visitDurationSeconds !== null);
  const consecutive = j.days.flatMap((d) => d.stops.slice(0, -1).map((s, i) => ({ from: s.id, to: d.stops[i + 1]!.id })));
  const legs = consecutive.map((c) => j.legs.find((l) => l.fromStopId === c.from && l.toStopId === c.to));
  return {
    stops: stops.length,
    visitSeconds: known.reduce((a, s) => a + (s.visitDurationSeconds ?? 0), 0),
    unknownVisits: stops.length - known.length,
    travelSeconds: legs.reduce((a, l) => a + (l?.durationS ?? 0), 0),
    unknownLegs: legs.filter((l) => !l || l.durationS === null).length,
    estimatedLegs: legs.filter((l) => l?.quality === "ESTIMATED").length,
  };
}

/** Utilidades de reordenamiento puras (probadas aparte). */
export type Layout = { dayId: string; stopIds: string[] }[];

export function layoutOf(j: JourneyDto): Layout {
  return j.days.map((d) => ({ dayId: d.id, stopIds: d.stops.map((s) => s.id) }));
}

export function moveStop(layout: Layout, stopId: string, toDayId: string, toIndex: number): Layout {
  const without = layout.map((d) => ({ ...d, stopIds: d.stopIds.filter((id) => id !== stopId) }));
  return without.map((d) => {
    if (d.dayId !== toDayId) return d;
    const ids = [...d.stopIds];
    ids.splice(Math.max(0, Math.min(toIndex, ids.length)), 0, stopId);
    return { ...d, stopIds: ids };
  });
}

/** Sube/baja una parada; en los extremos del día pasa al día vecino (si existe). */
export function shiftStop(layout: Layout, stopId: string, delta: -1 | 1): Layout | null {
  const di = layout.findIndex((d) => d.stopIds.includes(stopId));
  if (di === -1) return null;
  const day = layout[di]!;
  const i = day.stopIds.indexOf(stopId);
  const j = i + delta;
  if (j >= 0 && j < day.stopIds.length) return moveStop(layout, stopId, day.dayId, j);
  const neighbour = layout[di + delta];
  if (!neighbour) return null;
  return moveStop(layout, stopId, neighbour.dayId, delta === -1 ? neighbour.stopIds.length : 0);
}

export function applyLayout(j: JourneyDto, layout: Layout): JourneyDto {
  const byId = new Map(j.days.flatMap((d) => d.stops).map((s) => [s.id, s]));
  return { ...j, days: j.days.map((d) => ({ ...d, stops: (layout.find((l) => l.dayId === d.id)?.stopIds ?? []).map((id, i) => ({ ...byId.get(id)!, dayId: d.id, position: i })) })) };
}
