import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from "react";

export interface MapMarker {
  id: string;
  lng: number;
  lat: number;
  label?: string;
  index?: number;
  state?: "pending" | "current" | "visited";
}
export interface MapLine {
  id: string;
  coords: [number, number][];
  dashed?: boolean;
}

/** Un fallo del mapa (WebGL, worker, red) nunca debe tumbar la pantalla: se muestra un aviso y la lista sigue disponible. */
class MapBoundary extends Component<{ children: ReactNode; className: string }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(err: unknown) {
    console.error("[mapa]", err);
  }
  override render() {
    if (this.state.failed) {
      return (
        <div role="note" className={`flex items-center justify-center rounded-card border border-border bg-surface-muted p-6 text-center text-sm text-muted-foreground ${this.props.className}`}>
          No pudimos cargar el mapa. El recorrido sigue disponible en la lista.
        </div>
      );
    }
    return this.props.children;
  }
}

// MapLibre/WebGL solo en el navegador y solo cuando una pantalla lo necesita (no se carga en login/registro).
const MapView = lazy(() => import("./map-view"));

export function MapPanel(props: {
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
  const [client, setClient] = useState(false);
  useEffect(() => setClient(true), []);
  const box = props.className ?? "h-80";
  if (!client) return <div className={`rounded-card border border-border bg-surface-muted ${box}`} aria-hidden="true" />;
  return (
    <MapBoundary className={box}>
      <Suspense fallback={<div className={`animate-pulse rounded-card border border-border bg-surface-muted ${box}`} role="status" aria-label="Cargando mapa" />}>
        <MapView {...props} className={box} />
      </Suspense>
    </MapBoundary>
  );
}
