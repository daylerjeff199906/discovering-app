import { randomUUID } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { IMPORT_ERROR_CODES, type ImportFormat, type ImportOptions, type ImportPreview, type ImportResult } from "@por-aqui/contracts";
import { journeys, places, profiles, recordings, trackPoints, trackSegments, visits, type Db } from "@por-aqui/database";
import { and, eq } from "drizzle-orm";
import type { AuthUser } from "../../common/decorators";
import { AppError } from "../../common/errors";
import { haversineM } from "../../common/geo";
import { ENV, type Env } from "../../config/env";
import { DB } from "../../infrastructure/tokens";
import { defaultPreferences } from "../journeys/journey.mapper";
import { placeSnapshot, type PlaceRow } from "../places/places.service";
import { normalizeImport, toPreview, type ImportLimits, type NormalizedImport, type NormalizedWaypoint } from "./normalize";
import { parseImportFile } from "./parsers";

const FORMAT_LABELS: Record<ImportFormat, string> = {
  GPX: "GPX",
  KML: "KML",
  TAKEOUT_TIMELINE: "Google Takeout (Timeline)",
  TAKEOUT_PLACES: "Google Takeout (Lugares guardados)",
};

/** Un lugar personal ya existente se reutiliza si tiene el mismo nombre y está a menos de esta distancia. */
const REUSE_RADIUS_M = 75;
/** Filas por INSERT: 5 columnas × 5000 queda lejos del límite de 65 535 parámetros de Postgres. */
const POINT_BATCH = 5000;
const ROW_BATCH = 500;

const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Nombre original del archivo, sin ruta ni caracteres de control. multer lo entrega como latin1. */
export function cleanFileName(raw: string | undefined): string | null {
  if (!raw) return null;
  let name = raw;
  try {
    const utf8 = Buffer.from(raw, "latin1").toString("utf8");
    if (!utf8.includes("�")) name = utf8;
  } catch {
    /* se conserva el original */
  }
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\\/]+/g, "/").split("/").pop()!.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return name ? name.slice(0, 120) : null;
}

function titleFromFileName(name: string | null): string | null {
  const base = name?.replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
  return base ? base.slice(0, 120) : null;
}

@Injectable()
export class ImportsService {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private get limits(): ImportLimits {
    return { maxAccuracyM: this.env.TRACK_MAX_ACCURACY_M, minDistanceM: this.env.TRACK_MIN_DISTANCE_M, maxPoints: this.env.IMPORT_MAX_POINTS, maxWaypoints: this.env.IMPORT_MAX_WAYPOINTS };
  }

  private analyze(buffer: Buffer, options: ImportOptions): NormalizedImport {
    if (buffer.length > this.env.IMPORT_MAX_BYTES) throw new AppError(413, IMPORT_ERROR_CODES.TOO_LARGE, "El archivo supera el tamaño máximo permitido.");
    return normalizeImport(parseImportFile(buffer), options, this.limits);
  }

  private titleFor(n: NormalizedImport, options: ImportOptions, fileName: string | null): string {
    return options.title ?? n.parsed.title ?? titleFromFileName(fileName) ?? "Recorrido importado";
  }

  /** Lee y filtra el archivo sin guardar nada: es lo que se enseña antes de confirmar. */
  preview(buffer: Buffer, options: ImportOptions, fileName: string | null): ImportPreview {
    const n = this.analyze(buffer, options);
    return toPreview(n, this.titleFor(n, options, fileName));
  }

