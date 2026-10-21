import { describe, expect, it } from "vitest";
import { haversineM } from "../src/common/geo";
import { improveOrder, openDuring, planRoute, type Candidate, type MatrixFn } from "../src/modules/planning/planner";

const place = (id: string, lng: number, lat: number, extra: Partial<Candidate> = {}): Candidate => ({
  id,
  snapshot: { name: id, description: null, lng, lat, locality: "X", region: null, countryCode: null, address: null, scope: "CATALOG" },
  interests: ["historia"],
  typicalMinutes: 60,
  openingHours: null,
  ...extra,
});

const noRouting: MatrixFn = async () => null;
const params = { daysCount: 1, minutesPerDay: 480, interests: [] as string[], pace: "MODERATE" as const, transport: "WALK" as const };

describe("planner", () => {
  it("2-opt mejora un recorrido cruzado y no empeora uno óptimo", () => {
    const pts = [
      { lng: 0, lat: 0 },
      { lng: 0.02, lat: 0.02 },
      { lng: 0.01, lat: 0 },
      { lng: 0.03, lat: 0.02 },
    ];
    const d = (a: number, b: number) => haversineM(pts[a]!, pts[b]!);
    const len = (o: number[]) => o.slice(1).reduce((s, v, i) => s + d(o[i]!, v), 0);
    const crossed = [0, 1, 2, 3];
    const better = improveOrder(crossed, d);
    expect(len(better)).toBeLessThanOrEqual(len(crossed));
    expect(improveOrder(better, d)).toEqual(better);
  });

  it("respeta el máximo de paradas por ritmo y el tiempo disponible", async () => {
    const cands = Array.from({ length: 12 }, (_, i) => place(`p${i}`, i * 0.001, 0));
    const relaxed = await planRoute(cands, { ...params, pace: "RELAXED" }, noRouting, "X", 1);
    expect(relaxed.days[0]!.stops.length).toBe(3);
    const tight = await planRoute(cands, { ...params, minutesPerDay: 150, pace: "INTENSE" }, noRouting, "X", 1);
    expect(tight.days[0]!.stops.length).toBe(2); // 2 × 60 min ≤ 150
  });

  it("sin proveedor: traslados null y advertencia explícita; nunca inventa tiempos", async () => {
    const r = await planRoute([place("a", 0, 0), place("b", 0.01, 0)], params, noRouting, "X", 1);
    expect(r.days[0]!.legs).toEqual([expect.objectContaining({ durationS: null, distanceM: null, quality: "UNKNOWN" })]);
    expect(r.warnings.map((w) => w.code)).toContain("ROUTING_UNAVAILABLE");
  });

  it("con traslados conocidos recorta el día si no entra", async () => {
    const slow: MatrixFn = async (pts) => ({ durations: pts.map(() => pts.map(() => 3 * 3600)), distances: pts.map(() => pts.map(() => 9000)), source: "test", quality: "PROVIDER" });
    const cands = [place("a", 0, 0), place("b", 0.01, 0), place("c", 0.02, 0), place("d", 0.03, 0)];
    const r = await planRoute(cands, { ...params, minutesPerDay: 480 }, slow, "X", 1);
    const stops = r.days[0]!.stops.length;
    expect(stops).toBeLessThan(4); // 4 visitas + 3 traslados de 3 h no caben en 8 h
    const total = r.days[0]!.plannedSeconds;
    expect(total).toBeLessThanOrEqual(480 * 60);
  });

  it("horarios: omite lugares cerrados y marca los de horario desconocido", async () => {
    // 2026-10-21 es miércoles
    const closedOnWed = place("cerrado", 0, 0, { openingHours: { wed: [], mon: [["09:00", "18:00"]] } as never });
    const open = place("abierto", 0.001, 0, { openingHours: { wed: [["08:00", "20:00"]] } });
    const unknown = place("desconocido", 0.002, 0);
    const r = await planRoute([closedOnWed, open, unknown], { ...params, startDate: "2026-10-21" }, noRouting, "X", 1);
    const names = r.days[0]!.stops.map((s) => s.place.name);
    expect(names).not.toContain("cerrado");
    expect(names).toEqual(expect.arrayContaining(["abierto", "desconocido"]));
    expect(r.days[0]!.stops.find((s) => s.place.name === "desconocido")!.hoursKnown).toBe(false);
    expect(r.warnings.map((w) => w.code)).toContain("HOURS_UNKNOWN");
    expect(openDuring({ wed: [["08:00", "20:00"]] }, "2026-10-21", 9 * 60, 60)).toBe(true);
    expect(openDuring({ wed: [["08:00", "10:00"]] }, "2026-10-21", 9 * 60 + 30, 60)).toBe(false);
    expect(openDuring(null, "2026-10-21", 540, 60)).toBeNull();
  });

  it("prioriza intereses y avisa si coinciden pocos; sin candidatos devuelve NO_DATA", async () => {
    const cands = [place("hist", 0, 0, { interests: ["historia"] }), place("nat", 0.001, 0, { interests: ["naturaleza"] })];
    const r = await planRoute(cands, { ...params, interests: ["naturaleza"], pace: "RELAXED" }, noRouting, "X", 1);
    expect(r.days[0]!.stops[0]!.place.name).toBe("nat");
    expect(r.warnings.map((w) => w.code)).toContain("FEW_INTEREST_MATCHES");
    const empty = await planRoute([], params, noRouting, "X", 1);
    expect(empty.days).toHaveLength(0);
    expect(empty.partial).toBe(true);
    expect(empty.warnings[0]!.code).toBe("NO_DATA");
  });

  it("reparte entre días sin repetir lugares y marca parcial si faltan", async () => {
    const cands = Array.from({ length: 4 }, (_, i) => place(`p${i}`, i * 0.001, 0));
    const r = await planRoute(cands, { ...params, daysCount: 3, minutesPerDay: 120 }, noRouting, "X", 1);
    const ids = r.days.flatMap((d) => d.stops.map((s) => s.placeId));
    expect(new Set(ids).size).toBe(ids.length);
    expect(r.days.length).toBe(2); // 4 lugares × 60 min en días de 120 → 2 días
    expect(r.partial).toBe(true);
  });
});
