import { readFileSync } from "node:fs";
import path from "node:path";
import { places, recordings, trackPoints, trackSegments, visits } from "@por-aqui/database";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { coordsFromMapsUrl, parseCsv } from "../src/modules/imports/parsers/takeout";
import { parseXml } from "../src/modules/imports/parsers/xml";
import { newUser, startApp, type TestApp } from "./helpers";

let t: TestApp;
let small: TestApp;
beforeAll(async () => {
  t = await startApp();
  small = await startApp({ IMPORT_MAX_BYTES: "2048", IMPORT_MAX_POINTS: "3" });
});
afterAll(async () => {
  await t.close();
  await small.close();
});

const fixture = (name: string) => ({ name, data: readFileSync(path.join(__dirname, "fixtures", "import", name)) });

describe("Importar recorridos · vista previa", () => {
  it("GPX: cuenta puntos tras filtrar, segmentos, distancia, fechas y waypoints", async () => {
    const u = await newUser(t);
    const r = await u.client.upload("/journeys/import/preview", fixture("ruta.gpx"));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      format: "GPX",
      suggestedTitle: "Paseo por el malecón",
      segmentsCount: 2,
      pointsCount: 5, // 6 válidos − 1 repetido (< distancia mínima); 1 con latitud inválida se omite al leer
      pointsDiscarded: 1,
      waypointsCount: 2,
      hasTimestamps: true,
      startedAt: "2026-03-14T14:00:00.000Z",
      endedAt: "2026-03-14T14:21:00.000Z",
    });
    expect(r.body.distanceM).toBeGreaterThan(100);
    expect(r.body.waypoints.map((w: { name: string }) => w.name).sort()).toEqual(["Mirador del Amazonas", "Plaza de Armas"]);
    expect(r.body.warnings.join(" ")).toMatch(/coordenadas inválidas/);
    // La vista previa no guarda nada.
    expect((await u.client.get("/journeys")).body).toEqual([]);
  });

  it("KML: LineString sin fechas + gx:Track con fechas + Point; avisa de lo omitido", async () => {
    const u = await newUser(t);
    const r = await u.client.upload("/journeys/import/preview", fixture("ruta.kml"), { startAt: "2026-03-10T09:00:00Z" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ format: "KML", segmentsCount: 2, pointsCount: 6, waypointsCount: 1, hasTimestamps: false, startedAt: "2026-03-10T09:00:00.000Z", suggestedTitle: "Ruta del mercado" });
    expect(r.body.waypoints[0]).toMatchObject({ name: "Mercado de Belén" });
    expect(r.body.warnings.join(" ")).toMatch(/polígono/);
    expect(r.body.warnings.join(" ")).toMatch(/fecha de inicio indicada/);
  });

  it("KML sin fechas ni fecha de inicio: usa hoy y lo advierte", async () => {
    const u = await newUser(t);
    const r = await u.client.upload("/journeys/import/preview", fixture("ruta.kml"));
    expect(r.status).toBe(200);
    expect(r.body.warnings.join(" ")).toMatch(/fecha de hoy/);
    expect(new Date(r.body.startedAt).getTime()).toBeLessThanOrEqual(Date.now());
  });

  it("Takeout Timeline (Semantic Location History): visitas, rutas y descarte por precisión", async () => {
    const u = await newUser(t);
    const r = await u.client.upload("/journeys/import/preview", fixture("takeout-semantic.json"));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ format: "TAKEOUT_TIMELINE", segmentsCount: 2, pointsCount: 5, pointsDiscarded: 1, waypointsCount: 2, hasTimestamps: true });
    expect(r.body.waypoints.map((w: { name: string }) => w.name)).toEqual(["Plaza de Armas", "Calle Lima 100"]);
  });

  it("Takeout Records.json: parte en segmentos cuando hay una pausa larga", async () => {
    const u = await newUser(t);
    const r = await u.client.upload("/journeys/import/preview", fixture("takeout-records.json"));
    expect(r.body).toMatchObject({ format: "TAKEOUT_TIMELINE", segmentsCount: 2, pointsCount: 5, waypointsCount: 0 });
  });

  it("Takeout Timeline nuevo (semanticSegments): rutas con 'lat°, lng°' y visitas con tipo semántico", async () => {
    const u = await newUser(t);
    const r = await u.client.upload("/journeys/import/preview", fixture("takeout-device.json"));
    expect(r.body).toMatchObject({ format: "TAKEOUT_TIMELINE", segmentsCount: 1, pointsCount: 3, waypointsCount: 1 });
    expect(r.body.waypoints[0].name).toBe("Casa");
    expect(r.body.startedAt).toBe("2026-03-14T19:00:00.000Z");
  });

  it("Takeout «Lugares guardados»: GeoJSON usa coordenadas alternativas y omite lo que no tiene ubicación", async () => {
    const u = await newUser(t);
    const r = await u.client.upload("/journeys/import/preview", fixture("lugares-guardados.json"));
    expect(r.body).toMatchObject({ format: "TAKEOUT_PLACES", segmentsCount: 0, pointsCount: 0, waypointsCount: 3 });
    expect(r.body.warnings.join(" ")).toMatch(/1 lugar\(es\) guardado\(s\) no traen coordenadas/);
  });

  it("Takeout «Lugares guardados»: CSV con comillas y coordenadas en el enlace", async () => {
    const u = await newUser(t);
    const r = await u.client.upload("/journeys/import/preview", fixture("lugares-guardados.csv"));
    expect(r.body).toMatchObject({ format: "TAKEOUT_PLACES", waypointsCount: 2 });
    expect(r.body.waypoints.map((w: { name: string }) => w.name)).toEqual(['Café "El Rincón"', "Mirador"]);
    expect(r.body.warnings.join(" ")).toMatch(/no traen coordenadas/);
  });

  it("filtra por rango de fechas y avisa cuando no queda nada", async () => {
    const u = await newUser(t);
    const some = await u.client.upload("/journeys/import/preview", fixture("ruta.gpx"), { from: "2026-03-14T14:10:00Z", to: "2026-03-14T14:30:00Z", importWaypoints: "false" });
    expect(some.body).toMatchObject({ pointsCount: 2, segmentsCount: 1, waypointsCount: 0 });
    const none = await u.client.upload("/journeys/import/preview", fixture("ruta.gpx"), { from: "2027-01-01T00:00:00Z", importWaypoints: "false" });
    expect(none.status).toBe(422);
    expect(none.body.code).toBe("IMPORT_EMPTY");
    const inverted = await u.client.upload("/journeys/import/preview", fixture("ruta.gpx"), { from: "2026-04-01T00:00:00Z", to: "2026-03-01T00:00:00Z" });
    expect(inverted.status).toBe(400);
  });
});

