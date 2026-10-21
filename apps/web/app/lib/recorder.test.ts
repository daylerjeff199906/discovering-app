import { describe, expect, it } from "vitest";
import { shouldKeep } from "./recorder";

const cfg = { maxAccuracyM: 100, minDistanceM: 10, gapMs: 60_000 };
const here = { lng: -73.25, lat: -3.75 };

describe("filtro de puntos GPS", () => {
  it("descarta fixes imprecisos y acepta el primero", () => {
    expect(shouldKeep(null, { ...here, accuracyM: 20 }, cfg)).toBe(true);
    expect(shouldKeep(null, { ...here, accuracyM: 500 }, cfg)).toBe(false);
    expect(shouldKeep(null, { ...here, accuracyM: null }, cfg)).toBe(true); // precisión desconocida: no se inventa
  });
  it("ignora movimientos menores al umbral (ruido) y acepta los reales", () => {
    // 0.00005° ≈ 5,5 m  |  0.0002° ≈ 22 m
    expect(shouldKeep(here, { lng: here.lng + 0.00005, lat: here.lat, accuracyM: 5 }, cfg)).toBe(false);
    expect(shouldKeep(here, { lng: here.lng + 0.0002, lat: here.lat, accuracyM: 5 }, cfg)).toBe(true);
  });
});
