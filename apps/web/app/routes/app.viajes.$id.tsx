import { Alert, Badge, Button, EmptyState, JourneyTrail, Lightbox, Tabs, buttonClass, type TrailItem } from "@por-aqui/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Check, Copy, MapPinPlus, Pencil, Share2, BookOpen, Map as MapIcon, Route as RouteIcon } from "lucide-react";
import { AmazonArt } from "../components/travel-art";
import { ShareStorySheet } from "../components/share-story-sheet";
import { distanceKm } from "../lib/catalog";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { MapPanel, type MapLine, type MapMarker } from "../components/map";
import { DeleteJourneyButton } from "../components/delete-journey-button";
import { DeleteVisitButton } from "../components/delete-visit-button";
import { LoadingBlock, PageHeader, QueryError } from "../components/shell";
import { api } from "../lib/api";
import { formatDateTime, STATUS_LABEL, STATUS_TONE } from "../lib/format";
import { useJourney } from "../lib/journey-hooks";
import { visitsQuery } from "../lib/query";
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
  const journey = useJourney(id);
  const visits = useQuery({ ...visitsQuery(id), enabled: Boolean(journey.data) });
  const rec = journey.data?.recording ?? null;
  const track = useQuery({ queryKey: ["track", rec?.id], queryFn: ({ signal }) => api.recording.track(rec!.id, { signal }), enabled: Boolean(rec) });
  const selected = useUi((s) => s.selectedStopId);
  const select = useUi((s) => s.select);
  const [gallery, setGallery] = useState<{ items: { src: string; alt: string; caption?: string | null }[]; index: number } | null>(null);
  const [view, setView] = useState("history");
  const [editing, setEditing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const duplicate = useMutation({ mutationFn: () => api.journeys.duplicate(id), onSuccess: (j) => navigate(`/app/viajes/${j.id}/editar`) });

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
    actions: editing ? <><Link to={`/app/viajes/${id}/visitas/${v.id}`} title="Editar recuerdo" aria-label={`Editar visita a ${v.place.name}`} className={buttonClass({ variant: "outline", size: "icon" })}><Pencil className="size-4" aria-hidden="true" /></Link><DeleteVisitButton journeyId={id} visitId={v.id} placeName={v.place.name} /></> : undefined,
  }));
  const planItems: TrailItem[] = j.days.flatMap((d) => d.stops.map((s, i) => ({ id: s.id, title: s.place.name, subtitle: s.place.locality, state: states.get(s.id) ?? "pending", connector: connectorFor(j, d.stops, i) })));
  const items = diary ? diaryItems : planItems;

  const markers: MapMarker[] = diary
    ? vlist.map((v, i) => ({ id: v.id, lng: v.place.lng, lat: v.place.lat, index: i + 1, state: "visited" as const, label: `${i + 1}. ${v.place.name}` }))
    : stops.map((s) => ({ id: s.id, lng: s.place.lng, lat: s.place.lat, index: s.index, state: states.get(s.id) ?? "pending", label: `${s.index}. ${s.place.name}` }));
  const lines: MapLine[] = track.data?.segments.map((s) => ({ id: s.id, coords: s.points.map((p) => [p.lng, p.lat] as [number, number]) })) ?? [];
  const photos = vlist.flatMap((v) => v.media.filter((m) => m.status === "READY").map((m) => ({ src: m.displayUrl!, alt: m.caption ?? `Foto en ${v.place.name}`, caption: m.caption, visitId: v.id })));

  return (
    <div className={diary ? "journey-story-page" : undefined}>
      <PageHeader
        title={diary ? `Mi historia en ${j.preferences.destinationLabel ?? "mi viaje"}` : j.title}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge><span>{stops.length} paradas · {vlist.length} visitas · {photos.length} fotos</span></span>}
        actions={
          <>
            {inProgress ? <Link to={`/app/viajes/${id}/recorrido`} className={buttonClass({})}>Continuar recorrido</Link> : null}
            {!rec && j.status !== "ARCHIVED" ? <Link to={`/app/viajes/${id}/recorrido`} className={buttonClass({})}>Iniciar recorrido</Link> : null}
            {j.status === "COMPLETED" ? <Button title="Compartir historia" aria-label="Compartir historia" size="icon" onClick={() => setShareOpen(true)}><Share2 className="size-5" aria-hidden="true" /></Button> : null}
            {j.status !== "ARCHIVED" ? <Link to={`/app/viajes/${id}/editar`} className={buttonClass({ variant: "outline" })}>Editar plan</Link> : null}
            {rec ? <Link to={`/app/viajes/${id}/visitas/nueva`} className={buttonClass({ variant: "secondary" })}><MapPinPlus className="size-5" aria-hidden="true" /> Añadir visita</Link> : null}
            <Button variant="ghost" size="icon" title="Duplicar plan" aria-label="Duplicar plan" loading={duplicate.isPending} onClick={() => duplicate.mutate()}><Copy className="size-5" aria-hidden="true" /></Button>
            {!diary ? <DeleteJourneyButton id={id} title={j.title} size="md" onDeleted={() => navigate("/app/viajes", { replace: true })} /> : null}
          </>
        }
      />
      {search.get("finalizado") ? <Alert tone="success" className="mb-4" title="¡Recorrido finalizado!">Tu historia quedó guardada como un diario privado. Cuando quieras, elige qué compartir.</Alert> : null}
      {j.sourcePublicationId ? <p className="mb-4 text-sm text-muted-foreground">Basado en una historia de la comunidad (solo se copiaron las paradas).</p> : null}
      {diary ? <>
        <p className="story-journey-title">{j.title}</p>
        <Tabs className="story-view-tabs" label="Vista de mi historia" value={view} onChange={setView} tabs={[{ id: "history", label: <span><BookOpen size={18} aria-hidden="true" /> Historia</span> }, { id: "map", label: <span><MapIcon size={18} aria-hidden="true" /> Mapa</span> }, { id: "track", label: <span><RouteIcon size={18} aria-hidden="true" /> Trayecto</span> }]} />
        <div className="story-completion-banner"><span className="story-check"><Check size={24} aria-hidden="true" /></span><span><strong>{j.status === "COMPLETED" ? "Recorrido completado" : "Tu historia sigue creciendo"}</strong><small>{vlist.length} visitas · {photos.length} fotos</small></span><AmazonArt /></div>
      </> : null}

      <div className={diary ? "story-view-content" : "grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]"}>
        <section hidden={diary && view !== "history"} aria-label={diary ? "Diario" : "Plan"}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-2xl">{diary ? "Diario del viaje" : "Plan"}</h2>
            {diary ? <DeleteJourneyButton id={id} title={j.title} diary iconOnly onDeleted={() => navigate("/app/viajes", { replace: true })} /> : null}
          </div>
          {items.length === 0 ? (
            <EmptyState title={diary ? "Aún no hay visitas" : "El plan está vacío"} action={<Link to={`/app/viajes/${id}/editar`} className={buttonClass({})}>Editar plan</Link>}>Añade paradas o registra tu primera visita.</EmptyState>
          ) : (
            <JourneyTrail variant={diary ? "diary" : "card"} items={items} selectedId={selected} onSelect={select} onMediaClick={(itemId, mi) => { const v = vlist.find((x) => x.id === itemId); if (v) setGallery({ items: v.media.filter((m) => m.status === "READY").map((m) => ({ src: m.displayUrl!, alt: m.caption ?? `Foto en ${v.place.name}`, caption: m.caption })), index: mi }); }} ariaLabel={diary ? "Visitas en orden cronológico" : "Paradas del plan"} />
          )}
        </section>
        <aside hidden={diary && view === "history"} className={diary ? "story-map-view" : "lg:sticky lg:top-24 lg:self-start"} aria-label={view === "track" ? "Trayecto GPS" : "Mapa"}>
          {!diary || view !== "history" ? <MapPanel key={view} markers={view === "track" && diary ? [] : markers} lines={view === "map" && diary ? [] : lines} selectedId={selected} onSelect={select} fitKey={`${id}:${view}:${markers.length}:${lines.length}`} className="h-[24rem]" ariaLabel={view === "track" ? "Mapa del trayecto GPS" : "Mapa del viaje"} /> : null}
          {diary && view === "track" && !lines.length ? <p className="mt-4 text-sm text-muted-foreground">No registraste un trayecto GPS en este viaje. Tus visitas y recuerdos siguen guardados en la historia.</p> : null}
          {diary && view === "track" ? <ul className="track-segment-list">{track.data?.segments.map((segment, i) => <li key={segment.id}><strong>Tramo {i + 1}</strong><span>{segment.points.length} puntos · {segment.points.reduce((sum, p, n, points) => n ? sum + distanceKm(points[n - 1]!, p) : sum, 0).toFixed(2)} km</span></li>)}</ul> : null}
          {track.isError ? <QueryError error={track.error} retry={() => track.refetch()} /> : null}
          {track.data && track.data.segments.length > 0 ? <p className="mt-2 text-xs text-muted-foreground">{track.data.segments.length} segmento(s) de trayecto registrados. Los huecos entre segmentos no se unen.</p> : null}
        </aside>
      </div>
      {diary ? <div className="story-footer-actions"><Button variant="outline" onClick={() => { setView("history"); setEditing((v) => !v); }}><Pencil size={17} aria-hidden="true" />{editing ? "Terminar edición" : "Editar recuerdos"}</Button>{j.status === "COMPLETED" ? <Button onClick={() => setShareOpen(true)}><Share2 size={17} aria-hidden="true" /> Compartir</Button> : null}</div> : null}
      <ShareStorySheet open={shareOpen} onClose={() => setShareOpen(false)} journeyId={id} />
      <Lightbox images={gallery?.items ?? []} index={gallery?.index ?? null} onClose={() => setGallery(null)} onIndex={(i) => gallery && setGallery({ ...gallery, index: i })} />
    </div>
  );
}
