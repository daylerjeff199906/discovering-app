import { TRANSPORT_MODES, type ExploreQuery, type TransportMode } from "@por-aqui/contracts";
import { Button, EmptyState, Field, Input, Select, buttonClass } from "@por-aqui/ui";
import { dehydrate, HydrationBoundary, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Form, Link, useNavigation } from "react-router";
import { RouteCard } from "../components/route-card";
import { LoadingBlock, PageHeader, QueryError } from "../components/shell";
import { TRANSPORT_LABEL } from "../lib/format";
import { exploreQuery, interestsQuery, makeQueryClient } from "../lib/query";
import { seoMeta, siteUrl } from "../lib/seo";
import type { Route } from "./+types/explorar";

/** Filtros en la URL: se pueden compartir, recargar y navegar con «atrás». */
function filtersFrom(url: URL): Partial<ExploreQuery> {
  const p = url.searchParams;
  const transport = p.get("transporte");
  return {
    limit: 12,
    q: p.get("q") || undefined,
    destination: p.get("destino") || "Iquitos",
    interest: p.get("interes") || undefined,
    transport: transport && (TRANSPORT_MODES as readonly string[]).includes(transport) ? (transport as TransportMode) : undefined,
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const qc = makeQueryClient();
  const filters = filtersFrom(new URL(request.url));
  await Promise.allSettled([qc.prefetchInfiniteQuery({ ...exploreQuery(filters), pages: 1 }), qc.prefetchQuery(interestsQuery())]);
  return { dehydrated: dehydrate(qc), filters };
}

export function meta({ loaderData }: Route.MetaArgs) {
  const f = loaderData?.filters;
  const filtered = f && (f.q || (f.destination && f.destination !== "Iquitos") || f.interest || f.transport);
  return seoMeta({
    title: filtered ? "Resultados de recorridos — Por aquí" : "Explorar Iquitos — Por aquí",
    description: "Descubre Iquitos con los recorridos de la comunidad: lugares, fotos y notas para inspirar tu próxima aventura.",
    canonical: `${siteUrl()}/explorar`,
    noindex: Boolean(filtered),
  });
}

function Results({ filters }: { filters: Partial<ExploreQuery> }) {
  const q = useInfiniteQuery(exploreQuery(filters));
  const interests = useQuery(interestsQuery());
  const labels = Object.fromEntries((interests.data ?? []).map((i) => [i.slug, i.label]));
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  if (q.isPending) return <LoadingBlock label="Buscando recorridos…" />;
  if (q.isError) return <QueryError error={q.error} retry={() => q.refetch()} />;
  if (items.length === 0) {
    return (
      <EmptyState title="Aún no hay recorridos que coincidan" action={<Link to="/explorar" className={buttonClass({ variant: "outline" })}>Quitar filtros</Link>}>
        Si buscas algo muy específico, prueba con menos filtros. Y si tienes una aventura para contar, ¡puedes publicar el primero!
      </EmptyState>
    );
  }
  return (
    <>
      <ul className="m-0 grid list-none gap-5 p-0 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((r) => (
          <li key={r.id}>
            <RouteCard route={r} interestLabels={labels} />
          </li>
        ))}
      </ul>
      {q.hasNextPage ? (
        <div className="mt-8 flex justify-center">
          <Button variant="outline" onClick={() => q.fetchNextPage()} loading={q.isFetchingNextPage}>
            Cargar más recorridos
          </Button>
        </div>
      ) : (
        <p className="mt-8 text-center text-sm text-muted-foreground">Ya viste todos los recorridos.</p>
      )}
    </>
  );
}

export default function Explorar({ loaderData }: Route.ComponentProps) {
  const { filters } = loaderData;
  const nav = useNavigation();
  const interests = useQuery(interestsQuery());
  return (
    <HydrationBoundary state={loaderData.dehydrated}>
      <PageHeader title="Explorar Iquitos" subtitle="Historias y recorridos de Iquitos. Guarda los que te inspiren o úsalos como base para armar el tuyo." />
      <Form method="get" role="search" className="mb-8 grid gap-4 rounded-card border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1.4fr_1.2fr_1.2fr_auto] lg:items-end">
        <Field label="Buscar">{(c) => <Input {...c} name="q" type="search" defaultValue={filters.q} placeholder="Título, lugar o tema" />}</Field>
        <Field label="Destino">{(c) => <Input {...c} name="destino" defaultValue={filters.destination} placeholder="Iquitos, Loreto…" />}</Field>
        <Field label="Interés">
          {(c) => (
            <Select {...c} name="interes" defaultValue={filters.interest ?? ""}>
              <option value="">Todos</option>
              {interests.data?.map((i) => <option key={i.slug} value={i.slug}>{i.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Transporte">
          {(c) => (
            <Select {...c} name="transporte" defaultValue={filters.transport ?? ""}>
              <option value="">Cualquiera</option>
              {TRANSPORT_MODES.map((m) => <option key={m} value={m}>{TRANSPORT_LABEL[m]}</option>)}
            </Select>
          )}
        </Field>
        <Button type="submit" loading={nav.state === "loading"}>Buscar</Button>
      </Form>
      <Results key={JSON.stringify(filters)} filters={filters} />
    </HydrationBoundary>
  );
}
