import { Badge, Button } from "@por-aqui/ui";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUpRight, Camera, MapPinned, LocateFixed, Search } from "lucide-react";
import { useState } from "react";
import { DestinationPicker } from "../components/destination-picker";
import { distanceKm, useTravelCatalog } from "../lib/catalog";
import { Link } from "react-router";
import { LoadingBlock, QueryError } from "../components/shell";
import { api } from "../lib/api";
import { useMe } from "../lib/auth";
import { STATUS_LABEL, STATUS_TONE } from "../lib/format";
import { qk } from "../lib/query";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/app.inicio";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Mi inicio — Por aquí", noindex: true });
}

export default function InicioUsuario() {
  const { me } = useMe();
  const journeys = useQuery({ queryKey: qk.journeys(false), queryFn: ({ signal }) => api.journeys.list({}, { signal }) });
  const firstName = me?.profile.displayName.trim().split(/\s+/u)[0] ?? "viajero";
  const catalog = useTravelCatalog();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cityId, setCityId] = useState("");
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState("");
  const city = catalog.data?.cities.find((c) => c.id === cityId) ?? catalog.data?.cities[0];
  const cityQuery = city ? `&destino=${encodeURIComponent(city.name)}` : "";
  const locate = () => {
    if (!navigator.geolocation) { setLocationNote("Tu navegador no permite consultar la ubicación. Elige una ciudad en el buscador."); return; }
    setLocating(true); setLocationNote("");
    navigator.geolocation.getCurrentPosition((p) => {
      setLocating(false);
      const near = [...(catalog.data?.cities ?? [])].sort((a, b) => distanceKm({ lat: p.coords.latitude, lng: p.coords.longitude }, a) - distanceKm({ lat: p.coords.latitude, lng: p.coords.longitude }, b))[0];
      if (near) { setCityId(near.id); setLocationNote(`Ciudad disponible más cercana: ${near.name}.`); }
      else setLocationNote("No hay ciudades disponibles en este momento.");
    }, () => { setLocating(false); setLocationNote("No pudimos consultar la ubicación. Puedes seleccionar una ciudad en el buscador."); }, { timeout: 15000, maximumAge: 60000 });
  };
  return <div className="user-portal-home">
    <section className="user-discovery-hero" aria-labelledby="portal-welcome">
      <img className="discovery-backdrop" src="/images/portal-peru.webp" alt="Mapa ilustrado del Perú con una ruta que une Iquitos, Tarapoto, Lima, Cusco, Arequipa y Puno" width={1672} height={941} fetchPriority="high" />
      <div className="discovery-content">
        <p className="eyebrow">Hola, {firstName}. Tu próxima historia te espera.</p>
        <h1 id="portal-welcome">{catalog.data?.banner.title ?? "¿Dónde empieza tu próxima historia?"}</h1>
        <p>{catalog.data?.banner.subtitle ?? "Destinos reales. Experiencias memorables."}</p>
        <button type="button" className="discovery-search" onClick={() => setPickerOpen(true)}><Search size={21} aria-hidden="true" /><span>{city?.name ?? "Buscar ciudad"}</span><ArrowRight size={20} aria-hidden="true" /></button>
        <Button className="discovery-location" variant="secondary" loading={locating} disabled={!catalog.data} onClick={locate}><LocateFixed size={18} aria-hidden="true" />Usar mi ubicación</Button>
        {locationNote ? <p role="status" className="discovery-location-note">{locationNote}</p> : null}
        {catalog.isError ? <p role="alert">No se pudo cargar el catálogo. <button type="button" onClick={() => catalog.refetch()}>Reintentar</button></p> : null}
        <div className="discovery-actions">
          <Link to={`/app/viajes/nuevo?modo=auto${cityQuery}`}><MapPinned size={29} strokeWidth={1.3} aria-hidden="true" /><strong>{catalog.data?.banner.planLabel ?? "Planear una aventura"}</strong><ArrowRight className="discovery-action-arrow" size={21} aria-hidden="true" /></Link>
          <Link to={`/app/viajes/nuevo?modo=libre${cityQuery}`}><Camera size={29} strokeWidth={1.3} aria-hidden="true" /><strong>{catalog.data?.banner.recordLabel ?? "Registrar mi aventura"}</strong><ArrowRight className="discovery-action-arrow" size={21} aria-hidden="true" /></Link>
        </div>
      </div>
      <span className="discovery-city-caption">Ilustración del Perú · <a href="/images/creditos.html">Créditos</a></span>
    </section>
    <DestinationPicker open={pickerOpen} onClose={() => setPickerOpen(false)} selected={city?.id} onSelect={(c) => setCityId(c.id)} />
    <section aria-labelledby="recent-journeys" className="user-portal-recent">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5"><h2 id="recent-journeys" className="text-2xl">Tus últimas historias</h2><Link to="/app/viajes" className="text-sm">Ver mis aventuras <ArrowUpRight size={15} className="inline" aria-hidden="true" /></Link></div>
      {journeys.isPending ? <LoadingBlock label="Cargando tus aventuras…" /> : null}
      {journeys.isError ? <QueryError error={journeys.error} retry={() => journeys.refetch()} /> : null}
      {journeys.data?.length === 0 ? <div className="user-portal-empty"><h3 className="text-xl mb-2">Tu primera historia está por empezar</h3><p>Crea una aventura y deja espacio para lo que Iquitos tiene preparado para ti.</p></div> : null}
      <ul className="user-portal-journeys">
        {journeys.data?.slice(0, 3).map((j) => <li key={j.id}><Link to={`/app/viajes/${j.id}`}>
          <Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge><h3>{j.title}</h3><p>{j.destinationLabel ?? "Iquitos"} · {j.stopsCount} paradas · {j.visitsCount} visitas</p><span className="text-sm font-medium">Ver detalles <ArrowRight size={15} className="inline" aria-hidden="true" /></span>
        </Link></li>)}
      </ul>
    </section>
    <Link to="/explorar" className="portal-inspiration"><span><span className="eyebrow">Un poco de inspiración</span><strong>Encuentra tu próximo rincón de Iquitos</strong><span>Visita el portal para explorar lugares e ideas para tu próxima aventura.</span></span><ArrowUpRight aria-hidden="true" /></Link>
  </div>;
}
