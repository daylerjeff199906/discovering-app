import { Button, EmptyState, Tabs, buttonClass } from "@por-aqui/ui";
import { BookmarkX } from "lucide-react";
import { useState } from "react";
import { useTravelCatalog } from "../lib/catalog";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { RouteCard } from "../components/route-card";
import { LoadingBlock, PageHeader, QueryError } from "../components/shell";
import { api, errorMessage } from "../lib/api";
import { formatDate } from "../lib/format";
import { qk } from "../lib/query";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/app.guardados";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Guardados — Por aquí", noindex: true });
}

export default function Guardados() {
  const qc = useQueryClient();
  const [tab, setTab] = useState("places");
  const catalog = useTravelCatalog();
  const places = useQuery({ queryKey: ["saved-places"], queryFn: ({ signal }) => api.catalog.savedPlaces({ signal }) });
  const removePlace = useMutation({ mutationFn: (id: string) => api.catalog.unsavePlace(id), onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-places"] }) });
  const q = useQuery({ queryKey: qk.bookmarks, queryFn: ({ signal }) => api.bookmarks.list({ signal }) });
  const remove = useMutation({ mutationFn: (id: string) => api.bookmarks.remove(id), onSuccess: () => qc.invalidateQueries({ queryKey: qk.bookmarks }) });
  return (
    <>
      <PageHeader title="Guardados" subtitle="Inspiraciones que guardaste. Guardar no da acceso a nada que su autor haya retirado." actions={<Link to="/explorar" className={buttonClass({ variant: "outline" })}>Explorar más</Link>} />
      <Tabs className="mb-5" label="Tipo de guardados" value={tab} onChange={setTab} tabs={[{ id: "places", label: "Lugares" }, { id: "stories", label: "Historias" }]} />
      {tab === "places" ? <>
        {places.isPending ? <LoadingBlock /> : null}{places.isError ? <QueryError error={places.error} retry={() => places.refetch()} /> : null}
        {places.data?.length === 0 ? <EmptyState title="Tus lugares favoritos, a mano">Guarda lugares al añadir paradas a un viaje. Los encontrarás aquí y en la pestaña Guardados del editor.</EmptyState> : null}
        {removePlace.isError ? <p role="alert" className="text-danger">{errorMessage(removePlace.error)}</p> : null}
        <ul className="saved-place-grid">{places.data?.map((p) => { const visual = catalog.data?.places.find((v) => v.id === p.id); return <li key={p.id}>{visual ? <img src={visual.imageUrl} alt="" width={400} height={200} /> : null}<div><h2>{p.name}</h2><p>{p.description ?? p.locality}</p><Button size="icon" variant="ghost" title="Quitar lugar guardado" aria-label={`Quitar de guardados ${p.name}`} loading={removePlace.isPending && removePlace.variables === p.id} onClick={() => removePlace.mutate(p.id)}><BookmarkX size={18} aria-hidden="true" /></Button></div></li>; })}</ul>
      </> : <>
      {q.isPending ? <LoadingBlock /> : null}
      {q.isError ? <QueryError error={q.error} retry={() => q.refetch()} /> : null}
      {remove.isError ? <p role="alert" className="mb-3 text-danger">{errorMessage(remove.error)}</p> : null}
      {q.data?.length === 0 ? <EmptyState title="Aún no guardaste nada" action={<Link to="/explorar" className={buttonClass({})}>Explorar recorridos</Link>}>Cuando una historia te inspire, pulsa «Guardar inspiración».</EmptyState> : null}
      <ul className="m-0 grid list-none gap-5 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {q.data?.map((b) => (
          <li key={b.publicationId} className="flex flex-col gap-2">
            {b.card ? (
              <RouteCard route={b.card} />
            ) : (
              <div className="rounded-card border border-dashed border-control-border bg-surface p-5">
                <h2 className="text-lg">Historia no disponible</h2>
                <p className="mt-1 text-sm text-muted-foreground">Su autor la retiró o fue ocultada. Guardada el {formatDate(b.savedAt)}.</p>
              </div>
            )}
            <Button variant="ghost" size="icon" title="Quitar historia guardada" aria-label={`Quitar de guardados ${b.card?.title ?? 'historia'}`} className="self-start" loading={remove.isPending && remove.variables === b.publicationId} onClick={() => remove.mutate(b.publicationId)}><BookmarkX size={18} aria-hidden="true" /></Button>
          </li>
        ))}
      </ul>
      </>}
    </>
  );
}