describe("Importar recorridos · creación", () => {
  it("GPX: crea un viaje libre finalizado con trayecto y visitas ligadas a lugares personales", async () => {
    const u = await newUser(t);
    const r = await u.client.upload("/journeys/import", fixture("ruta.gpx"), { timezone: "America/Lima", title: "Mi paseo" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ pointsCount: 5, visitsCount: 2, placesCreated: 2, placesReused: 0 });

    const journey = (await u.client.get(`/journeys/${r.body.journeyId}`)).body;
    expect(journey).toMatchObject({ title: "Mi paseo", creationMode: "FREE", status: "COMPLETED" });
    expect(journey.description).toMatch(/GPX \(ruta\.gpx\)/);

    const [rec] = await t.db.select().from(recordings).where(eq(recordings.id, r.body.recordingId));
    expect(rec).toMatchObject({ status: "COMPLETED" });
    expect(rec!.trackWatermarks).toEqual({ "imp-1": 2, "imp-2": 1 });
    expect(rec!.startedAt.toISOString()).toBe("2026-03-14T14:00:00.000Z");
    expect(rec!.endedAt!.toISOString()).toBe("2026-03-14T14:21:00.000Z");

    const track = (await u.client.get(`/recordings/${r.body.recordingId}/track`)).body;
    expect(track.segments.map((s: { points: unknown[] }) => s.points.length)).toEqual([3, 2]);
    expect(track.segments[0].points.map((p: { seq: number }) => p.seq)).toEqual([0, 1, 2]);
    expect(track.segments[0].points[0]).toMatchObject({ lng: -73.2455, lat: -3.7437 });

    const vs = (await u.client.get(`/journeys/${r.body.journeyId}/visits`)).body;
    expect(vs).toHaveLength(2);
    expect(vs.every((v: { place: { scope: string }; timezone: string }) => v.place.scope === "PERSONAL" && v.timezone === "America/Lima")).toBe(true);
    const plaza = vs.find((v: { place: { name: string } }) => v.place.name === "Plaza de Armas");
    expect(plaza).toMatchObject({ visitedAt: "2026-03-14T14:10:00.000Z", note: "Café & descanso" });

    // El lugar es privado de quien importa.
    const other = await newUser(t);
    expect((await other.client.get(`/places/${plaza.placeId}`)).status).toBe(404);
    expect((await other.client.get(`/journeys/${r.body.journeyId}`)).status).toBe(404);
  });

  it("al volver a importar reutiliza los lugares personales existentes (mismo nombre, < 75 m)", async () => {
    const u = await newUser(t);
    const first = await u.client.upload("/journeys/import", fixture("ruta.gpx"));
    const second = await u.client.upload("/journeys/import", fixture("ruta.gpx"));
    expect(second.status).toBe(201);
    expect(second.body).toMatchObject({ placesCreated: 0, placesReused: 2, visitsCount: 2 });
    expect(second.body.journeyId).not.toBe(first.body.journeyId);
    const mine = await t.db.select().from(places).where(eq(places.ownerId, u.id));
    expect(mine).toHaveLength(2);
  });

  it("Takeout Timeline: reutiliza un mismo lugar visitado dos veces dentro de la importación", async () => {
    const u = await newUser(t);
    const json = JSON.stringify({
      timelineObjects: [0, 1].map((i) => ({
        placeVisit: { location: { latitudeE7: -37437000, longitudeE7: -732455000, name: "Plaza de Armas" }, duration: { startTimestamp: `2026-03-1${i + 4}T14:00:00Z`, endTimestamp: `2026-03-1${i + 4}T15:00:00Z` } },
      })),
    });
    const r = await u.client.upload("/journeys/import", { name: "2026_MARCH.json", data: json });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ visitsCount: 2, placesCreated: 1, pointsCount: 0 });
    const vs = (await u.client.get(`/journeys/${r.body.journeyId}/visits`)).body;
    expect(new Set(vs.map((v: { placeId: string }) => v.placeId)).size).toBe(1);
    expect(vs[0].endedAt).toBe("2026-03-14T15:00:00.000Z");
    expect((await u.client.get(`/journeys/${r.body.journeyId}`)).body.title).toBe("2026 MARCH");
  });

  it("solo trayecto (importWaypoints=false) y solo lugares (sin trayecto)", async () => {
    const u = await newUser(t);
    const onlyTrack = await u.client.upload("/journeys/import", fixture("ruta.gpx"), { importWaypoints: "false" });
    expect(onlyTrack.body).toMatchObject({ pointsCount: 5, visitsCount: 0, placesCreated: 0 });
    const onlyPlaces = await u.client.upload("/journeys/import", fixture("lugares-guardados.json"));
    expect(onlyPlaces.status).toBe(201);
    expect(onlyPlaces.body).toMatchObject({ pointsCount: 0, visitsCount: 3, placesCreated: 3 });
    expect(await t.db.select().from(trackSegments).where(eq(trackSegments.recordingId, onlyPlaces.body.recordingId))).toHaveLength(0);
    const vs = (await u.client.get(`/journeys/${onlyPlaces.body.journeyId}/visits`)).body;
    expect(vs.map((v: { place: { name: string } }) => v.place.name)).toEqual(["Plaza de Armas", "Sin coordenadas en geometría", "Solo enlace"]);
  });

  it("KML sin fechas: usa la fecha de inicio indicada para el trayecto", async () => {
    const u = await newUser(t);
    const r = await u.client.upload("/journeys/import", fixture("ruta.kml"), { startAt: "2026-03-10T09:00:00Z" });
    expect(r.status).toBe(201);
    const rows = await t.db.select().from(trackSegments).where(eq(trackSegments.recordingId, r.body.recordingId));
    const first = rows.find((s) => s.clientSegmentId === "imp-1")!;
    expect(first.startedAt.toISOString()).toBe("2026-03-10T09:00:00.000Z");
    expect(first.endedAt!.toISOString()).toBe("2026-03-10T09:00:03.000Z");
    const pts = await t.db.select().from(trackPoints).where(eq(trackPoints.segmentId, first.id));
    expect(pts).toHaveLength(4);
  });

  it("no mezcla datos entre usuarios y la importación completa es atómica", async () => {
    const u = await newUser(t);
    const bad = await u.client.upload("/journeys/import", { name: "x.gpx", data: "<gpx><trk><trkseg><trkpt lat='1' lon='1'><time>2026-03-14T14:00:00Z</time></trkpt>" });
    expect(bad.status).toBe(422);
    expect((await u.client.get("/journeys")).body).toEqual([]);
    const all = await t.db.select().from(visits).where(eq(visits.ownerId, u.id));
    expect(all).toHaveLength(0);
  });
});

