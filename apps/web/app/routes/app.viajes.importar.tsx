import type { ImportFormat, ImportPreview } from "@por-aqui/contracts";
import { Alert, Button, Card, Field, Input } from "@por-aqui/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FileUp, MapPin, Route as RouteIcon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { api, errorMessage } from "../lib/api";
import { browserTimezone, formatDateTime, formatDistance, fromLocalInput } from "../lib/format";
import { capabilitiesQuery } from "../lib/query";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/app.viajes.importar";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Importar recorrido — Por aquí", noindex: true });
}

const FORMAT_LABEL: Record<ImportFormat, string> = {
  GPX: "GPX",
  KML: "KML",
  TAKEOUT_TIMELINE: "Google Takeout · Timeline",
  TAKEOUT_PLACES: "Google Takeout · Lugares guardados",
};

const formatBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / (1024 * 1024)).toFixed(n % (1024 * 1024) === 0 ? 0 : 1)} MB` : `${Math.round(n / 1024)} KB`);

/** Día local → instante ISO (inicio o fin de ese día en la zona del navegador). */
const dayBoundary = (day: string, end: boolean) => (day ? new Date(`${day}T${end ? "23:59:59.999" : "00:00:00"}`).toISOString() : undefined);

export default function ImportarRecorrido() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const caps = useQuery(capabilitiesQuery());
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [fromDay, setFromDay] = useState("");
  const [toDay, setToDay] = useState("");
  const [startAt, setStartAt] = useState("");
  const [withWaypoints, setWithWaypoints] = useState(true);

  const maxBytes = caps.data?.import.maxBytes ?? 10 * 1024 * 1024;
  const tooBig = file !== null && file.size > maxBytes;
  const timezone = browserTimezone();
  const options = {
    importWaypoints: withWaypoints,
    from: dayBoundary(fromDay, false),
    to: dayBoundary(toDay, true),
    startAt: startAt ? fromLocalInput(startAt, timezone) : undefined,
  };

  const preview = useQuery({
    queryKey: ["import-preview", file?.name, file?.size, file?.lastModified, options],
    queryFn: ({ signal }) => api.imports.preview(file!, options, { signal }),
    enabled: file !== null && !tooBig,
    retry: false,
    staleTime: 0,
    gcTime: 0,
  });

  const create = useMutation({
    mutationFn: () => api.imports.create(file!, { ...options, timezone, title: title.trim() || undefined }),
    onSuccess: async (r) => {
      await qc.invalidateQueries({ queryKey: ["journeys"] });
      navigate(`/app/viajes/${r.journeyId}`);
    },
  });

  const data: ImportPreview | undefined = preview.data;
  const busy = create.isPending;
  const error = tooBig ? `El archivo pesa ${formatBytes(file!.size)} y el máximo es ${formatBytes(maxBytes)}. Divide el archivo o limita el rango de fechas al exportarlo.` : preview.isError ? errorMessage(preview.error) : null;

  return (
    <section className="start-adventure new-journey-page new-journey-centered">
      <Link to="/app/viajes/nuevo" className="adventure-back"><ArrowLeft size={18} aria-hidden="true" /> Volver a nuevo viaje</Link>
      <p className="eyebrow mb-2">Desde tus archivos</p>
      <h1>Importar recorrido</h1>
      <p className="adventure-intro">Convierte un trayecto que ya hiciste en un viaje con su mapa, sus fechas y sus lugares. Acepta GPX, KML y la exportación de Google Takeout.</p>

      <Alert tone="neutral" className="mb-4" title="Google no permite sincronizar tu Timeline ni tus listas">
        Por eso funciona con archivos: descárgalos desde <a href="https://takeout.google.com" target="_blank" rel="noreferrer" className="underline">Google Takeout</a> (Cronología y Maps · Lugares guardados) y súbelos aquí. Si descargaste un ZIP, descomprímelo y elige el archivo de dentro.
      </Alert>

      <form onSubmit={(e) => { e.preventDefault(); if (data && !tooBig) create.mutate(); }}>
        <fieldset disabled={busy} className="grid gap-4">
          <legend className="sr-only">Archivo a importar</legend>
          <Field label="Archivo" hint={`GPX, KML, JSON o CSV de hasta ${formatBytes(maxBytes)}.`}>
            {(c) => <Input {...c} type="file" accept=".gpx,.kml,.json,.csv,application/gpx+xml,application/vnd.google-earth.kml+xml,application/json,text/csv" onChange={(e) => { setFile(e.target.files?.[0] ?? null); create.reset(); }} />}
          </Field>

          {file ? (
            <div className="new-journey-details">
              <Field label="Nombre del viaje" hint="Opcional. Si lo dejas vacío usamos el del archivo.">
                {(c) => <Input {...c} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={data?.suggestedTitle ?? "Recorrido importado"} />}
              </Field>
              <Field label="Desde (opcional)" hint="Solo importa lo que ocurrió a partir de este día.">
                {(c) => <Input {...c} type="date" value={fromDay} max={toDay || undefined} onChange={(e) => setFromDay(e.target.value)} />}
              </Field>
              <Field label="Hasta (opcional)" hint="Útil con Takeout, que reúne meses o años de historial.">
                {(c) => <Input {...c} type="date" value={toDay} min={fromDay || undefined} onChange={(e) => setToDay(e.target.value)} />}
              </Field>
              <label className="flex items-start gap-2 self-end text-sm">
                <input type="checkbox" className="mt-1" checked={withWaypoints} onChange={(e) => setWithWaypoints(e.target.checked)} />
                <span>Importar también los lugares como visitas<span className="block text-muted-foreground">Se crean como lugares personales (privados) o se reutilizan los que ya tienes.</span></span>
              </label>
              {data && !data.hasTimestamps ? (
                <Field label="Fecha de inicio del trayecto" hint="El archivo no trae fechas. Sin este dato usaremos el momento de la importación.">
                  {(c) => <Input {...c} type="datetime-local" value={startAt} max={new Date().toISOString().slice(0, 16)} onChange={(e) => setStartAt(e.target.value)} />}
                </Field>
              ) : null}
            </div>
          ) : null}
        </fieldset>

        <div aria-live="polite" className="mt-4">
          {file && preview.isFetching && !tooBig ? <p className="text-sm text-muted-foreground">Leyendo el archivo…</p> : null}
          {error ? <Alert tone="danger" live="assertive" title="No pudimos importar este archivo">{error}</Alert> : null}
          {data && !preview.isFetching && !tooBig ? <PreviewCard data={data} /> : null}
        </div>

        {create.isError ? <Alert tone="danger" live="assertive" className="mt-4">{errorMessage(create.error)}</Alert> : null}
        <Button type="submit" className="mt-5 w-full" disabled={!data || preview.isFetching || tooBig} loading={busy}>
          <FileUp size={18} aria-hidden="true" /> Importar recorrido
        </Button>
      </form>
    </section>
  );
}

function PreviewCard({ data }: { data: ImportPreview }) {
  const stat = (label: string, value: string) => <div><dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt><dd className="text-lg font-semibold">{value}</dd></div>;
  const when = data.startedAt ? (data.endedAt && data.endedAt !== data.startedAt ? `${formatDateTime(data.startedAt)} → ${formatDateTime(data.endedAt)}` : formatDateTime(data.startedAt)) : "Sin fechas";
  return (
    <Card className="grid gap-4 p-5" aria-label="Vista previa de la importación">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl">{data.suggestedTitle}</h2>
        <span className="text-sm text-muted-foreground">{FORMAT_LABEL[data.format]}</span>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {stat("Puntos GPS", data.pointsCount.toLocaleString("es"))}
        {stat("Distancia", data.pointsCount ? (formatDistance(data.distanceM) ?? "0 m") : "—")}
        {stat("Tramos", data.segmentsCount.toLocaleString("es"))}
        {stat("Lugares", data.waypointsCount.toLocaleString("es"))}
      </dl>
      <p className="flex items-center gap-2 text-sm"><RouteIcon size={16} aria-hidden="true" /> {when}{data.pointsDiscarded ? ` · ${data.pointsDiscarded.toLocaleString("es")} punto(s) descartado(s)` : ""}</p>
      {data.waypoints.length ? (
        <div>
          <h3 className="mb-1 text-sm font-semibold">Lugares{data.waypointsCount > data.waypoints.length ? ` (primeros ${data.waypoints.length} de ${data.waypointsCount})` : ""}</h3>
          <ul className="m-0 grid list-none gap-1 p-0 text-sm sm:grid-cols-2">
            {data.waypoints.map((w, i) => <li key={`${w.name}-${i}`} className="flex items-center gap-2"><MapPin size={14} aria-hidden="true" /><span className="truncate">{w.name}</span>{w.at ? <span className="text-muted-foreground">{formatDateTime(w.at)}</span> : null}</li>)}
          </ul>
        </div>
      ) : null}
      {data.warnings.length ? <Alert tone="warning" title="Ten en cuenta"><ul className="m-0 list-disc pl-5">{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul></Alert> : null}
    </Card>
  );
}
