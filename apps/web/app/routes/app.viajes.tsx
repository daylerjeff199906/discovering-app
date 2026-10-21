import type { JourneyStatus, JourneySummaryDto } from "@por-aqui/contracts";
import { Alert, Badge, Button, EmptyState, Tabs, buttonClass } from "@por-aqui/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArchiveRestore, Copy, Plus } from "lucide-react";
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
      <PageHeader title="Mis viajes" subtitle="Borradores, planes, recorridos en curso y diarios finalizados." actions={<Link to="/app/viajes/nuevo" className={buttonClass({})}><Plus className="size-5" aria-hidden="true" /> Nuevo viaje</Link>} />
      <div className="mb-6 overflow-x-auto pb-1">
        <Tabs label="Filtrar por estado" value={filter} onChange={(v) => setFilter(v as typeof filter)} tabs={FILTERS} />
      </div>
      {q.isPending ? <LoadingBlock label="Cargando tus viajes…" /> : null}
      {q.isError ? <QueryError error={q.error} retry={() => q.refetch()} /> : null}
      {duplicate.isError || archive.isError ? <Alert tone="danger" live="assertive" className="mb-4">{errorMessage(duplicate.error ?? archive.error)}</Alert> : null}
      {q.data && items.length === 0 ? (
        <EmptyState title={filter === "all" ? "Todavía no tienes viajes" : "No hay viajes en este estado"} action={<Link to="/app/viajes/nuevo" className={buttonClass({})}>Crear mi primer viaje</Link>}>
          Planea una ruta paso a paso o empieza a registrar una aventura sin itinerario.
        </EmptyState>
      ) : null}
      <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-3">
        {items.map((j) => {
          const p = primaryLink(j);
          return (
            <li key={j.id} className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-xl"><Link to={p.to} className="text-foreground no-underline hover:underline">{j.title}</Link></h2>
                <Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                {j.destinationLabel ? `${j.destinationLabel} · ` : ""}{j.stopsCount} paradas · {j.visitsCount} visitas · actualizado {formatDate(j.updatedAt)}
              </p>
              {j.publicationVisibility && j.publicationVisibility !== "PRIVATE" ? <p className="text-sm font-semibold text-success">{j.publicationVisibility === "PUBLIC" ? "Publicado en la comunidad" : "Compartido por enlace"}</p> : null}
              <div className="mt-auto flex flex-wrap gap-2 pt-1">
                <Link to={p.to} className={buttonClass({ size: "sm" })}>{p.label}</Link>
                <Button size="sm" variant="outline" loading={duplicate.isPending && duplicate.variables === j.id} onClick={() => duplicate.mutate(j.id)}><Copy className="size-4" aria-hidden="true" /> Duplicar</Button>
                <Button size="sm" variant="ghost" onClick={() => archive.mutate({ id: j.id, archived: j.status === "ARCHIVED" })}>
                  {j.status === "ARCHIVED" ? <ArchiveRestore className="size-4" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}
                  {j.status === "ARCHIVED" ? "Desarchivar" : "Archivar"}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
