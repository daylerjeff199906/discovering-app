import { dehydrate, HydrationBoundary, useQuery } from "@tanstack/react-query";
import { StoryView } from "../components/story";
import { LoadingBlock, QueryError } from "../components/shell";
import { toResponse } from "../lib/loaders";
import { makeQueryClient, routeQuery } from "../lib/query";
import { absoluteUrl, seoMeta, siteUrl } from "../lib/seo";
import type { Route } from "./+types/ruta-publica";

export async function loader({ params }: Route.LoaderArgs) {
  const qc = makeQueryClient();
  try {
    const route = await qc.fetchQuery(routeQuery(params.slug));
    return {
      dehydrated: dehydrate(qc),
      slug: params.slug,
      seo: { title: route.title, description: route.description ?? `${route.entries.length} paradas por ${route.author.displayName}`, image: route.cover?.url ?? null, author: route.author.displayName },
    };
  } catch (err) {
    throw toResponse(err);
  }
}

// El HTML contiene título, descripción y Open Graph sin ejecutar JavaScript.
export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return seoMeta({ title: "Historia no disponible — Por aquí", noindex: true });
  return seoMeta({ title: `${loaderData.seo.title} — Por aquí`, description: loaderData.seo.description, canonical: `${siteUrl()}/r/${loaderData.slug}`, image: absoluteUrl(loaderData.seo.image), type: "article" });
}

function Story({ slug }: { slug: string }) {
  const q = useQuery(routeQuery(slug));
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <QueryError error={q.error} retry={() => q.refetch()} />;
  return <StoryView route={q.data} />;
}

export default function RutaPublica({ loaderData }: Route.ComponentProps) {
  return (
    <HydrationBoundary state={loaderData.dehydrated}>
      <Story slug={loaderData.slug} />
    </HydrationBoundary>
  );
}
