import type { JourneyDto } from "@por-aqui/contracts";
import { describe, expect, it } from "vitest";
import { applyLayout, flattenStops, layoutOf, moveStop, shiftStop, stopStates, summarize } from "./trail";

const stop = (id: string, dayId: string, position: number, name = id) => ({ id, dayId, position, placeId: `p-${id}`, visitDurationSeconds: 3600, version: 1, place: { name, description: null, lng: 0, lat: 0, locality: null, region: null, countryCode: null, address: null, scope: "CATALOG" as const } });
const journey = (status: JourneyDto["status"] = "IN_PROGRESS"): JourneyDto =>
  ({
    id: "j",
    title: "t",
    description: null,
    creationMode: "MANUAL",
    planStatus: "READY",
    status,
    preferences: { interests: [], pace: "MODERATE", transport: "WALK" },
    version: 1,
    archivedAt: null,
    createdAt: "",
    updatedAt: "",
    sourcePublicationId: null,
    recording: null,
    visitsCount: 0,
    legs: [{ id: "l1", fromStopId: "a", toStopId: "b", mode: "WALK", distanceM: 800, durationS: 600, source: "test", quality: "ESTIMATED", stale: false }],
    days: [
      { id: "d1", position: 0, localDate: null, timezone: "UTC", destinationLabel: null, stops: [stop("a", "d1", 0), stop("b", "d1", 1), stop("c", "d1", 2)] },
      { id: "d2", position: 1, localDate: null, timezone: "UTC", destinationLabel: null, stops: [stop("d", "d2", 0)] },
    ],
  }) as JourneyDto;

describe("reordenamiento", () => {
  it("mueve dentro de un día", () => {
    expect(moveStop(layoutOf(journey()), "a", "d1", 2)[0]!.stopIds).toEqual(["b", "c", "a"]);
    expect(moveStop(layoutOf(journey()), "c", "d1", 0)[0]!.stopIds).toEqual(["c", "a", "b"]);
  });
  it("mueve entre días y conserva todas las paradas exactamente una vez", () => {
    const l = moveStop(layoutOf(journey()), "b", "d2", 0);
    expect(l.map((d) => d.stopIds)).toEqual([["a", "c"], ["b", "d"]]);
    expect(l.flatMap((d) => d.stopIds).sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("subir/bajar cruza al día vecino en los extremos y devuelve null en los límites del viaje", () => {
    const l = layoutOf(journey());
    expect(shiftStop(l, "b", -1)![0]!.stopIds).toEqual(["b", "a", "c"]);
    expect(shiftStop(l, "c", 1)!.map((d) => d.stopIds)).toEqual([["a", "b"], ["c", "d"]]);
    expect(shiftStop(l, "d", -1)!.map((d) => d.stopIds)).toEqual([["a", "b", "c", "d"], []]);
    expect(shiftStop(l, "a", -1)).toBeNull();
    expect(shiftStop(l, "d", 1)).toBeNull();
  });
  it("applyLayout actualiza dayId y position para la vista optimista", () => {
    const j = applyLayout(journey(), moveStop(layoutOf(journey()), "a", "d2", 1));
    expect(j.days[1]!.stops.map((s) => [s.id, s.dayId, s.position])).toEqual([["d", "d2", 0], ["a", "d2", 1]]);
    expect(j.days[0]!.stops.map((s) => s.position)).toEqual([0, 1]);
  });
});

describe("estados del caminito", () => {
  it("visitado / actual (primera sin visitar en curso) / pendiente", () => {
    const states = stopStates(journey("IN_PROGRESS"), [{ stopId: "a" }, { stopId: "b" }] as never);
    expect([...states.entries()]).toEqual([["a", "visited"], ["b", "visited"], ["c", "current"], ["d", "pending"]]);
    expect(stopStates(journey("PLANNED"), []).get("a")).toBe("pending"); // sin recorrido no hay «actual»
  });
  it("numera de forma continua entre días", () => {
    expect(flattenStops(journey()).map((s) => s.index)).toEqual([1, 2, 3, 4]);
  });
  it("el resumen no inventa tiempos: cuenta traslados desconocidos", () => {
    const s = summarize(journey());
    expect(s).toMatchObject({ stops: 4, visitSeconds: 14400, unknownVisits: 0, travelSeconds: 600, estimatedLegs: 1 });
    expect(s.unknownLegs).toBe(1); // a→b tiene dato; b→c no; el día 2 tiene una sola parada
  });
});
