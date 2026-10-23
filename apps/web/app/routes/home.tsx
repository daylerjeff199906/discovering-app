import {
  dehydrate,
  HydrationBoundary,
  useInfiniteQuery,
  useQuery,
} from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowRight,
  Camera,
  Compass,
  MapPin,
  MapPinned,
  Search,
  ShieldCheck,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { RouteCard } from "../components/route-card";
import { AmazonArt } from "../components/travel-art";
import { travelPhotos } from "../lib/travel-photos";
import { api } from "../lib/api";
import {
  exploreQuery,
  interestsQuery,
  makeQueryClient,
  qk,
} from "../lib/query";
import { absoluteUrl, seoMeta, siteUrl } from "../lib/seo";
import type { Route } from "./+types/home";

export async function loader() {
  const qc = makeQueryClient();
  await Promise.allSettled([
    qc.prefetchInfiniteQuery({
      ...exploreQuery({ limit: 3, destination: "Iquitos" }),
      pages: 1,
    }),
    qc.prefetchQuery(interestsQuery()),
  ]);
  return { dehydrated: dehydrate(qc) };
}

export function meta(_: Route.MetaArgs) {
  return seoMeta({
    title: "Por aquí — descubre Iquitos a tu manera",
    description:
      "Descubre lugares de Iquitos, prepara tus recorridos y guarda tus recuerdos con fotos y notas.",
    canonical: `${siteUrl()}/`,
    image: absoluteUrl(null),
  });
}

function DestinationForm() {
  const navigate = useNavigate();
  const [destino, setDestino] = useState("");
  const suggestions = useQuery({
    queryKey: [...qk.destinations(destino), "Iquitos"],
    queryFn: async ({ signal }) =>
      (await api.places.destinations(destino || "Iquitos", { signal })).filter((destination) => destination.locality === "Iquitos"),
    staleTime: 300_000,
  });
  const go = (mode: "auto" | "libre") =>
    navigate(
      `/app/viajes/nuevo?modo=${mode}${destino.trim() ? `&destino=${encodeURIComponent(destino.trim())}` : ""}`,
    );
  return (
    <form
      className="destination-form"
      onSubmit={(e) => {
        e.preventDefault();
        go("auto");
      }}
    >
      <div className="destination-search">
        <Search size={21} aria-hidden="true" />
        <label htmlFor="home-destination" className="sr-only">
          ¿A dónde quieres ir?
        </label>
        <input
          id="home-destination"
          list="destinos"
          value={destino}
          onChange={(e) => setDestino(e.target.value)}
          placeholder="Iquitos, Loreto…"
          autoComplete="off"
        />
        <datalist id="destinos">
          {suggestions.data?.map((d) => (
            <option key={d.label} value={d.locality} label={d.label} />
          ))}
        </datalist>
        <button type="submit" aria-label="Buscar destino y planear viaje">
          <ArrowRight size={20} aria-hidden="true" />
        </button>
      </div>
      <div className="hero-actions">
        <button
          type="submit"
          className="adventure-action adventure-action-primary"
        >
          <MapPinned size={27} strokeWidth={1.3} aria-hidden="true" />
          <span>
            Planear
            <br />
            un viaje
          </span>
          <ArrowRight className="action-arrow" size={22} aria-hidden="true" />
        </button>
        <button
          type="button"
          onClick={() => go("libre")}
          className="adventure-action adventure-action-sage"
        >
          <Camera size={27} strokeWidth={1.3} aria-hidden="true" />
          <span>
            Registrar
            <br />
            mi aventura
          </span>
          <ArrowRight className="action-arrow" size={22} aria-hidden="true" />
        </button>
      </div>
    </form>
  );
}

function Community() {
  const q = useInfiniteQuery(
    exploreQuery({ limit: 3, destination: "Iquitos" }),
  );
  const interests = useQuery(interestsQuery());
  const labels = Object.fromEntries(
    (interests.data ?? []).map((i) => [i.slug, i.label]),
  );
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (items.length === 0)
    return (
      <p className="text-muted-foreground">
        Cada gran historia empieza con un primer paso. Comparte el tuyo.
      </p>
    );
  return (
    <ul className="community-grid">
      {items.map((r) => (
        <li key={r.id}>
          <RouteCard route={r} interestLabels={labels} />
        </li>
      ))}
    </ul>
  );
}

