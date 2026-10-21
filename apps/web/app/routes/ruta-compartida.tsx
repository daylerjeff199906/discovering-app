import { dehydrate, HydrationBoundary, useQuery } from "@tanstack/react-query";
import { StoryView } from "../components/story";
import { LoadingBlock, QueryError } from "../components/shell";
import { toResponse } from "../lib/loaders";
import { makeQueryClient, sharedQuery } from "../lib/query";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/ruta-compartida";

/**
 * Historia solo por enlace: noindex, no-store y Referrer-Policy: no-referrer (ver entry.server.tsx).
 * Sin canonical ni Open Graph con el token; el título genérico evita filtrar contenido a vistas previas.
 */
export async function loader({ params }: Route.LoaderArgs) {
  const qc = makeQueryClient();
  try {
    await qc.fetchQuery(sharedQuery(params.token));
    return { dehydrated: dehydrate(qc), token: params.token };
  } catch (err) {
    throw toResponse(err);
  }
}

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Historia compartida — Por aquí", noindex: true });
}

function Story({ token }: { token: string }) {
  const q = useQuery(sharedQuery(token));
  if (q.isPending) return <LoadingBlock />;
  if (q.isError) return <QueryError error={q.error} retry={() => q.refetch()} />;
  return <StoryView route={q.data} shareToken={token} />;
}

export default function RutaCompartida({ loaderData }: Route.ComponentProps) {
  return (
    <HydrationBoundary state={loaderData.dehydrated}>
      <Story token={loaderData.token} />
    </HydrationBoundary>
  );
}