describe("Importar recorridos · errores y seguridad", () => {
  it("exige sesión y token CSRF", async () => {
    const anon = t.client();
    expect((await anon.upload("/journeys/import/preview", fixture("ruta.gpx"))).status).toBe(401);
    const u = await newUser(t);
    const noCsrf = await u.client.rawPost("/journeys/import", {}, { origin: "http://localhost:5173" });
    expect(noCsrf.status).toBe(403);
  });

  it("mensajes claros: sin archivo, vacío, ZIP, formato desconocido, XML roto y sin trayectos", async () => {
    const u = await newUser(t);
    const none = await u.client.upload("/journeys/import");
    expect(none.status).toBe(400);
    expect(none.body.code).toBe("IMPORT_NO_FILE");

    const empty = await u.client.upload("/journeys/import/preview", { name: "a.gpx", data: "" });
    expect(empty.status).toBe(422);
    expect(empty.body.code).toBe("IMPORT_EMPTY");

    const zip = await u.client.upload("/journeys/import/preview", { name: "takeout.zip", data: Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]) });
    expect(zip.body.code).toBe("IMPORT_UNSUPPORTED_FORMAT");
    expect(zip.body.message).toMatch(/ZIP/);

    const text = await u.client.upload("/journeys/import/preview", { name: "notas.txt", data: "hola mundo" });
    expect(text.body.code).toBe("IMPORT_UNSUPPORTED_FORMAT");

    const json = await u.client.upload("/journeys/import/preview", { name: "x.json", data: '{"algo": 1}' });
    expect(json.body.code).toBe("IMPORT_UNSUPPORTED_FORMAT");
    const badJson = await u.client.upload("/journeys/import/preview", { name: "x.json", data: "{no es json" });
    expect(badJson.body.code).toBe("IMPORT_INVALID_FILE");

    const broken = await u.client.upload("/journeys/import/preview", { name: "x.gpx", data: "<gpx><trk></gpx>" });
    expect(broken.status).toBe(422);
    expect(broken.body.code).toBe("IMPORT_INVALID_FILE");

    const noTracks = await u.client.upload("/journeys/import/preview", { name: "x.gpx", data: '<gpx version="1.1"><metadata><name>Vacío</name></metadata></gpx>' });
    expect(noTracks.body.code).toBe("IMPORT_EMPTY");

    const otherXml = await u.client.upload("/journeys/import/preview", { name: "x.xml", data: "<html></html>" });
    expect(otherXml.body.code).toBe("IMPORT_UNSUPPORTED_FORMAT");

    const badTz = await u.client.upload("/journeys/import/preview", fixture("ruta.gpx"), { timezone: "Marte/Olimpo" });
    expect(badTz.status).toBe(400);
    expect(badTz.body.fieldErrors.timezone).toBeTruthy();
  });

  it("rechaza DOCTYPE/ENTITY (XXE y billion laughs) sin leer ni expandir nada", async () => {
    const u = await newUser(t);
    const xxe = `<?xml version="1.0"?><!DOCTYPE gpx [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><gpx><wpt lat="1" lon="1"><name>&xxe;</name></wpt></gpx>`;
    const r = await u.client.upload("/journeys/import/preview", { name: "xxe.gpx", data: xxe });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe("IMPORT_INVALID_FILE");
    expect(r.body.message).toMatch(/DOCTYPE/);
    expect(JSON.stringify(r.body)).not.toMatch(/root:/);
    const laughs = `<!DOCTYPE lolz [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]><gpx><wpt lat="1" lon="1"><name>&b;</name></wpt></gpx>`;
    expect((await u.client.upload("/journeys/import/preview", { name: "laughs.kml", data: laughs })).body.code).toBe("IMPORT_INVALID_FILE");
  });

  it("aplica el límite de tamaño y el de puntos", async () => {
    const u = await newUser(small);
    const big = await u.client.upload("/journeys/import", { name: "grande.gpx", data: Buffer.alloc(5000, 32) });
    expect(big.status).toBe(413);
    expect(big.body.code).toBe("IMPORT_TOO_LARGE");

    const many = await u.client.upload("/journeys/import/preview", fixture("ruta.gpx"));
    expect(many.status).toBe(422);
    expect(many.body.code).toBe("IMPORT_TOO_MANY_POINTS");
    expect((await u.client.get("/journeys")).body).toEqual([]);
  });

  it("expone los límites en /meta/capabilities", async () => {
    const caps = (await t.client().get("/meta/capabilities")).body;
    expect(caps.import).toEqual({ maxBytes: 10 * 1024 * 1024, maxPoints: 50_000, maxWaypoints: 1000 });
  });
});

