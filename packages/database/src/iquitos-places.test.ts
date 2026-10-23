import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { imagesDir, loadIquitosData } from "./iquitos-places";
import { INTERESTS, PLACES } from "./seed-data";

const data = loadIquitosData();
const LICENSE = /^(CC BY(-SA)? [1-4]\.\d|CC0|Public domain)/i;

describe("data/iquitos-places.json", () => {
  it("tiene claves únicas (el proveedor propio evita chocar con los lugares de demostración)", () => {
    const keys = data.places.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(data.provider).not.toBe("demo-seed");
  });

  it("cada lugar sustituye como máximo un lugar de demostración existente", () => {
    const demo = new Set(PLACES.map((p) => p.key));
    const replaced = data.places.flatMap((p) => (p.supersedesDemo ? [p.supersedesDemo] : []));
    expect(new Set(replaced).size).toBe(replaced.length);
    for (const key of replaced) expect(demo.has(key)).toBe(true);
  });

  it("usa solo intereses conocidos, textos acotados y coordenadas válidas", () => {
    const interests = new Set<string>(INTERESTS.map((i) => i.slug));
    for (const p of data.places) {
      expect(p.interests.length).toBeGreaterThan(0);
      for (const slug of p.interests) expect(interests.has(slug), `${p.key}: interés ${slug}`).toBe(true);
      expect(p.description.length).toBeGreaterThan(80);
      expect(p.description.length).toBeLessThanOrEqual(1000);
      expect(p.name.length).toBeLessThanOrEqual(120);
      expect(p.category.length).toBeLessThanOrEqual(100);
      expect(p.lat).toBeLessThan(-3);
      expect(p.lat).toBeGreaterThan(-5);
      expect(p.lng).toBeLessThan(-73);
      expect(p.lng).toBeGreaterThan(-74);
      expect(p.sources.length).toBeGreaterThan(0);
      for (const s of p.sources) expect(s.url).toMatch(/^https:\/\//);
    }
  });

  it("cada imagen existe, es WebP del catálogo y trae atribución con licencia libre", () => {
    for (const p of data.places) {
      const { image } = p;
      expect(image.commonsFile, p.key).toMatch(/^File:/);
      expect(image.file, `${p.key}: falta imagen (pnpm db:images:iquitos)`).toBe(`/images/lugares/${p.key}.webp`);
      expect(existsSync(path.join(imagesDir(), `${p.key}.webp`)), `${p.key}: falta el archivo`).toBe(true);
      const c = image.credit;
      expect(c, `${p.key}: falta crédito`).toBeDefined();
      expect(c!.license).toMatch(LICENSE);
      expect(c!.license).not.toMatch(/NC|ND/);
      expect(c!.author.length).toBeGreaterThan(0);
      expect(c!.sourceUrl).toMatch(/^https:\/\/commons\.wikimedia\.org\/wiki\/File:/);
      expect(c!.licenseUrl).toMatch(/^https:\/\//);
    }
  });
});
