import { customType } from "drizzle-orm/pg-core";

export interface LngLat {
  lng: number;
  lat: number;
}

/** Decodifica un punto EWKB/WKB en hexadecimal (formato en que pg devuelve `geometry`). */
export function parsePointHex(hex: string): LngLat {
  const buf = Buffer.from(hex, "hex");
  const little = buf.readUInt8(0) === 1;
  const read32 = (o: number) => (little ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
  const readF64 = (o: number) => (little ? buf.readDoubleLE(o) : buf.readDoubleBE(o));
  const type = read32(1);
  let offset = 5;
  if (type & 0x20000000) offset += 4; // SRID presente
  return { lng: readF64(offset), lat: readF64(offset + 8) };
}

/** `geometry(Point, 4326)`: el orden es siempre longitud, latitud. */
export const geometryPoint = customType<{ data: LngLat; driverData: string }>({
  dataType() {
    return "geometry(Point,4326)";
  },
  toDriver(value) {
    return `SRID=4326;POINT(${value.lng} ${value.lat})`;
  },
  fromDriver(value) {
    return parsePointHex(value);
  },
});