const destinations = [
  {
    name: "Plaza de Armas",
    country: "Iquitos",
    detail: "Historia y arquitectura en el corazón de la ciudad",
    image: travelPhotos.plaza,
    query: "Iquitos",
    title: "Un paseo por el centro de Iquitos",
  },
  {
    name: "Malecón Tarapacá",
    country: "Iquitos",
    detail: "Una caminata para mirar el río sin prisa",
    image: travelPhotos.malecon,
    query: "Iquitos",
    title: "Una tarde en el Malecón Tarapacá",
  },
  {
    name: "Belén",
    country: "Iquitos",
    detail: "La vida de un barrio junto al río",
    image: travelPhotos.belen,
    query: "Iquitos",
    title: "Descubriendo Belén, Iquitos",
  },
];

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <HydrationBoundary state={loaderData.dehydrated}>
      <section className="home-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <p className="eyebrow">
            <span className="tiny-line" />
            Iquitos. Lugares reales. Historias tuyas.
          </p>
          <h1 id="hero-title">
            Tu historia
            <br />
            comienza en
            <br />
            <em>Iquitos.</em>
          </h1>
          <p className="hero-description">
            Entre el río, sus calles y la selva.
            <br />
            Descubre Iquitos a tu ritmo.
          </p>
          <DestinationForm />
          <p className="hero-assurance">
            <ShieldCheck size={15} aria-hidden="true" /> A tu ritmo. A tu
            manera. Siempre tuyo.
          </p>
        </div>
        <div className="hero-photo-wrap">
          <img
            src={travelPhotos.plaza}
            alt="Plaza de Armas de Iquitos, con palmeras y la Casa de Fierro"
            width={1800}
            height={1200}
            fetchPriority="high"
            className="hero-photo"
          />
          <div className="photo-coordinate">
            <MapPin size={15} aria-hidden="true" /> Iquitos, Loreto, Perú{" "}
            <span>Amazonía peruana</span>
          </div>
          <div className="hero-photo-note">
            <Compass size={30} strokeWidth={1} aria-hidden="true" />
            <p>
              El mejor camino
              <br />
              <span>es el que haces tuyo.</span>
            </p>
          </div>
          <div className="travel-stamp" aria-hidden="true">
            <span>POR AQUÍ</span>
            <MapPinned size={24} strokeWidth={1} />
            <span>DEJA TU HUELLA</span>
          </div>
        </div>
      </section>

      <section
        className="destinations-section"
        aria-labelledby="destinations-title"
      >
        <div className="section-heading">
          <div>
            <p className="eyebrow">Lugares de Iquitos</p>
            <h2 id="destinations-title">Iquitos, un lugar a la vez.</h2>
          </div>
          <a href="#destinations" className="editorial-link">
            Elige tu próximo paseo <ArrowDown size={17} aria-hidden="true" />
          </a>
        </div>
        <div id="destinations" className="destination-grid">
          {destinations.map((d, i) => (
            <Link
              key={d.name}
              to={`/app/viajes/nuevo?destino=${encodeURIComponent(d.query)}&titulo=${encodeURIComponent(d.title)}`}
              className="destination-card"
            >
              <div className="destination-image">
                <img
                  src={d.image}
                  alt=""
                  width={600}
                  height={420}
                  loading="lazy"
                />
                <span className="destination-number">0{i + 1}</span>
                <span className="destination-open">
                  <ArrowRight size={21} aria-hidden="true" />
                </span>
              </div>
              <div className="destination-caption">
                <h3>
                  {d.name}
                  <span>{d.country}</span>
                </h3>
                <p>{d.detail}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      <section className="journey-manifesto" aria-labelledby="manifesto-title">
        <div>
          <p className="eyebrow">
            Menos itinerarios perfectos. Más momentos tuyos.
          </p>
          <h2 id="manifesto-title">
            Descubre. Explora.
            <br />
            <em>Guarda lo vivido.</em>
          </h2>
          <p>
            Prepara tu camino, deja espacio para lo inesperado y convierte cada
            parada en un recuerdo.
          </p>
        </div>
        <ol>
          {[
            {
              title: "Encuentra la inspiración",
              text: "Descubre recorridos y lugares que despierten tus ganas de ir.",
              Icon: Compass,
            },
            {
              title: "Haz el camino tuyo",
              text: "Arma tu ruta o sal a explorar sin un plan. Tú eliges.",
              Icon: MapPinned,
            },
            {
              title: "Llévate una historia",
              text: "Guarda tus fotos y notas en un diario que siempre podrás volver a abrir.",
              Icon: Camera,
            },
          ].map(({ title, text, Icon }, i) => (
            <li key={title}>
              <span className="manifesto-number">0{i + 1}</span>
              <div>
                <Icon size={22} strokeWidth={1.3} aria-hidden="true" />
                <h3>{title}</h3>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
        <AmazonArt className="manifesto-amazon" />
      </section>

      <section aria-labelledby="comunidad" className="community-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">De viajero a viajero</p>
            <h2 id="comunidad">Caminos que inspiran.</h2>
          </div>
          <Link to="/explorar" className="editorial-link">
            Explorar historias <ArrowRight size={17} aria-hidden="true" />
          </Link>
        </div>
        <Community />
      </section>
      <p className="mt-5 text-right text-[10px] text-muted-foreground">
        <a href="/images/creditos.html">Fotografías de Iquitos · créditos</a>
      </p>
    </HydrationBoundary>
  );
}
