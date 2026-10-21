import { describe, expect, it } from "vitest";
import { formatDistance, formatDuration, fromLocalInput, legText, toLocalInput } from "./format";

describe("formato", () => {
  it("duraciones y distancias; desconocido = null, nunca 0", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(45 * 60)).toBe("45 min");
    expect(formatDuration(95 * 60)).toBe("1 h 35 min");
    expect(formatDuration(2 * 3600)).toBe("2 h");
    expect(formatDistance(null)).toBeNull();
    expect(formatDistance(820)).toBe("820 m");
    expect(formatDistance(1500)).toBe("1.5 km");
  });

  it("tramos sin datos dicen «Por definir»; los estimados se marcan", () => {
    expect(legText(undefined, "WALK")).toBe("A pie · Por definir");
    expect(legText({ id: "x", fromStopId: "a", toStopId: "b", mode: "BOAT", distanceM: null, durationS: null, source: "none", quality: "UNKNOWN", stale: false }, "BOAT")).toBe("Bote / barco · Por definir");
    expect(legText({ id: "x", fromStopId: "a", toStopId: "b", mode: "WALK", distanceM: 900, durationS: 720, source: "fixture", quality: "ESTIMATED", stale: false }, "WALK")).toBe("A pie · 12 min · 900 m (estimado)");
  });

  it("fecha local ↔ instante respeta la zona IANA (ida y vuelta)", () => {
    const iso = fromLocalInput("2026-03-01T15:00", "America/Lima"); // UTC-5
    expect(iso).toBe("2026-03-01T20:00:00.000Z");
    expect(toLocalInput(iso, "America/Lima")).toBe("2026-03-01T15:00");
    expect(toLocalInput(iso, "Europe/Lisbon")).toBe("2026-03-01T20:00");
    expect(fromLocalInput("2026-07-01T12:00", "Europe/Madrid")).toBe("2026-07-01T10:00:00.000Z"); // horario de verano
  });
});
