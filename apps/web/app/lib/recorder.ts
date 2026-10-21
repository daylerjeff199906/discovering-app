import { enqueuePoint, openSegment, QueueFullError } from "./offline-queue";

export type GpsStatus = "idle" | "asking" | "tracking" | "denied" | "unavailable" | "error" | "full";

export interface RecorderEvents {
  onStatus: (s: GpsStatus, detail?: string) => void;
  onPoint: (p: { lng: number; lat: number; accuracyM: number | null; at: string }) => void;
}

export interface RecorderConfig {
  maxAccuracyM: number;
  minDistanceM: number;
  /** Si pasa este tiempo sin fixes se abre un NUEVO segmento: nunca se unen huecos como si se hubieran recorrido. */
  gapMs: number;
}

const toRad = (d: number) => (d * Math.PI) / 180;
function distanceM(a: { lng: number; lat: number }, b: { lng: number; lat: number }) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Decide si un fix se registra (precisión y distancia mínima). Pura y probada aparte. */
export function shouldKeep(prev: { lng: number; lat: number } | null, next: { lng: number; lat: number; accuracyM: number | null }, cfg: RecorderConfig): boolean {
  if (next.accuracyM !== null && next.accuracyM > cfg.maxAccuracyM) return false;
  if (!prev) return true;
  return distanceM(prev, next) >= cfg.minDistanceM;
}

/**
 * Captura en PRIMER PLANO con la Geolocation API. No promete seguimiento con pantalla bloqueada,
 * navegador cerrado ni pestaña suspendida: si el sistema suspende la pestaña, la captura se interrumpe.
 */
export class TrackRecorder {
  private watchId: number | null = null;
  private segmentId: string | null = null;
  private last: { lng: number; lat: number; at: number } | null = null;

  constructor(
    private readonly userId: string,
    private readonly recordingId: string,
    private readonly cfg: RecorderConfig,
    private readonly ev: RecorderEvents,
  ) {}

  get active() {
    return this.watchId !== null;
  }

  start(): void {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      this.ev.onStatus("unavailable");
      return;
    }
    this.ev.onStatus("asking"); // el permiso se pide SOLO ahora, al activar «Registrar trayecto»
    this.segmentId = null;
    this.last = null;
    this.watchId = navigator.geolocation.watchPosition(
      (pos) => void this.onFix(pos),
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          this.stop();
          this.ev.onStatus("denied");
        } else {
          this.ev.onStatus("error", err.message);
        }
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
  }

  stop(): void {
    if (this.watchId !== null) navigator.geolocation.clearWatch(this.watchId);
    this.watchId = null;
    this.segmentId = null; // la siguiente reanudación abre otro segmento
    this.ev.onStatus("idle");
  }

  private async onFix(pos: GeolocationPosition) {
    const now = pos.timestamp || Date.now();
    const p = { lng: pos.coords.longitude, lat: pos.coords.latitude, accuracyM: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null };
    try {
      if (!this.segmentId || (this.last && now - this.last.at > this.cfg.gapMs)) {
        this.segmentId = crypto.randomUUID();
        this.last = null;
        await openSegment(this.userId, this.recordingId, this.segmentId, new Date(now).toISOString());
      }
      this.ev.onStatus("tracking");
      if (!shouldKeep(this.last, p, this.cfg)) return;
      await enqueuePoint(this.userId, { recordingId: this.recordingId, segmentClientId: this.segmentId, segmentStartedAt: new Date(now).toISOString(), recordedAt: new Date(now).toISOString(), lng: p.lng, lat: p.lat, accuracyM: p.accuracyM });
      this.last = { lng: p.lng, lat: p.lat, at: now };
      this.ev.onPoint({ ...p, at: new Date(now).toISOString() });
    } catch (err) {
      if (err instanceof QueueFullError) {
        this.stop();
        this.ev.onStatus("full", err.message);
      } else this.ev.onStatus("error", String(err));
    }
  }
}
