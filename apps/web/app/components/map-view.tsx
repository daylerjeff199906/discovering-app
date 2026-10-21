import * as maplibregl from "maplibre-gl";
import type { Map as MlMap, Marker, StyleSpecification } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
// MapLibre 6 carga su worker como archivo aparte: se emite con Vite (?url) y se registra explícitamente.
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";
import { useEffect, useRef, useState } from "react";
import type { MapLine, MapMarker } from "./map";

maplibregl.setWorkerUrl(workerUrl);

const TILES = import.meta.env.VITE_MAP_TILES_URL || "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const ATTRIBUTION = import.meta.env.VITE_MAP_ATTRIBUTION || "© OpenStreetMap contributors";

const STYLE: StyleSpecification = {
  version: 8,
  sources: { base: { type: "raster", tiles: [TILES], tileSize: 256, attribution: ATTRIBUTION, maxzoom: 19 } },
  layers: [{ id: "base", type: "raster", source: "base" }],
};

function markerElement(m: MapMarker, selected: boolean) {
  const el = document.createElement("button");
  el.type = "button";
  el.setAttribute("aria-label", m.label ?? `Punto ${m.index ?? ""}`);
  const base = "display:flex;align-items:center;justify-content:center;border-radius:9999px;font:700 13px Inter,system-ui,sans-serif;cursor:pointer;";
  const size = selected ? 38 : 32;
  const palette =
    m.state === "visited"
      ? "background:#194B35;color:#fff;border:2px solid #fff;"
      : m.state === "current"
        ? "background:#fff;color:#194B35;border:3px solid #194B35;"
        : "background:#FFFCF6;color:#596359;border:2px dashed #7B877C;";
  el.style.cssText = `${base}width:${size}px;height:${size}px;${palette}box-shadow:0 1px 4px rgba(0,0,0,.35);${selected ? "outline:3px solid #2C6B48;outline-offset:2px;" : ""}`;
  el.textContent = m.index !== undefined ? String(m.index) : "•";
  return el;
}

/** Mapa de geografía (el caminito representa la secuencia; esto, el territorio). Solo se carga en el navegador. */
export default function MapView({ markers, lines = [], selectedId, onSelect, onMapClick, fitKey, className, ariaLabel = "Mapa del recorrido", clickHint }: {
  markers: MapMarker[];
  lines?: MapLine[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMapClick?: (p: { lng: number; lat: number }) => void;
  fitKey?: string;
  className?: string;
  ariaLabel?: string;
  clickHint?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerRefs = useRef<Marker[]>([]);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const clickRef = useRef(onMapClick);
  clickRef.current = onMapClick;

  useEffect(() => {
    if (!container.current) return;
    let map: MlMap;
    try {
      map = new maplibregl.Map({ container: container.current, style: STYLE, center: [-73.25, -3.75], zoom: 11, attributionControl: { compact: true } });
    } catch {
      setFailed(true); // sin WebGL
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    // `style.load` (no `load`): los marcadores y líneas no deben depender de que lleguen los tiles de la red.
    map.once("style.load", () => setReady(true));
    map.on("click", (e) => clickRef.current?.({ lng: e.lngLat.lng, lat: e.lngLat.lat }));
    map.on("error", () => undefined);
    return () => {
      map.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // Marcadores
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    markerRefs.current.forEach((m) => m.remove());
    markerRefs.current = markers.map((m) => {
      const el = markerElement(m, m.id === selectedId);
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelect?.(m.id);
      });
      return new maplibregl.Marker({ element: el }).setLngLat([m.lng, m.lat]).addTo(map);
    });
  }, [markers, selectedId, ready, onSelect]);

  // Líneas (trayecto GPS autorizado o secuencia aproximada)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const data = { type: "FeatureCollection" as const, features: lines.filter((l) => l.coords.length >= 2).map((l) => ({ type: "Feature" as const, properties: { dashed: l.dashed ? 1 : 0 }, geometry: { type: "LineString" as const, coordinates: l.coords } })) };
    const src = map.getSource("lines") as maplibregl.GeoJSONSource | undefined;
    if (src) src.setData(data);
    else {
      map.addSource("lines", { type: "geojson", data });
      map.addLayer({ id: "lines-solid", type: "line", source: "lines", filter: ["==", ["get", "dashed"], 0], paint: { "line-color": "#194B35", "line-width": 4, "line-opacity": 0.85 }, layout: { "line-cap": "round", "line-join": "round" } });
      map.addLayer({ id: "lines-dashed", type: "line", source: "lines", filter: ["==", ["get", "dashed"], 1], paint: { "line-color": "#194B35", "line-width": 2.5, "line-dasharray": [1, 2], "line-opacity": 0.7 } });
    }
  }, [lines, ready]);

  // Encuadre cuando cambia el conjunto de puntos
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pts = [...markers.map((m) => [m.lng, m.lat] as [number, number]), ...lines.flatMap((l) => l.coords)];
    if (pts.length === 0) return;
    if (pts.length === 1) return void map.easeTo({ center: pts[0]!, zoom: 14, duration: 200 });
    const b = new maplibregl.LngLatBounds(pts[0]!, pts[0]!);
    pts.forEach((p) => b.extend(p));
    map.fitBounds(b, { padding: 56, maxZoom: 16, duration: 250 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready]);

  // Centrar en la parada seleccionada
  useEffect(() => {
    const map = mapRef.current;
    const m = markers.find((x) => x.id === selectedId);
    if (map && ready && m) map.easeTo({ center: [m.lng, m.lat], duration: 250 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, ready]);

  if (failed) {
    return (
      <div role="note" className={`flex items-center justify-center rounded-card border border-border bg-surface-muted p-6 text-center text-sm text-muted-foreground ${className ?? ""}`}>
        Tu navegador no puede mostrar el mapa (WebGL no disponible). El recorrido sigue disponible en la lista.
      </div>
    );
  }
  return (
    <div className={`relative overflow-hidden rounded-card border border-border ${className ?? ""}`}>
      {/* Estilo en línea: maplibre-gl.css fija `.maplibregl-map { position: relative }` y pisaría una clase utilitaria. */}
      <div ref={container} role="region" aria-label={ariaLabel} style={{ position: "absolute", inset: 0 }} />
      {clickHint ? <p className="pointer-events-none absolute bottom-6 left-2 rounded-control bg-surface/90 px-2 py-1 text-xs shadow-card">{clickHint}</p> : null}
    </div>
  );
}
