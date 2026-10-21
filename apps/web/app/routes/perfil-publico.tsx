import { Avatar, Badge, EmptyState } from "@por-aqui/ui";
import { dehydrate, HydrationBoundary, useQuery } from "@tanstack/react-query";
import { RouteCard } from "../components/route-card";
import { LoadingBlock, QueryError } from "../components/shell";
import { toResponse } from "../lib/loaders";
import { makeQueryClient, profileQuery } from "../lib/query";
import { seoMeta, siteUrl } from "../lib/seo";
import type { Route } from "./+types/perfil-publico";

export async function loader({ params }: Route.LoaderArgs) {
  const qc = makeQueryClient();
  try {
    const p = await qc.fetchQuery(profileQuery(params.username));
    return { dehydrated: dehydrate(qc), username: params.username, seo: { name: p.displayName, bio: p.bio, count: p.routes.length, canonicalName: p.username } };
  } catch (err) {
    throw toResponse(err);
  }
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return seoMeta({ title: "Perfil no disponible — Por aquí", noindex: true });
  const { seo } = loaderData;
  return seoMeta({ title: `${seo.name} — Por aquí`, description: seo.bio ?? `${seo.count} recorridos públicos de ${seo.name}`, canonical: `${siteUrl()}/u/${seo.canonicalName}`, type: "profile" });
}

function Profile({ username }: { username: string }) {
  const q = useQuery(profileQuery(username));
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <QueryError error={q.error} retry={() => q.refetch()} />;
  const p = q.data;
  return (
    <>
      <header className="mb-8 flex flex-wrap items-center gap-5">
        <Avatar name={p.displayName} src={p.avatarUrl} size={88} />
        <div>
          <h1 className="text-3xl md:text-4xl">{p.displayName}</h1>
          <p className="text-muted-foreground">@{p.username}</p>
          {p.isDemo ? <Badge tone="warning" className="mt-2">Cuenta de demostración</Badge> : null}
          {p.bio ? <p className="mt-2 max-w-xl">{p.bio}</p> : null}
        </div>
      </header>
      <h2 className="mb-4 text-2xl">Recorridos públicos</h2>
      {p.routes.length === 0 ? (
        <EmptyState title="Todavía no hay recorridos públicos">Esta persona aún no ha publicado historias en la comunidad.</EmptyState>
      ) : (
        <ul className="m-0 grid list-none gap-5 p-0 sm:grid-cols-2 xl:grid-cols-3">
          {p.routes.map((r) => (
            <li key={r.id}><RouteCard route={r} /></li>
          ))}
        </ul>
      )}
    </>
  );
}

export default function PerfilPublico({ loaderData }: Route.ComponentProps) {
  return (
    <HydrationBoundary state={loaderData.dehydrated}>
      <Profile username={loaderData.username} />
    </HydrationBoundary>
  );
}
