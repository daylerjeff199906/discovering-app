import type { JourneyStatus, LegDto, Pace, TransportMode } from "@por-aqui/contracts";
import type { BadgeTone } from "@por-aqui/ui";

export const TRANSPORT_LABEL: Record<TransportMode, string> = {
  WALK: "A pie",
  BIKE: "Bicicleta",
  CAR: "Auto",
  TRANSIT: "Transporte público",
  BOAT: "Bote / barco",
  FLIGHT: "Vuelo",
  OTHER: "Otro",
};

export const PACE_LABEL: Record<Pace, string> = { RELAXED: "Tranquilo", MODERATE: "Moderado", INTENSE: "Intenso" };

export const STATUS_LABEL: Record<JourneyStatus, string> = {
  DRAFT: "Borrador",
  PLANNED: "Planeado",
  IN_PROGRESS: "En curso",
  PAUSED: "Pausado",
  COMPLETED: "Finalizado",
  ARCHIVED: "Archivado",
};

export const STATUS_TONE: Record<JourneyStatus, BadgeTone> = {
  DRAFT: "neutral",
  PLANNED: "sage",
  IN_PROGRESS: "success",
  PAUSED: "warning",
  COMPLETED: "accent",
  ARCHIVED: "neutral",
};

export const VISIBILITY_LABEL = { PRIVATE: "Privado", UNLISTED: "Solo con enlace", PUBLIC: "Comunidad" } as const;

export function formatDuration(seconds: number | null | undefined): string | null {
  if (seconds === null || seconds === undefined) return null;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r} min` : `${h} h`;
}

export function formatDistance(m: number | null | undefined): string | null {
  if (m === null || m === undefined) return null;
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/** Texto del tramo entre dos paradas. Sin datos: «Por definir» (nunca un tiempo inventado). */
export function legText(leg: LegDto | undefined, mode: TransportMode): string {
  if (!leg || leg.durationS === null) return `${TRANSPORT_LABEL[mode]} · Por definir`;
  const parts = [formatDuration(leg.durationS), formatDistance(leg.distanceM)].filter(Boolean).join(" · ");
  const estimated = leg.quality === "ESTIMATED" ? " (estimado)" : "";
  return `${TRANSPORT_LABEL[leg.mode]} · ${parts}${estimated}`;
}

export function formatDate(iso: string | null | undefined, tz?: string): string {
  if (!iso) return "";
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "long", year: "numeric", timeZone: iso.length === 10 ? "UTC" : tz }).format(d);
}

export function formatDateTime(iso: string, tz?: string): string {
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }).format(new Date(iso));
}

/** Valor para <input type="datetime-local"> en la zona indicada. */
export function toLocalInput(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat("sv-SE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  return parts.replace(" ", "T");
}

/** Convierte un valor datetime-local interpretado en `tz` a un instante ISO con offset. */
export function fromLocalInput(value: string, tz: string): string {
  const asUtc = new Date(`${value}:00Z`);
  const shown = toLocalInput(asUtc.toISOString(), tz);
  const offsetMs = new Date(`${shown}:00Z`).getTime() - asUtc.getTime();
  return new Date(asUtc.getTime() - offsetMs).toISOString();
}

export const browserTimezone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
};

export const uuid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
