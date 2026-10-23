import type { JourneyStatus, JourneySummaryDto } from "@por-aqui/contracts";
import { Alert, Badge, Button, EmptyState, Tabs, buttonClass } from "@por-aqui/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Copy, MapPin, MapPinned, Plus, ArrowUpRight, Play, Pencil, Eye } from "lucide-react";
import { DeleteJourneyButton } from "../components/delete-journey-button";
import { AmazonArt } from "../components/travel-art";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { LoadingBlock, PageHeader, QueryError } from "../components/shell";
import { api, errorMessage } from "../lib/api";
import { formatDate, STATUS_LABEL, STATUS_TONE } from "../lib/format";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/app.viajes";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Mis viajes — Por aquí", noindex: true });
}

const FILTERS: { id: "all" | JourneyStatus; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "DRAFT", label: "Borradores" },
  { id: "PLANNED", label: "Planeados" },
  { id: "IN_PROGRESS", label: "En curso" },
  { id: "COMPLETED", label: "Finalizados" },
  { id: "ARCHIVED", label: "Archivados" },
];

function primaryLink(j: JourneySummaryDto): { to: string; label: string } {
  if (j.status === "IN_PROGRESS" || j.status === "PAUSED") return { to: `/app/viajes/${j.id}/recorrido`, label: "Continuar recorrido" };
  if (j.status === "COMPLETED") return { to: `/app/viajes/${j.id}`, label: "Ver diario" };
  if (j.status === "ARCHIVED") return { to: `/app/viajes/${j.id}`, label: "Ver" };
  return { to: `/app/viajes/${j.id}/editar`, label: "Continuar editando" };
}

export default function MisViajes() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<"all" | JourneyStatus>("all");
  const q = useQuery({ queryKey: ["journeys", { archived: true }], queryFn: ({ signal }) => api.journeys.list({ includeArchived: true }, { signal }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["journeys"] });
  const duplicate = useMutation({ mutationFn: (id: string) => api.journeys.duplicate(id), onSuccess: (j) => navigate(`/app/viajes/${j.id}/editar`) });
  const archive = useMutation({ mutationFn: (v: { id: string; archived: boolean }) => (v.archived ? api.journeys.unarchive(v.id) : api.journeys.archive(v.id)), onSuccess: refresh });

  const items = (q.data ?? []).filter((j) => (filter === "all" ? j.status !== "ARCHIVED" : j.status === filter || (filter === "IN_PROGRESS" && j.status === "PAUSED")));
  return (
    <>
      <p className="eyebrow mb-2">Tu colección de caminos</p>
      <PageHeader title="Mis viajes" subtitle="Los que sueñas, los que vives y los que siempre recordarás." actions={<Link to="/app/viajes/nuevo" className={buttonClass({})}><Plus className="size-5" aria-hidden="true" /> Nuevo viaje</Link>} />
      <Link to="/explorar" className="portal-inspiration"><span><span className="eyebrow">Ideas para tu próxima historia</span><strong>Descubre Iquitos en el portal</strong><span>Inspírate con lugares y recorridos para hacerlos tuyos.</span></span><ArrowUpRight aria-hidden="true" /></Link>
      <div className="journey-filters mb-6 overflow-x-auto pb-1">
        <Tabs className="journey-filter-tabs" label="Filtrar por estado" value={filter} onChange={(v) => setFilter(v as typeof filter)} tabs={FILTERS} />
      </div>
      {q.isPending ? <LoadingBlock label="Cargando tus viajes…" /> : null}
      {q.isError ? <QueryError error={q.error} retry={() => q.refetch()} /> : null}
      {duplicate.isError || archive.isError ? <Alert tone="danger" live="assertive" className="mb-4">{errorMessage(duplicate.error ?? archive.error)}</Alert> : null}
      {q.data && items.length === 0 ? (
        <EmptyState icon={<MapPinned size={38} strokeWidth={1.1} />} title={filter === "all" ? "Tu primera historia está por empezar" : "Este capítulo aún está por escribir"} action={<Link to="/app/viajes/nuevo" className={buttonClass({})}>Crear mi primer viaje</Link>}>
          Un destino que te llama, una calle por descubrir. Crea un viaje y empieza a guardar lo que te hace sentir.
        </EmptyState>
      ) : null}
      <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-3">
        {items.map((j) => {
          const p = primaryLink(j);
          return (
            <li key={j.id} className="journey-collection-card flex flex-col overflow-hidden rounded-card border border-border bg-surface shadow-card">
              {j.coverUrl ? <img src={j.coverUrl} alt="" className="journey-owned-cover" width={500} height={260} /> : <div className="journey-card-art" aria-hidden="true"><MapPinned size={27} strokeWidth={1} /><AmazonArt /><span>{j.destinationLabel ?? "Tu próximo camino"}</span></div>}
              <div className="flex flex-1 flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-xl"><Link to={`/app/viajes/${j.id}`} className="journey-card-detail-link text-foreground no-underline hover:underline">{j.title}</Link></h2>
                <Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {j.destinationLabel ? <span className="mb-2 flex items-center gap-1"><MapPin size={13} aria-hidden="true" />{j.destinationLabel}</span> : null}{j.stopsCount} paradas · {j.visitsCount} visitas<br /><span className="text-xs">Actualizado {formatDate(j.updatedAt)}</span>
              </p>
              {j.publicationVisibility && j.publicationVisibility !== "PRIVATE" ? <p className="text-sm font-semibold text-success">{j.publicationVisibility === "PUBLIC" ? "Publicado en la comunidad" : "Compartido por enlace"}</p> : null}
              <div className="journey-card-actions mt-auto flex flex-wrap gap-2 pt-1">
                <Link to={p.to} title={p.label} aria-label={`${p.label}: ${j.title}`} className={buttonClass({ size: "icon" })}>{j.status === "IN_PROGRESS" || j.status === "PAUSED" ? <Play size={18} aria-hidden="true" /> : j.status === "DRAFT" || j.status === "PLANNED" ? <Pencil size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</Link>
                <Button size="icon" variant="outline" title="Duplicar viaje" aria-label={`Duplicar ${j.title}`} loading={duplicate.isPending && duplicate.variables === j.id} onClick={() => duplicate.mutate(j.id)}><Copy className="size-4" aria-hidden="true" /></Button>
                <Button size="icon" variant="ghost" title={j.status === "ARCHIVED" ? "Desarchivar" : "Archivar"} aria-label={`${j.status === "ARCHIVED" ? "Desarchivar" : "Archivar"} ${j.title}`} loading={archive.isPending && archive.variables?.id === j.id} onClick={() => archive.mutate({ id: j.id, archived: j.status === "ARCHIVED" })}>
                  {j.status === "ARCHIVED" ? <ArchiveRestore className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}
                </Button>
                <DeleteJourneyButton id={j.id} title={j.title} iconOnly />
              </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
