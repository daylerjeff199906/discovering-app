import type { PlaceDto } from "@por-aqui/contracts";
import { Alert, Button, Dialog, Field, Input, Tabs } from "@por-aqui/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, ChevronDown, MapPin, MapPinPlus, Plus, Search } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { useTravelCatalog } from "../lib/catalog";
import { capabilitiesQuery } from "../lib/query";
import { MapPanel } from "./map";
import { PhotoCredit } from "./photo-credit";

export function AddStopDialog({ open, onClose, near, destinationLabel, onPick, busy }: { open: boolean; onClose: () => void; near?: { lng: number; lat: number } | null; destinationLabel?: string; onPick: (placeId: string) => Promise<unknown>; busy?: boolean }) {
  const qc = useQueryClient();
  const catalog = useTravelCatalog();
  const [tab, setTab] = useState("near");
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  // Acordeón: solo una sección abierta a la vez (elegir un lugar existente o crear uno nuevo).
  const [section, setSection] = useState<"pick" | "create">("pick");
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [pickError, setPickError] = useState("");
  const caps = useQuery(capabilitiesQuery());
  const search = useQuery({ queryKey: ["place-search", submitted, destinationLabel, near], queryFn: ({ signal }) => api.places.search({ q: submitted || undefined, locality: destinationLabel?.split(",")[0]?.trim(), lng: near?.lng, lat: near?.lat, scope: "all", limit: 30 }, { signal }), enabled: open && tab === "near" });
  const saved = useQuery({ queryKey: ["saved-places"], queryFn: ({ signal }) => api.catalog.savedPlaces({ signal }), enabled: open });
  const bookmark = useMutation({ mutationFn: (p: PlaceDto) => saved.data?.some((v) => v.id === p.id) ? api.catalog.unsavePlace(p.id) : api.catalog.savePlace(p.id), onSuccess: () => qc.invalidateQueries({ queryKey: ["saved-places"] }) });
  const [name, setName] = useState("");
  const [point, setPoint] = useState<{ lng: number; lat: number } | null>(null);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [geo, setGeo] = useState("");
  const geocode = useQuery({ queryKey: ["geocode", geo], queryFn: ({ signal }) => api.places.geocode(geo, { signal }), enabled: open && Boolean(geo) && Boolean(caps.data?.geocoder.available) });
  const create = useMutation({ mutationFn: () => api.places.create({ name: name.trim(), lng: point!.lng, lat: point!.lat, locality: destinationLabel?.split(",")[0]?.trim() }), onSuccess: async (p) => { await onPick(p.id); setName(""); setPoint(null); setLat(""); setLng(""); onClose(); } });
  const setFromInputs = (a: string, b: string) => { setLng(a); setLat(b); if (a !== "" && b !== "" && Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a)) <= 180 && Math.abs(Number(b)) <= 90) setPoint({ lng: Number(a), lat: Number(b) }); else setPoint(null); };
  const pick = async (id: string) => { setPickError(""); setLoadingId(id); try { await onPick(id); onClose(); } catch (e) { setPickError(errorMessage(e)); } finally { setLoadingId(null); } };
  const rows = tab === "near" ? search.data : saved.data?.filter((p) => !q.trim() || p.name.toLowerCase().includes(q.toLowerCase()));
  const pending = tab === "near" ? search.isPending : saved.isPending;
  return <Dialog open={open} onClose={onClose} variant="sheet" title="Añadir una parada" className="add-stop-editor">
    <div className="grid gap-3">
      <button type="button" className="stop-section-head" aria-expanded={section === "pick"} aria-controls="stop-section-pick" onClick={() => setSection("pick")}><Search size={18} aria-hidden="true" /> Buscar y elegir un lugar <ChevronDown className="stop-section-chevron" size={18} aria-hidden="true" /></button>
      {section === "pick" ? <div id="stop-section-pick" className="grid gap-4">
      <form className="flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); }}><Input aria-label="Buscar un lugar para añadir" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca un lugar" type="search" /><Button type="submit" variant="outline" size="sm">Buscar</Button></form>
      <p className="text-xs text-muted-foreground">Ej. museo, malecón, mercado, naturaleza…</p>
      <Tabs label="Lugares sugeridos" value={tab} onChange={setTab} tabs={[{ id: "near", label: <span className="inline-flex items-center gap-2"><MapPin size={17} />Cercanos</span> }, { id: "saved", label: <span className="inline-flex items-center gap-2"><Bookmark size={17} />Guardados</span> }]} />
      {pending ? <p role="status" className="text-sm text-muted-foreground">Cargando lugares…</p> : null}
      {search.isError && tab === "near" || saved.isError && tab === "saved" ? <Alert tone="danger">{errorMessage(tab === "near" ? search.error : saved.error)}</Alert> : null}
      {rows?.length === 0 ? <p className="text-sm text-muted-foreground">{tab === "saved" ? "Aún no guardaste lugares. Usa el marcador de un lugar para tenerlo aquí." : "No hay resultados. Prueba otra búsqueda o crea un lugar personal."}</p> : null}
      <ul className="suggested-stop-list">{rows?.map((p) => { const visual = catalog.data?.places.find((v) => v.id === p.id); const marked = saved.data?.some((v) => v.id === p.id); return <li key={p.id}>
        {visual ? <img src={visual.imageUrl} alt="" width={120} height={125} /> : <div className="place-thumb-placeholder"><MapPin aria-hidden="true" /></div>}
        <div><h3>{p.name}</h3><small>{visual?.category ?? "Lugar personal"}{p.distanceM !== null ? ` · ${Math.round(p.distanceM)} m` : ""}</small><p>{visual?.description ?? p.description ?? p.locality}</p><PhotoCredit credit={visual?.imageCredit} compact /></div>
        <div className="suggested-stop-actions"><Button size="icon" variant="primary" title={`Añadir ${p.name}`} aria-label={`Añadir ${p.name}`} loading={loadingId === p.id} disabled={busy || Boolean(loadingId)} onClick={() => void pick(p.id)}><Plus size={19} aria-hidden="true" /></Button><Button size="icon" variant="ghost" aria-pressed={Boolean(marked)} title={marked ? "Quitar de guardados" : "Guardar lugar"} aria-label={`${marked ? 'Quitar de guardados' : 'Guardar'} ${p.name}`} disabled={bookmark.isPending} onClick={() => bookmark.mutate(p)}><Bookmark size={17} fill={marked ? "currentColor" : "none"} aria-hidden="true" /></Button></div>
      </li>; })}</ul>
      {pickError || bookmark.isError ? <Alert tone="danger" live="assertive">{pickError || errorMessage(bookmark.error)}</Alert> : null}
      </div> : null}
      <button type="button" className="stop-section-head" aria-expanded={section === "create"} aria-controls="stop-section-create" onClick={() => setSection("create")}><MapPinPlus size={18} aria-hidden="true" /> Crear lugar nuevo <ChevronDown className="stop-section-chevron" size={18} aria-hidden="true" /></button>
      {section === "create" ? <div id="stop-section-create" className="grid gap-3">
        <Field label="Nombre del lugar" required>{(c) => <Input {...c} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Ej. Mi rincón junto al río" />}</Field>
        {caps.data?.geocoder.available ? <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setGeo((e.currentTarget.elements.namedItem('address') as HTMLInputElement).value); }}><Input name="address" aria-label="Buscar dirección" /><Button type="submit" variant="outline">Buscar</Button></form> : null}
        {geocode.data?.results.map((r) => <button key={r.label} type="button" className="text-left underline" onClick={() => { setPoint({ lng: r.lng, lat: r.lat }); setLng(String(r.lng)); setLat(String(r.lat)); }}>{r.label}</button>)}
        <p className="text-sm">Elegir ubicación en el mapa</p>
        <MapPanel className="h-52" ariaLabel="Mapa para crear una parada" markers={point ? [{ id: "nuevo", ...point, state: "current", label: name || "Lugar nuevo" }] : near ? [{ id: "cerca", ...near, label: "Referencia del recorrido" }] : []} fitKey={point ? `${point.lng}:${point.lat}` : "near"} onMapClick={(p) => { setPoint(p); setLng(p.lng.toFixed(6)); setLat(p.lat.toFixed(6)); }} clickHint="Toca para marcar" />
        <div className="grid grid-cols-2 gap-3"><Field label="Longitud">{(c) => <Input {...c} inputMode="decimal" value={lng} onChange={(e) => setFromInputs(e.target.value, lat)} />}</Field><Field label="Latitud">{(c) => <Input {...c} inputMode="decimal" value={lat} onChange={(e) => setFromInputs(lng, e.target.value)} />}</Field></div>
        <p className="text-xs text-muted-foreground">Este lugar será personal y privado.</p>
        {create.isError ? <Alert tone="danger" live="assertive">{errorMessage(create.error)}</Alert> : null}
        <Button disabled={!name.trim() || !point} loading={create.isPending || busy} onClick={() => create.mutate()}>Crear lugar y añadir <Plus size={18} aria-hidden="true" /></Button>
      </div> : null}
    </div>
  </Dialog>;
}
