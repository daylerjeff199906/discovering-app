import { describe, expect, it } from "vitest";
import { createVisitInputSchema, passwordSchema, publishInputSchema, registerInputSchema, safeReturnTo, usernameSchema } from "./index";

describe("safeReturnTo", () => {
  it("solo admite rutas internas conocidas", () => {
    expect(safeReturnTo("/app/viajes/123/editar?x=1")).toBe("/app/viajes/123/editar?x=1");
    expect(safeReturnTo("/r/mi-historia")).toBe("/r/mi-historia");
    expect(safeReturnTo("/")).toBe("/");
  });
  it("rechaza redirecciones abiertas y esquemas ajenos", () => {
    for (const bad of ["https://evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "/admin", "/api/v1/auth/logout", "", null, undefined]) {
      expect(safeReturnTo(bad as string)).toBe("/app/viajes");
    }
  });
});

describe("esquemas de autenticación", () => {
  it("exige contraseña de 10+ caracteres con letra y número", () => {
    expect(passwordSchema.safeParse("corta1").success).toBe(false);
    expect(passwordSchema.safeParse("sololetrasaqui").success).toBe(false);
    expect(passwordSchema.safeParse("1234567890123").success).toBe(false);
    expect(passwordSchema.safeParse("claveSegura123").success).toBe(true);
  });
  it("valida username y normaliza el correo", () => {
    expect(usernameSchema.safeParse("ab").success).toBe(false);
    expect(usernameSchema.safeParse("hola mundo").success).toBe(false);
    expect(usernameSchema.safeParse("ana_01").success).toBe(true);
    const r = registerInputSchema.safeParse({ displayName: " Ana ", username: "ana_01", email: "  ANA@Example.COM ", password: "claveSegura123", passwordConfirm: "claveSegura123", acceptTerms: true, termsVersion: "x" });
    expect(r.success && r.data.email).toBe("ana@example.com");
    expect(r.success && r.data.displayName).toBe("Ana");
  });
  it("detecta contraseñas distintas y términos no aceptados", () => {
    const r = registerInputSchema.safeParse({ displayName: "Ana", username: "ana_01", email: "a@b.co", password: "claveSegura123", passwordConfirm: "otra", acceptTerms: false, termsVersion: "x" });
    expect(r.success).toBe(false);
  });
});

describe("visitas y publicación", () => {
  const base = { clientMutationId: "abcdefgh1234", visitedAt: "2026-03-01T15:00:00-05:00", timezone: "America/Lima" };
  it("una visita necesita un lugar existente O uno nuevo (nunca ambos ni ninguno)", () => {
    expect(createVisitInputSchema.safeParse({ ...base }).success).toBe(false);
    expect(createVisitInputSchema.safeParse({ ...base, placeId: "7d4a3c1e-5c52-4a3a-9a55-0f0b6e5d3a10" }).success).toBe(true);
    expect(createVisitInputSchema.safeParse({ ...base, newPlace: { name: "Mirador", lng: -73, lat: -3 } }).success).toBe(true);
    expect(createVisitInputSchema.safeParse({ ...base, placeId: "7d4a3c1e-5c52-4a3a-9a55-0f0b6e5d3a10", newPlace: { name: "x", lng: 0, lat: 0 } }).success).toBe(false);
  });
  it("rechaza zonas horarias y coordenadas inválidas", () => {
    expect(createVisitInputSchema.safeParse({ ...base, timezone: "Mars/Olympus", newPlace: { name: "x", lng: 0, lat: 0 } }).success).toBe(false);
    expect(createVisitInputSchema.safeParse({ ...base, newPlace: { name: "x", lng: 200, lat: 0 } }).success).toBe(false);
  });
  it("publicar: trayecto exacto desactivado por omisión y al menos una visita", () => {
    expect(publishInputSchema.safeParse({ title: "x", visibility: "PUBLIC", entries: [] }).success).toBe(false);
    const ok = publishInputSchema.parse({ title: "x", visibility: "PUBLIC", entries: [{ visitId: "7d4a3c1e-5c52-4a3a-9a55-0f0b6e5d3a10" }] });
    expect(ok.shareExactTrack).toBe(false);
    expect(ok.entries[0]!.includeNote).toBe(false);
    expect(ok.entries[0]!.locationPrecision).toBe("EXACT");
  });
});
