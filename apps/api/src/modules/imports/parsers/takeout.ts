import { IMPORT_ERROR_CODES } from "@por-aqui/contracts";
import { clip, invalidFile, parseTime, validLngLat, type ParsedFile, type RawPoint } from "./types";

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => (typeof v === "string" ? v : undefined);
const num = (v: unknown) => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Marca de tiempo de Takeout: ISO 8601 o milisegundos (como número o texto). */
function stamp(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  return /^\d{10,}$/.test(v) ? Number(v) : parseTime(v);
}

/** Coordenada en E7 (`latitudeE7`/`latE7`) o en grados. */
function e7(o: Json, ...keys: string[]): number | null {
  for (const k of keys) {
    const n = num(o[k]);
    if (n !== null) return k.endsWith("E7") ? n / 1e7 : n;
  }
  return null;
}

/** `geo:-3.75,-73.25` o `-3.75°, -73.25°` (formatos de Timeline en el dispositivo). */
function latLngOf(v: unknown): { lat: number; lng: number } | null {
  const raw = isObj(v) ? (str(v.latLng) ?? str(v.point)) : str(v);
  if (!raw) return null;
  const m = /(-?\d+(?:\.\d+)?)\s*°?\s*,\s*(-?\d+(?:\.\d+)?)/.exec(raw);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return validLngLat(lng, lat) ? { lat, lng } : null;
}

