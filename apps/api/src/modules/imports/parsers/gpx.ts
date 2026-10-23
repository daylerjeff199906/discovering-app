import { clip, invalidFile, parseTime, validLngLat, type ParsedFile, type RawPoint, type RawSegment, type RawWaypoint } from "./types";
import { kid, kids, textOf, type XmlNode } from "./xml";

function pointOf(el: XmlNode): RawPoint | null {
  const lat = Number(el.attrs.lat);
  const lng = Number(el.attrs.lon);
  if (!el.attrs.lat || !el.attrs.lon || !validLngLat(lng, lat)) return null;
  return { lng, lat, time: parseTime(textOf(kid(el, "time"))), accuracyM: null };
}

/** GPX 1.0/1.1: `<trk>/<trkseg>/<trkpt>` (segmentos), `<rte>/<rtept>` (ruta sin fechas) y `<wpt>` (lugares). */
export function parseGpx(root: XmlNode): ParsedFile {
  if (root.name !== "gpx") throw invalidFile("El archivo XML no es un GPX (falta el elemento <gpx>).");
  const segments: RawSegment[] = [];
  const waypoints: RawWaypoint[] = [];
  let skipped = 0;
  let title: string | null = textOf(kid(kid(root, "metadata") ?? root, "name")) || null;

  for (const trk of kids(root, "trk")) {
    title ??= textOf(kid(trk, "name")) || null;
    for (const seg of kids(trk, "trkseg")) {
      const points: RawPoint[] = [];
      for (const el of kids(seg, "trkpt")) {
        const p = pointOf(el);
        if (p) points.push(p);
        else skipped++;
      }
      if (points.length) segments.push({ points });
    }
  }
  for (const rte of kids(root, "rte")) {
    title ??= textOf(kid(rte, "name")) || null;
    const points: RawPoint[] = [];
    for (const el of kids(rte, "rtept")) {
      const p = pointOf(el);
      if (p) points.push(p);
      else skipped++;
    }
    if (points.length) segments.push({ points });
  }
  for (const el of kids(root, "wpt")) {
    const p = pointOf(el);
    if (!p) {
      skipped++;
      continue;
    }
    waypoints.push({
      name: clip(textOf(kid(el, "name")), 120) ?? clip(textOf(kid(el, "desc")), 120) ?? "Punto sin nombre",
      description: clip(textOf(kid(el, "desc")) || textOf(kid(el, "cmt")), 500),
      address: null,
      lng: p.lng,
      lat: p.lat,
      time: p.time,
      endTime: null,
    });
  }
  return { format: "GPX", title: clip(title, 120), segments, waypoints, skipped, warnings: [] };
}
