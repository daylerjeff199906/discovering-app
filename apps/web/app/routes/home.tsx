import { buttonClass, Field, Input } from "@por-aqui/ui";
import { dehydrate, HydrationBoundary, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { Route as RouteIcon, Sparkles } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { RouteCard } from "../components/route-card";
import { api } from "../lib/api";
import { exploreQuery, interestsQuery, makeQueryClient, qk } from "../lib/query";
import { absoluteUrl, seoMeta, siteUrl } from "../lib/seo";
import type { Route } from "./+types/home";

export async function loader() {
  const qc = makeQueryClient();
  // La portada nunca debe caerse si la API no responde: se renderiza sin la muestra de comunidad.
  await Promise.allSettled([qc.prefetchInfiniteQuery({ ...exploreQuery({ limit: 3 }), pages: 1 }), qc.prefetchQuery(interestsQuery())]);
  return { dehydrated: dehydrate(qc) };
}

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Por aquí — descubre recorridos, planea y cuenta tu viaje", description: "Descubre recorridos compartidos, prepara tu viaje y registra lo que vives con fotos y notas. Tú decides qué compartir.", canonical: `${siteUrl()}/`, image: absoluteUrl(null) });
}

function DestinationForm() {
  const navigate = useNavigate();
  const [destino, setDestino] = useState("");
  const suggestions = useQuery({ queryKey: qk.destinations(destino), queryFn: ({ signal }) => api.places.destinations(destino || undefined, { signal }), staleTime: 300_000 });
  const go = (mode: "auto" | "libre") => navigate(`/app/viajes/nuevo?modo=${mode}${destino.trim() ? `&destino=${encodeURIComponent(destino.trim())}` : ""}`);
  return (
    <form
      className="mt-8 flex max-w-2xl flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        go("auto");
      }}
    >
      <Field label="Destino" hint="Una ciudad, región o país. Si aún no sabes, déjalo vacío.">
        {(c) => (
          <>
            <Input {...c} list="destinos" value={destino} onChange={(e) => setDestino(e.target.value)} placeholder="Iquitos, Cusco, Lisboa…" autoComplete="off" />
            <datalist id="destinos">{suggestions.data?.map((d) => <option key={d.label} value={d.locality} label={d.label} />)}</datalist>
          </>
        )}
      </Field>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={buttonClass({ size: "md" })}>
          <RouteIcon className="size-5" aria-hidden="true" /> Planear mi ruta
        </button>
        <button type="button" onClick={() => go("libre")} className={buttonClass({ variant: "secondary" })}>
          <Sparkles className="size-5" aria-hidden="true" /> Registrar mi aventura
        </button>
      </div>
    </form>
  );
}

function Community() {
  const q = useInfiniteQuery(exploreQuery({ limit: 3 }));
  const interests = useQuery(interestsQuery());
  const labels = Object.fromEntries((interests.data ?? []).map((i) => [i.slug, i.label]));
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (items.length === 0) return <p className="text-muted-foreground">Todavía no hay historias públicas. ¡Sé la primera persona en compartir una!</p>;
  return (
    <ul className="m-0 grid list-none gap-5 p-0 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((r) => (
        <li key={r.id}>
          <RouteCard route={r} interestLabels={labels} />
        </li>
      ))}
    </ul>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <HydrationBoundary state={loaderData.dehydrated}>
      <section className="grid items-center gap-10 py-6 md:py-12 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
        <div>
          <p className="text-sm font-semibold uppercase tracking-wide text-accent">Recorridos compartidos</p>
          <h1 className="mt-2 text-4xl md:text-5xl">¿Dónde empieza tu próxima historia?</h1>
          <p className="mt-4 max-w-xl text-lg text-muted-foreground">Arma una ruta con calma o sal a explorar y cuéntala después, con tus fotos y notas. Tú decides si queda privada, se comparte por enlace o se publica.</p>
          <DestinationForm />
        </div>
        <div className="hidden lg:block" aria-hidden="true">
          <div className="relative mx-auto aspect-[4/5] max-w-sm rounded-[2rem] bg-sage p-8 text-primary">
            <svg viewBox="0 0 200 260" className="size-full" fill="none">
              <path d="M40 220C40 150 150 170 150 110S60 70 100 30" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray="1 12" />
              <circle cx="40" cy="220" r="14" fill="currentColor" />
              <circle cx="150" cy="110" r="14" fill="#fffcf6" stroke="currentColor" strokeWidth="6" />
              <circle cx="100" cy="30" r="14" fill="#fffcf6" stroke="currentColor" strokeWidth="4" strokeDasharray="4 5" />
            </svg>
          </div>
        </div>
      </section>

      <section aria-labelledby="comunidad" className="mt-6">
        <div className="mb-4 flex items-end justify-between gap-4">
          <h2 id="comunidad" className="text-2xl">De la comunidad</h2>
          <Link to="/explorar" className="font-semibold">Ver todos los recorridos →</Link>
        </div>
        <Community />
      </section>
    </HydrationBoundary>
  );
}
