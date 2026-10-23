import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Crédito de una imagen de Wikimedia Commons (licencia libre con atribución). */
export interface ImageCredit {
  title: string;
  author: string;
  license: string;
  licenseUrl: string;
  sourceUrl: string;
}

export interface IquitosImage {
  commonsFile: string;
  /** Ruta pública servida por el web, p. ej. `/images/lugares/iq-plaza-armas.webp`. Rellenada por `db:images:iquitos`. */
  file?: string;
  width?: number;
  height?: number;
  sha256?: string;
  retrievedOn?: string;
  credit?: ImageCredit;
}

export interface IquitosPlace {
  key: string;
  supersedesDemo?: string;
  name: string;
  category: string;
  description: string;
  lat: number;
  lng: number;
  locality: string;
  address?: string;
  interests: string[];
  typicalVisitMinutes: number;
  sources: { label: string; url: string }[];
  image: IquitosImage;
}

export interface IquitosData {
  $comment?: string;
  version: number;
  provider: string;
  cityId: string;
  verifiedOn: string;
  places: IquitosPlace[];
}

/** Raíz del monorepo: el directorio más cercano hacia arriba con `pnpm-workspace.yaml`. */
export function repoRoot(): string {
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("No se encontró la raíz del monorepo (pnpm-workspace.yaml).");
}

export const dataFile = () => path.join(repoRoot(), "packages", "database", "data", "iquitos-places.json");
export const imagesDir = () => path.join(repoRoot(), "apps", "web", "public", "images", "lugares");

export function loadIquitosData(): IquitosData {
  const data = JSON.parse(readFileSync(dataFile(), "utf8")) as IquitosData;
  const keys = new Set<string>();
  for (const p of data.places) {
    if (keys.has(p.key)) throw new Error(`Clave duplicada en iquitos-places.json: ${p.key}`);
    keys.add(p.key);
    if (!/^[a-z0-9-]+$/.test(p.key)) throw new Error(`Clave inválida: ${p.key}`);
    if (p.description.length > 1000) throw new Error(`${p.key}: la descripción supera 1000 caracteres.`);
    if (!(Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)) throw new Error(`${p.key}: coordenadas fuera de rango.`);
  }
  return data;
}

export function saveIquitosData(data: IquitosData): void {
  writeFileSync(dataFile(), JSON.stringify(data, null, 2) + "\n", "utf8");
}