  async import(user: AuthUser, buffer: Buffer, options: ImportOptions, fileName: string | null): Promise<ImportResult> {
    const n = this.analyze(buffer, options);
    const title = this.titleFor(n, options, fileName);
    const [profile] = await this.db.select({ tz: profiles.timezone }).from(profiles).where(eq(profiles.userId, user.id));
    const timezone = options.timezone ?? profile?.tz ?? "UTC";
    const startedAt = n.startedAt!;
    const endedAt = n.endedAt!;

    return this.db.transaction(async (tx) => {
      const [journey] = await tx
        .insert(journeys)
        .values({
          ownerId: user.id,
          title,
          description: `Importado desde ${FORMAT_LABELS[n.parsed.format]}${fileName ? ` (${fileName})` : ""}.`.slice(0, 500),
          creationMode: "FREE",
          preferencesJson: defaultPreferences(),
        })
        .returning({ id: journeys.id });

      // Watermarks finales = última secuencia de cada segmento, como si el cliente hubiera sincronizado todo.
      const watermarks = Object.fromEntries(n.segments.map((s) => [s.clientSegmentId, s.points.length - 1]));
      const [rec] = await tx
        .insert(recordings)
        .values({ journeyId: journey!.id, status: "COMPLETED", startedAt, endedAt, trackWatermarks: watermarks })
        .returning({ id: recordings.id });

      for (const s of n.segments) {
        const [seg] = await tx
          .insert(trackSegments)
          .values({ recordingId: rec!.id, clientSegmentId: s.clientSegmentId, startedAt: s.startedAt, endedAt: s.endedAt })
          .returning({ id: trackSegments.id });
        for (const part of chunk(s.points, POINT_BATCH)) {
          await tx.insert(trackPoints).values(part.map((p) => ({ segmentId: seg!.id, clientSequence: p.seq, recordedAt: p.recordedAt, location: { lng: p.lng, lat: p.lat }, accuracyM: p.accuracyM })));
        }
      }

      const placed = await this.linkPlaces(tx, user, n.waypoints);
      for (const part of chunk(n.waypoints.map((w, i) => ({ w, i })), ROW_BATCH)) {
        await tx.insert(visits).values(
          part.map(({ w, i }) => ({
            recordingId: rec!.id,
            journeyId: journey!.id,
            ownerId: user.id,
            placeId: placed.rows[i]!.id,
            visitedAt: w.visitedAt,
            endedAt: w.endedAt,
            timezone,
            note: w.description?.slice(0, 4000) ?? null,
            placeSnapshotJson: placeSnapshot(placed.rows[i]!),
            clientMutationId: `import-${i + 1}`,
          })),
        );
      }
      return {
        journeyId: journey!.id,
        recordingId: rec!.id,
        pointsCount: n.segments.reduce((c, s) => c + s.points.length, 0),
        visitsCount: n.waypoints.length,
        placesCreated: placed.created,
        placesReused: placed.reused,
        warnings: n.warnings,
      };
    });
  }

  /**
   * Para cada waypoint devuelve el lugar personal al que se liga: uno existente del usuario con el mismo nombre
   * y a menos de 75 m, o uno nuevo (privado). Los lugares creados en esta misma importación también se reutilizan.
   */
  private async linkPlaces(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], user: AuthUser, waypoints: NormalizedWaypoint[]): Promise<{ rows: PlaceRow[]; created: number; reused: number }> {
    if (waypoints.length === 0) return { rows: [], created: 0, reused: 0 };
    const known: PlaceRow[] = await tx.select().from(places).where(and(eq(places.scope, "PERSONAL"), eq(places.ownerId, user.id)));
    const reusedIds = new Set<string>();
    const fresh: (typeof places.$inferInsert & { id: string })[] = [];
    const freshByKey: PlaceRow[] = [];
    const choice: ({ existing: PlaceRow } | { freshIndex: number })[] = [];

    for (const w of waypoints) {
      const key = norm(w.name);
      const hit = known.find((p) => norm(p.name) === key && haversineM(p.location, w) <= REUSE_RADIUS_M);
      if (hit) {
        reusedIds.add(hit.id);
        choice.push({ existing: hit });
        continue;
      }
      const dup = fresh.findIndex((p) => norm(p.name) === key && haversineM(p.location as { lng: number; lat: number }, w) <= REUSE_RADIUS_M);
      if (dup !== -1) {
        choice.push({ freshIndex: dup });
        continue;
      }
      fresh.push({ id: randomUUID(), scope: "PERSONAL", ownerId: user.id, name: w.name, description: w.description?.slice(0, 500) ?? null, address: w.address, location: { lng: w.lng, lat: w.lat } });
      choice.push({ freshIndex: fresh.length - 1 });
    }

    for (const part of chunk(fresh, ROW_BATCH)) freshByKey.push(...(await tx.insert(places).values(part).returning()));
    const byId = new Map(freshByKey.map((p) => [p.id, p]));
    const rows = choice.map((c) => ("existing" in c ? c.existing : byId.get(fresh[c.freshIndex]!.id)!));
    return { rows, created: fresh.length, reused: reusedIds.size };
  }
}