const NO_NAME = (lat: number, lng: number) => `Punto ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
const SEMANTIC_NAMES: Record<string, string> = { HOME: "Casa", WORK: "Trabajo", INFERRED_HOME: "Casa", INFERRED_WORK: "Trabajo", SEARCHED_ADDRESS: "Dirección buscada", ALIASED_LOCATION: "Lugar con alias" };

/** Reparte linealmente entre un inicio y un fin los puntos de una ruta simplificada que no traen fecha. */
function interpolate(points: RawPoint[], start: number | null, end: number | null): void {
  if (start === null || end === null) return;
  points.forEach((p, i) => {
    p.time ??= points.length === 1 ? start : Math.round(start + ((end - start) * i) / (points.length - 1));
  });
}

/** Segmentos del Timeline antiguo (`Semantic Location History`): `placeVisit` y `activitySegment`. */
function parseSemanticObjects(objects: unknown[], out: ParsedFile): void {
  for (const obj of objects) {
    if (!isObj(obj)) continue;
    if (isObj(obj.placeVisit)) {
      const pv = obj.placeVisit;
      const loc = isObj(pv.location) ? pv.location : {};
      const lat = e7(loc, "latitudeE7", "latitude");
      const lng = e7(loc, "longitudeE7", "longitude");
      if (lat === null || lng === null || !validLngLat(lng, lat)) {
        out.skipped++;
        continue;
      }
      const dur = isObj(pv.duration) ? pv.duration : {};
      out.waypoints.push({
        name: clip(str(loc.name), 120) ?? clip(str(loc.address)?.split(",")[0], 120) ?? NO_NAME(lat, lng),
        description: null,
        address: clip(str(loc.address), 300),
        lat,
        lng,
        time: stamp(dur.startTimestamp ?? dur.startTimestampMs),
        endTime: stamp(dur.endTimestamp ?? dur.endTimestampMs),
      });
    } else if (isObj(obj.activitySegment)) {
      const seg = obj.activitySegment;
      const dur = isObj(seg.duration) ? seg.duration : {};
      const start = stamp(dur.startTimestamp ?? dur.startTimestampMs);
      const end = stamp(dur.endTimestamp ?? dur.endTimestampMs);
      const points: RawPoint[] = [];
      const add = (o: unknown, time: number | null, acc: number | null = null) => {
        if (!isObj(o)) return;
        const lat = e7(o, "latitudeE7", "latE7");
        const lng = e7(o, "longitudeE7", "lngE7");
        if (lat === null || lng === null || !validLngLat(lng, lat)) out.skipped++;
        else points.push({ lat, lng, time, accuracyM: acc });
      };
      const raw = isObj(seg.simplifiedRawPath) && Array.isArray(seg.simplifiedRawPath.points) ? seg.simplifiedRawPath.points : null;
      if (raw?.length) {
        for (const p of raw) if (isObj(p)) add(p, stamp(p.timestamp ?? p.timestampMs), num(p.accuracyMeters));
      } else {
        add(seg.startLocation, start);
        const wps = isObj(seg.waypointPath) && Array.isArray(seg.waypointPath.waypoints) ? seg.waypointPath.waypoints : [];
        for (const w of wps) add(w, null);
        add(seg.endLocation, end);
        interpolate(points, start, end);
      }
      if (points.length) out.segments.push({ points });
    }
  }
}

/** Timeline nuevo (exportado desde el dispositivo): `semanticSegments` o un arreglo con `visit`/`activity`/`timelinePath`. */
function parseDeviceSegments(entries: unknown[], out: ParsedFile): void {
  for (const e of entries) {
    if (!isObj(e)) continue;
    const start = stamp(e.startTime);
    const end = stamp(e.endTime);
    if (isObj(e.visit)) {
      const top = isObj(e.visit.topCandidate) ? e.visit.topCandidate : {};
      const at = latLngOf(top.placeLocation);
      if (!at) {
        out.skipped++;
        continue;
      }
      const semantic = str(top.semanticType) ?? "";
      out.waypoints.push({ name: SEMANTIC_NAMES[semantic] ?? clip(str(top.name), 120) ?? NO_NAME(at.lat, at.lng), description: null, address: null, ...at, time: start, endTime: end });
    }
    const path = Array.isArray(e.timelinePath) ? e.timelinePath : [];
    if (path.length) {
      const points: RawPoint[] = [];
      for (const p of path) {
        const at = isObj(p) ? latLngOf(p.point) : null;
        if (!at || !isObj(p)) {
          out.skipped++;
          continue;
        }
        const offset = num(p.durationMinutesOffsetFromStartTime);
        points.push({ ...at, time: stamp(p.time) ?? (start !== null && offset !== null ? start + offset * 60_000 : null), accuracyM: null });
      }
      if (points.length) out.segments.push({ points });
    } else if (isObj(e.activity)) {
      const points: RawPoint[] = [];
      const a = latLngOf(e.activity.start);
      const b = latLngOf(e.activity.end);
      if (a) points.push({ ...a, time: start, accuracyM: null });
      if (b) points.push({ ...b, time: end, accuracyM: null });
      if (points.length) out.segments.push({ points });
    }
  }
}

/** `Records.json`: historial crudo, un punto por lectura. Se parte en segmentos cuando hay una pausa larga. */
function parseRecords(locations: unknown[], out: ParsedFile): void {
  const GAP_MS = 30 * 60_000;
  let current: RawPoint[] = [];
  let last: number | null = null;
  const flush = () => {
    if (current.length) out.segments.push({ points: current });
    current = [];
  };
  for (const l of locations) {
    if (!isObj(l)) continue;
    const lat = e7(l, "latitudeE7");
    const lng = e7(l, "longitudeE7");
    if (lat === null || lng === null || !validLngLat(lng, lat)) {
      out.skipped++;
      continue;
    }
    const time = stamp(l.timestamp ?? l.timestampMs);
    if (last !== null && time !== null && Math.abs(time - last) > GAP_MS) flush();
    current.push({ lat, lng, time, accuracyM: num(l.accuracy) });
    if (time !== null) last = time;
  }
  flush();
}

/** Coordenadas dentro de un enlace de Google Maps: `/@lat,lng,17z` o `!3dLAT!4dLNG`. */
export function coordsFromMapsUrl(url: string | undefined): { lat: number; lng: number } | null {
  if (!url) return null;
  const m = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(url) ?? /@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/.exec(url) ?? /[?&](?:q|ll|query)=(-?\d+(?:\.\d+)?)(?:,|%2C)(-?\d+(?:\.\d+)?)/.exec(url);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return validLngLat(lng, lat) ? { lat, lng } : null;
}

/** «Lugares guardados» en GeoJSON (`Saved Places.json`). Coordenadas [0,0] significan "sin ubicación". */
function parseSavedPlacesGeoJson(features: unknown[], out: ParsedFile): void {
  let missing = 0;
  for (const f of features) {
    if (!isObj(f)) continue;
    const props = isObj(f.properties) ? f.properties : {};
    const loc = isObj(props.Location) ? props.Location : {};
    const geo = isObj(loc["Geo Coordinates"]) ? loc["Geo Coordinates"] : {};
    const coords = isObj(f.geometry) && Array.isArray(f.geometry.coordinates) ? f.geometry.coordinates : [];
    let lng = num(coords[0]);
    let lat = num(coords[1]);
    if (lng === null || lat === null || (lng === 0 && lat === 0)) {
      lat = num(geo.Latitude);
      lng = num(geo.Longitude);
    }
    if (lng === null || lat === null || (lng === 0 && lat === 0)) {
      const fromUrl = coordsFromMapsUrl(str(props["Google Maps URL"]) ?? str(props.google_maps_url));
      lat = fromUrl?.lat ?? null;
      lng = fromUrl?.lng ?? null;
    }
    if (lng === null || lat === null || !validLngLat(lng, lat)) {
      missing++;
      continue;
    }
    out.waypoints.push({
      name: clip(str(props.Title) ?? str(props.title) ?? str(loc["Business Name"]), 120) ?? NO_NAME(lat, lng),
      description: null,
      address: clip(str(loc.Address), 300),
      lat,
      lng,
      time: null,
      endTime: null,
    });
  }
  if (missing) out.warnings.push(`${missing} lugar(es) guardado(s) no traen coordenadas y se omitieron.`);
}

/** CSV según RFC 4180 (comillas dobles, comas y saltos de línea dentro de campos). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((f) => f !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f !== "")) rows.push(row);
  return rows;
}

/** «Lugares guardados» en CSV (`Title,Note,URL,…`). Solo se conservan filas cuya URL trae coordenadas. */
export function parseSavedPlacesCsv(text: string): ParsedFile {
  const rows = parseCsv(text);
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  const col = (...names: string[]) => header.findIndex((h) => names.includes(h));
  const iTitle = col("title", "título", "titulo", "name");
  const iUrl = col("url");
  const iNote = col("note", "nota", "comment", "comentario");
  if (iTitle === -1 || iUrl === -1) throw invalidFile("El CSV no parece una lista de «Lugares guardados» de Google (faltan las columnas Title y URL).", IMPORT_ERROR_CODES.UNSUPPORTED);
  const out: ParsedFile = { format: "TAKEOUT_PLACES", title: null, segments: [], waypoints: [], skipped: 0, warnings: [] };
  let missing = 0;
  for (const r of rows.slice(1)) {
    const at = coordsFromMapsUrl(r[iUrl]);
    if (!at) {
      missing++;
      continue;
    }
    out.waypoints.push({ name: clip(r[iTitle], 120) ?? NO_NAME(at.lat, at.lng), description: clip(iNote === -1 ? null : r[iNote], 500), address: null, ...at, time: null, endTime: null });
  }
  if (missing) {
    out.warnings.push(`${missing} lugar(es) del CSV no traen coordenadas en su enlace (Google no las incluye en esta exportación) y se omitieron. El GeoJSON de «Lugares guardados» suele traerlas.`);
  }
  return out;
}

export function isCsvText(text: string): boolean {
  const first = text.replace(/^\uFEFF/, "").split(/\r?\n/, 1)[0]?.toLowerCase() ?? "";
  return first.includes(",") && /\b(title|título|titulo)\b/.test(first) && first.includes("url");
}

/** Takeout en JSON: detecta cuál de las variantes de Timeline o de lugares guardados es. */
export function parseTakeoutJson(text: string): ParsedFile {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw invalidFile("El archivo JSON no es válido (no se pudo leer).");
  }
  const out: ParsedFile = { format: "TAKEOUT_TIMELINE", title: null, segments: [], waypoints: [], skipped: 0, warnings: [] };
  if (isObj(data) && Array.isArray(data.timelineObjects)) parseSemanticObjects(data.timelineObjects, out);
  else if (isObj(data) && Array.isArray(data.locations)) parseRecords(data.locations, out);
  else if (isObj(data) && Array.isArray(data.semanticSegments)) parseDeviceSegments(data.semanticSegments, out);
  else if (Array.isArray(data) && data.some((e) => isObj(e) && ("visit" in e || "activity" in e || "timelinePath" in e))) parseDeviceSegments(data, out);
  else if (isObj(data) && data.type === "FeatureCollection" && Array.isArray(data.features)) {
    out.format = "TAKEOUT_PLACES";
    parseSavedPlacesGeoJson(data.features, out);
  } else {
    throw invalidFile("No reconocemos este JSON. Usa el Timeline (Semantic Location History, Records.json o Timeline.json) o «Lugares guardados» de Google Takeout.", IMPORT_ERROR_CODES.UNSUPPORTED);
  }
  return out;
}
