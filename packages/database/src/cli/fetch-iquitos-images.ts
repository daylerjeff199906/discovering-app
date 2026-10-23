import crypto from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { imagesDir, loadIquitosData, saveIquitosData, type ImageCredit } from "../iquitos-places";

/**
 * Descarga las fotos de `data/iquitos-places.json` desde Wikimedia Commons, comprueba que la licencia sea libre
 * (CC BY, CC BY-SA, CC0 o dominio público), las convierte a WebP y rellena autor/licencia/fuente en el JSON.
 *
 *   pnpm db:images:iquitos [--dry-run] [--force] [--only=iq-belen,iq-malecon]
 *
 * Solo escribe en `apps/web/public/images/lugares/` y en el JSON. No toca la base de datos ni R2.
 */
const API = "https://commons.wikimedia.org/w/api.php";
const USER_AGENT = process.env.COMMONS_USER_AGENT ?? "PorAquiCatalogSeed/1.0 (proyecto Por aqui; semilla de lugares de Iquitos)";
const MAX_WIDTH = 1280;
const ALLOWED_LICENSE = /^(CC BY(-SA)? [1-4]\.\d|CC0( 1\.0)?|Public domain|PD[- ])/i;

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");
const only = process.argv.find((a) => a.startsWith("--only="))?.slice(7).split(",");

const strip = (html: string | undefined) =>
  (html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) return (await res.json()) as T;
    if (res.status !== 429 && res.status < 500) throw new Error(`Commons respondió ${res.status}`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error("Commons no respondió tras varios intentos");
}

async function getBuffer(url: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status !== 429 && res.status < 500) throw new Error(`Descarga fallida (${res.status})`);
    await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
  }
  throw new Error("La descarga no se completó tras varios intentos");
}

interface CommonsInfo {
  query: {
    pages: Record<string, { title: string; missing?: string; imageinfo?: { thumburl?: string; url: string; descriptionurl: string; mime: string; extmetadata?: Record<string, { value: string }> }[] }>;
  };
}

async function main() {
  const data = loadIquitosData();
  const dir = imagesDir();
  if (!dryRun) mkdirSync(dir, { recursive: true });
  let failed = 0;

  for (const place of data.places) {
    if (only && !only.includes(place.key)) continue;
    const img = place.image;
    const target = path.join(dir, `${place.key}.webp`);
    if (!force && img.file && img.credit && existsSync(target)) {
      console.log(`= ${place.key}: ya descargada (usa --force para regenerar)`);
      continue;
    }
    try {
      const url = `${API}?action=query&format=json&prop=imageinfo&iiprop=url|mime|extmetadata&iiurlwidth=${MAX_WIDTH}&titles=${encodeURIComponent(img.commonsFile)}`;
      const json = await getJson<CommonsInfo>(url);
      const page = Object.values(json.query.pages)[0];
      const info = page?.imageinfo?.[0];
      if (!page || page.missing !== undefined || !info) throw new Error(`No existe en Commons: ${img.commonsFile}`);
      const meta = info.extmetadata ?? {};
      const license = strip(meta.LicenseShortName?.value);
      if (!ALLOWED_LICENSE.test(license)) throw new Error(`Licencia no permitida (${license || "desconocida"})`);
      const restrictions = strip(meta.Restrictions?.value);
      if (restrictions) throw new Error(`La ficha declara restricciones: ${restrictions}`);
      const author = strip(meta.Artist?.value) || "Autor no indicado";
      const licenseUrl = strip(meta.LicenseUrl?.value) || (/public domain/i.test(license) ? info.descriptionurl : "");
      if (!licenseUrl) throw new Error("La ficha no incluye URL de la licencia");
      const credit: ImageCredit = { title: page.title.replace(/^File:/, "").replace(/\.[a-z0-9]+$/i, ""), author, license, licenseUrl, sourceUrl: info.descriptionurl };

      if (dryRun) {
        console.log(`~ ${place.key}: ${credit.title} — ${author} — ${license}`);
        continue;
      }
      const source = await getBuffer(info.thumburl ?? info.url);
      const out = await sharp(source).rotate().resize({ width: MAX_WIDTH, withoutEnlargement: true }).webp({ quality: 78, effort: 5 }).toBuffer({ resolveWithObject: true });
      writeFileSync(target, out.data);
      img.file = `/images/lugares/${place.key}.webp`;
      img.width = out.info.width;
      img.height = out.info.height;
      img.sha256 = crypto.createHash("sha256").update(out.data).digest("hex");
      img.retrievedOn = new Date().toISOString().slice(0, 10);
      img.credit = credit;
      saveIquitosData(data);
      console.log(`✔ ${place.key}: ${out.info.width}x${out.info.height} (${Math.round(out.data.length / 1024)} KB) — ${author} — ${license}`);
    } catch (err) {
      failed++;
      console.error(`✘ ${place.key}: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, 600));
  }
  if (!dryRun) writeCredits(data.places);
  if (failed) process.exitCode = 1;
}

/** Tabla de créditos junto a las imágenes (se regenera con cada ejecución). */
function writeCredits(places: ReturnType<typeof loadIquitosData>["places"]) {
  const rows = places
    .filter((p) => p.image.file && p.image.credit)
    .map((p) => {
      const c = p.image.credit!;
      return `| \`${path.basename(p.image.file!)}\` | ${p.name} | «${c.title.replace(/\|/g, "/")}», ${c.author.replace(/\|/g, "/")} | [Fuente](${c.sourceUrl}) · [${c.license}](${c.licenseUrl}) |`;
    });
  const text = [
    "# Fotografías de lugares de Iquitos",
    "",
    "Generado por `pnpm db:images:iquitos` a partir de `packages/database/data/iquitos-places.json`. No editar a mano.",
    "Fotografías de Wikimedia Commons con licencia libre. Cada archivo es una versión recortada/comprimida (WebP, máx. 1280 px de ancho) del original; los créditos se muestran en la app junto a cada foto.",
    "",
    "| Archivo | Lugar | Título y autor | Fuente y licencia |",
    "|---|---|---|---|",
    ...rows,
    "",
  ].join("\n");
  writeFileSync(path.join(imagesDir(), "README.md"), text, "utf8");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
