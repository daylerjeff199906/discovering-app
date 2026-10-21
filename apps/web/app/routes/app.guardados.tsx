import { Button, EmptyState, buttonClass } from "@por-aqui/ui";
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
  const q = useQuery({ queryKey: qk.bookmarks, queryFn: ({ signal }) => api.bookmarks.list({ signal }) });
  const remove = useMutation({ mutationFn: (id: string) => api.bookmarks.remove(id), onSuccess: () => qc.invalidateQueries({ queryKey: qk.bookmarks }) });
  return (
    <>
      <PageHeader title="Guardados" subtitle="Inspiraciones que guardaste. Guardar no da acceso a nada que su autor haya retirado." actions={<Link to="/explorar" className={buttonClass({ variant: "outline" })}>Explorar más</Link>} />
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
            <Button variant="ghost" size="sm" className="self-start" loading={remove.isPending && remove.variables === b.publicationId} onClick={() => remove.mutate(b.publicationId)}>Quitar de guardados</Button>
          </li>
        ))}
      </ul>
    </>
  );
}
