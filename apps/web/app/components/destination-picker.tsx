import type { CatalogCity } from "@por-aqui/contracts";
import { Alert, Button, Dialog, Input } from "@por-aqui/ui";
import { ArrowRight, Check, ChevronRight, MapPin, Search } from "lucide-react";
import { useState } from "react";
import { useTravelCatalog } from "../lib/catalog";
import { LoadingBlock, QueryError } from "./shell";

export function DestinationPicker({ open, onClose, selected, onSelect }: { open: boolean; onClose: () => void; selected?: string; onSelect: (city: CatalogCity) => void }) {
  const catalog = useTravelCatalog();
  const [query, setQuery] = useState("");
  const [previewId, setPreviewId] = useState("");
  const normalized = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const cities = catalog.data?.cities.filter((c) => normalized(`${c.name} ${c.region} ${c.country}`).includes(normalized(query))) ?? [];
  const current = cities.find((c) => c.id === previewId || c.name === previewId) ?? cities.find((c) => c.name === selected || c.id === selected) ?? cities[0];
  return <Dialog open={open} onClose={onClose} variant="sheet" title="Buscar destino" className="destination-dialog">
    <div className="destination-search-field"><Search size={19} aria-hidden="true" /><Input type="search" aria-label="Buscar ciudad" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Busca una ciudad" /></div>
    <div className="city-search-category"><span>Ciudad</span></div>
    {catalog.isPending ? <LoadingBlock label="Cargando ciudades…" /> : null}
    {catalog.isError ? <QueryError error={catalog.error} retry={() => catalog.refetch()} /> : null}
    <p className="mb-2 text-sm text-primary">Resultados ({cities.length})</p>
    <ul className="city-results">{cities.map((city) => <li key={city.id}><button type="button" aria-pressed={current?.id === city.id} onClick={() => setPreviewId(city.id)}>
      <img src={city.imageUrl} alt="" width={110} height={80} /><span><strong>{city.name}</strong><small>{city.country}</small></span>{current?.id === city.id ? <Check size={20} aria-hidden="true" /> : <ChevronRight size={19} aria-hidden="true" />}
    </button></li>)}</ul>
    {!cities.length && !catalog.isPending && !catalog.isError ? <Alert>No hay ciudades con ese nombre. Prueba otra búsqueda.</Alert> : null}
    {current ? <div className="city-preview"><img src={current.imageUrl} alt={`Paisaje de ${current.name}`} width={600} height={340} /><h3>{current.name}</h3><p className="text-muted-foreground">{current.country}</p><p>{current.description}</p><ul>{current.highlights.map((h) => <li key={h}><MapPin size={14} aria-hidden="true" />{h}</li>)}</ul><Button className="w-full" onClick={() => { onSelect(current); onClose(); }}>Elegir destino <ArrowRight size={18} aria-hidden="true" /></Button></div> : null}
  </Dialog>;
}
