import { IMPORT_ERROR_CODES, type ImportFormat } from "@por-aqui/contracts";
import { AppError } from "../../../common/errors";

/** Punto GPS leído del archivo. `time` en ms desde epoch, o null si el archivo no trae fecha. */
export interface RawPoint {
  lng: number;
  lat: number;
  time: number | null;
  accuracyM: number | null;
}

export interface RawSegment {
  points: RawPoint[];
}

/** Lugar con nombre (waypoint de GPX, Point de KML, visita de Timeline o lugar guardado). */
export interface RawWaypoint {
  name: string;
  description: string | null;
  address: string | null;
  lng: number;
  lat: number;
  time: number | null;
  endTime: number | null;
}

/** Resultado de un parser, aún sin filtrar. */
export interface ParsedFile {
  format: ImportFormat;
  /** Nombre del recorrido dentro del archivo (p. ej. `<trk><name>`), si existe. */
  title: string | null;
  segments: RawSegment[];
  waypoints: RawWaypoint[];
  /** Puntos o lugares con coordenadas inválidas que se omitieron al leer. */
  skipped: number;
  warnings: string[];
}

/** Archivo que no se puede leer: 422 con código estable y un mensaje que explica qué falló. */
export const invalidFile = (message: string, code: string = IMPORT_ERROR_CODES.INVALID) => new AppError(422, code, message);

export const validLngLat = (lng: number, lat: number) => Number.isFinite(lng) && Number.isFinite(lat) && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;

/** Fecha ISO → ms. Si no declara zona horaria se asume UTC (el servidor no debe depender de su zona local). */
export function parseTime(value: string | null | undefined): number | null {
  const v = value?.trim();
  if (!v) return null;
  const ms = Date.parse(/^\d{4}-\d{2}-\d{2}T[\d:.]+$/.test(v) ? `${v}Z` : v);
  return Number.isFinite(ms) ? ms : null;
}

/** Recorta texto libre a un máximo; devuelve null si queda vacío. */
export function clip(value: string | null | undefined, max: number): string | null {
  const v = value?.replace(/\s+/g, " ").trim();
  return v ? v.slice(0, max) : null;
}
