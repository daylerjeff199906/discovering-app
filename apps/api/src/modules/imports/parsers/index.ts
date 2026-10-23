import { IMPORT_ERROR_CODES } from "@por-aqui/contracts";
import { parseGpx } from "./gpx";
import { parseKml } from "./kml";
import { isCsvText, parseSavedPlacesCsv, parseTakeoutJson } from "./takeout";
import { invalidFile, type ParsedFile } from "./types";
import { parseXml } from "./xml";

const unsupported = (message: string) => invalidFile(message, IMPORT_ERROR_CODES.UNSUPPORTED);

/** Detecta el formato por el contenido (la extensión y el tipo MIME los controla quien sube el archivo). */
export function parseImportFile(buffer: Buffer): ParsedFile {
  if (buffer.length === 0) throw invalidFile("El archivo está vacío.", IMPORT_ERROR_CODES.EMPTY);
  if (buffer[0] === 0x50 && buffer[1] === 0x4b) {
    throw unsupported("Esto parece un ZIP. Descomprime la exportación de Google Takeout y sube el archivo GPX, KML, JSON o CSV de dentro.");
  }
  if (buffer.subarray(0, 1024).includes(0)) throw unsupported("El archivo no es de texto. Sube un GPX, KML, JSON o CSV.");

  const text = buffer.toString("utf8");
  const head = text.replace(/^\uFEFF/, "").trimStart()[0];
  if (head === "<") {
    const root = parseXml(text);
    if (root.name === "gpx") return parseGpx(root);
    if (root.name === "kml") return parseKml(root);
    throw unsupported("Este XML no es un GPX ni un KML.");
  }
  if (head === "{" || head === "[") return parseTakeoutJson(text);
  if (isCsvText(text)) return parseSavedPlacesCsv(text);
  throw unsupported("No reconocemos este archivo. Admitimos GPX, KML y la exportación de Google Takeout (Timeline en JSON y «Lugares guardados» en GeoJSON o CSV).");
}

export type { ParsedFile, RawPoint, RawSegment, RawWaypoint } from "./types";