describe("Lector XML y utilidades", () => {
  it("lee atributos, CDATA, entidades y espacios de nombres; ignora comentarios", () => {
    const root = parseXml(`\uFEFF<?xml version="1.0"?><!-- c --><a:r xmlns:a="x" k='v &amp; w'><b>1 &lt; 2 &#65;&#x42;</b><c><![CDATA[<raw>]]></c><d/></a:r>`);
    expect(root.name).toBe("r");
    expect(root.attrs.k).toBe("v & w");
    expect(root.children.map((c) => c.name)).toEqual(["b", "c", "d"]);
    expect(root.children[0]!.text).toBe("1 < 2 AB");
    expect(root.children[1]!.text).toBe("<raw>");
  });

  it("rechaza anidamiento excesivo, etiquetas mal cerradas y textos sueltos", () => {
    expect(() => parseXml("<a>".repeat(100))).toThrow(/profundo/);
    expect(() => parseXml("<a><b></a></b>")).toThrow(/mal anidadas/);
    expect(() => parseXml("hola<a/>")).toThrow(/fuera del elemento raíz/);
    expect(() => parseXml("<a/><b/>")).toThrow(/más de un elemento raíz/);
    expect(() => parseXml("<a b=1/>")).toThrow(/comillas/);
  });

  it("CSV y enlaces de Google Maps", () => {
    expect(parseCsv('a,"b,""c""",d\r\n1,2,3\n')).toEqual([["a", 'b,"c"', "d"], ["1", "2", "3"]]);
    expect(coordsFromMapsUrl("https://www.google.com/maps/place/X/@-3.75,-73.25,17z")).toEqual({ lat: -3.75, lng: -73.25 });
    expect(coordsFromMapsUrl("https://x/!3d-3.1!4d-73.2")).toEqual({ lat: -3.1, lng: -73.2 });
    expect(coordsFromMapsUrl("https://maps.google.com/?q=-3.7,-73.2")).toEqual({ lat: -3.7, lng: -73.2 });
    expect(coordsFromMapsUrl("https://maps.google.com/?cid=1")).toBeNull();
    expect(coordsFromMapsUrl("https://x/@999,999,1z")).toBeNull();
  });
});
