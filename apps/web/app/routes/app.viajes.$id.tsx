import { Alert, Badge, Button, EmptyState, JourneyTrail, Lightbox, buttonClass, type TrailItem } from "@por-aqui/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, MapPinPlus, Pencil, Share2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { MapPanel, type MapLine, type MapMarker } from "../components/map";
import { LoadingBlock, PageHeader, QueryError } from "../components/shell";
import { api } from "../lib/api";
import { formatDateTime, STATUS_LABEL, STATUS_TONE } from "../lib/format";
import { useJourney } from "../lib/journey-hooks";
import { qk, visitsQuery } from "../lib/query";
import { seoMeta } from "../lib/seo";
import { useUi } from "../lib/stores";
import { connectorFor, flattenStops, stopStates } from "../lib/trail";
import type { Route } from "./+types/app.viajes.$id";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Resumen del viaje — Por aquí", noindex: true });
}

/** Resumen propio: el plan (si no empezó) o el diario con el historial de visitas. */
export default function ResumenViaje() {
  const { id = "" } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const journey = useJourney(id);
  const visits = useQuery({ ...visitsQuery(id), enabled: Boolean(journey.data) });
  const rec = journey.data?.recording ?? null;
  const track = useQuery({ queryKey: ["track", rec?.id], queryFn: ({ signal }) => api.recording.track(rec!.id, { signal }), enabled: Boolean(rec) });
  const selected = useUi((s) => s.selectedStopId);
  const select = useUi((s) => s.select);
  const [gallery, setGallery] = useState<{ items: { src: string; alt: string; caption?: string | null }[]; index: number } | null>(null);
  const duplicate = useMutation({ mutationFn: () => api.journeys.duplicate(id), onSuccess: (j) => navigate(`/app/viajes/${j.id}/editar`) });
  const start = useMutation({ mutationFn: () => api.recording.start(id), onSuccess: async () => { await qc.invalidateQueries({ queryKey: qk.journey(id) }); navigate(`/app/viajes/${id}/recorrido`); } });

  const j = journey.data;
  const states = useMemo(() => (j ? stopStates(j, visits.data ?? []) : new Map()), [j, visits.data]);
  if (journey.isPending) return <LoadingBlock />;
  if (journey.isError || !j) return <QueryError error={journey.error} retry={() => journey.refetch()} />;

  const vlist = visits.data ?? [];
  const stops = flattenStops(j);
  const diary = j.status === "COMPLETED" || (vlist.length > 0 && j.status !== "DRAFT" && j.status !== "PLANNED");
  const inProgress = j.status === "IN_PROGRESS" || j.status === "PAUSED";

  const diaryItems: TrailItem[] = vlist.map((v) => ({
    id: v.id,
    title: v.place.name,
    subtitle: `${formatDateTime(v.visitedAt, v.timezone)}${v.stopId ? "" : " · añadido durante el recorrido"}`,
    state: "visited",
    note: v.note,
    media: v.media.filter((m) => m.status === "READY").map((m) => ({ src: m.thumbUrl!, alt: m.caption ?? `Foto en ${v.place.name}` })),
    actions: <Link to={`/app/viajes/${id}/visitas/${v.id}`} className={buttonClass({ variant: "outline", size: "sm" })}><Pencil className="size-4" aria-hidden="true" /> Editar visita</Link>,
  }));
  const planItems: TrailItem[] = j.days.flatMap((d) => d.stops.map((s, i) => ({ id: s.id, title: s.place.name, subtitle: s.place.locality, state: states.get(s.id) ?? "pending", connector: connectorFor(j, d.stops, i) })));
  const items = diary ? diaryItems : planItems;

  const markers: MapMarker[] = diary
    ? vlist.map((v, i) => ({ id: v.id, lng: v.place.lng, lat: v.place.lat, index: i + 1, state: "visited" as const, label: `${i + 1}. ${v.place.name}` }))
    : stops.map((s) => ({ id: s.id, lng: s.place.lng, lat: s.place.lat, index: s.index, state: states.get(s.id) ?? "pending", label: `${s.index}. ${s.place.name}` }));
  const lines: MapLine[] = track.data?.segments.map((s) => ({ id: s.id, coords: s.points.map((p) => [p.lng, p.lat] as [number, number]) })) ?? [];
  const photos = vlist.flatMap((v) => v.media.filter((m) => m.status === "READY").map((m) => ({ src: m.displayUrl!, alt: m.caption ?? `Foto en ${v.place.name}`, caption: m.caption, visitId: v.id })));

  return (
    <>
      <PageHeader
        title={j.title}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge><span>{stops.length} paradas · {vlist.length} visitas · {photos.length} fotos</span></span>}
        actions={
          <>
            {inProgress ? <Link to={`/app/viajes/${id}/recorrido`} className={buttonClass({})}>Continuar recorrido</Link> : null}
            {!rec && j.status !== "ARCHIVED" ? <Button loading={start.isPending} onClick={() => start.mutate()}>Iniciar recorrido</Button> : null}
            {j.status === "COMPLETED" ? <Link to={`/app/viajes/${id}/compartir`} className={buttonClass({})}><Share2 className="size-5" aria-hidden="true" /> Compartir / publicar</Link> : null}
            {j.status !== "ARCHIVED" ? <Link to={`/app/viajes/${id}/editar`} className={buttonClass({ variant: "outline" })}>Editar plan</Link> : null}
            {rec ? <Link to={`/app/viajes/${id}/visitas/nueva`} className={buttonClass({ variant: "secondary" })}><MapPinPlus className="size-5" aria-hidden="true" /> Añadir visita</Link> : null}
            <Button variant="ghost" loading={duplicate.isPending} onClick={() => duplicate.mutate()}><Copy className="size-5" aria-hidden="true" /> Duplicar plan</Button>
          </>
        }
      />
      {search.get("finalizado") ? <Alert tone="success" className="mb-4" title="¡Recorrido finalizado!">Tu historia quedó guardada como un diario privado. Cuando quieras, elige qué compartir.</Alert> : null}
      {j.sourcePublicationId ? <p className="mb-4 text-sm text-muted-foreground">Basado en una historia de la comunidad (solo se copiaron las paradas).</p> : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section aria-label={diary ? "Diario" : "Plan"}>
          <h2 className="mb-3 text-2xl">{diary ? "Diario del viaje" : "Plan"}</h2>
          {items.length === 0 ? (
            <EmptyState title={diary ? "Aún no hay visitas" : "El plan está vacío"} action={<Link to={`/app/viajes/${id}/editar`} className={buttonClass({})}>Editar plan</Link>}>Añade paradas o registra tu primera visita.</EmptyState>
          ) : (
            <JourneyTrail items={items} selectedId={selected} onSelect={select} alternate={diary} onMediaClick={(itemId, mi) => { const v = vlist.find((x) => x.id === itemId); if (v) setGallery({ items: v.media.filter((m) => m.status === "READY").map((m) => ({ src: m.displayUrl!, alt: m.caption ?? `Foto en ${v.place.name}`, caption: m.caption })), index: mi }); }} ariaLabel={diary ? "Visitas en orden cronológico" : "Paradas del plan"} />
          )}
        </section>
        <aside className="lg:sticky lg:top-24 lg:self-start" aria-label="Mapa">
          <MapPanel markers={markers} lines={lines} selectedId={selected} onSelect={select} fitKey={`${id}:${markers.length}`} className="h-[24rem]" ariaLabel="Mapa del viaje" />
          {track.data && track.data.segments.length > 0 ? <p className="mt-2 text-xs text-muted-foreground">{track.data.segments.length} segmento(s) de trayecto registrados. Los huecos entre segmentos no se unen.</p> : null}
        </aside>
      </div>
      <Lightbox images={gallery?.items ?? []} index={gallery?.index ?? null} onClose={() => setGallery(null)} onIndex={(i) => gallery && setGallery({ ...gallery, index: i })} />
    </>
  );
}
