import { clip, invalidFile, parseTime, validLngLat, type ParsedFile, type RawPoint, type RawSegment, type RawWaypoint } from "./types";
import { descendants, kid, textOf, type XmlNode } from "./xml";

/** `lng,lat[,alt]` separados por espacios o saltos de línea (KML siempre usa lng primero). */
function parseCoordinates(text: string): { points: RawPoint[]; skipped: number } {
  const points: RawPoint[] = [];
  let skipped = 0;
  for (const token of text.split(/\s+/)) {
    if (!token) continue;
    const [lng, lat] = token.split(",").map(Number);
    if (lng !== undefined && lat !== undefined && validLngLat(lng, lat)) points.push({ lng, lat, time: null, accuracyM: null });
    else skipped++;
  }
  return { points, skipped };
}

/**
 * KML/Google Earth/Mis mapas: cada `Placemark` con `LineString` o `gx:Track` es un segmento y cada `Point`
 * es un lugar. `gx:Track` trae fechas (`<when>`) y `gx:coord` en pares ("lng lat alt"); `LineString` no tiene fechas.
 */
export function parseKml(root: XmlNode): ParsedFile {
  if (root.name !== "kml") throw invalidFile("El archivo XML no es un KML (falta el elemento <kml>).");
  const segments: RawSegment[] = [];
  const waypoints: RawWaypoint[] = [];
  const warnings: string[] = [];
  let skipped = 0;
  let ignored = 0;
  let title: string | null = null;

  for (const mark of descendants(root, "Placemark")) {
    const name = textOf(kid(mark, "name"));
    const description = textOf(kid(mark, "description"));
    const stampText = textOf(kid(kid(mark, "TimeStamp") ?? mark, "when")) || textOf(kid(kid(mark, "TimeSpan") ?? mark, "begin"));
    const endText = textOf(kid(kid(mark, "TimeSpan") ?? mark, "end"));

    for (const line of descendants(mark, "LineString")) {
      const { points, skipped: bad } = parseCoordinates(textOf(kid(line, "coordinates")));
      skipped += bad;
      if (points.length) segments.push({ points });
      title ??= name || null;
    }
    for (const track of descendants(mark, "Track")) {
      const whens = track.children.filter((c) => c.name === "when").map((c) => parseTime(textOf(c)));
      const coords = track.children.filter((c) => c.name === "coord");
      const points: RawPoint[] = [];
      coords.forEach((c, idx) => {
        const [lng, lat] = textOf(c).split(/\s+/).map(Number);
        if (lng !== undefined && lat !== undefined && validLngLat(lng, lat)) points.push({ lng, lat, time: whens[idx] ?? null, accuracyM: null });
        else skipped++;
      });
      if (points.length) segments.push({ points });
      title ??= name || null;
    }
    for (const point of descendants(mark, "Point")) {
      const { points, skipped: bad } = parseCoordinates(textOf(kid(point, "coordinates")));
      skipped += bad;
      const p = points[0];
      if (!p) continue;
      waypoints.push({
        name: clip(name, 120) ?? "Punto sin nombre",
        description: clip(description.replace(/<[^>]*>/g, " "), 500),
        address: null,
        lng: p.lng,
        lat: p.lat,
        time: parseTime(stampText),
        endTime: parseTime(endText),
      });
    }
    ignored += descendants(mark, "Polygon").length;
  }
  if (ignored) warnings.push(`Se omitieron ${ignored} polígono(s): solo se importan líneas y puntos.`);
  return { format: "KML", title: clip(title, 120), segments, waypoints, skipped, warnings };
}
