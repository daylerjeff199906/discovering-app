import type { PlaceDto } from "@por-aqui/contracts";
import { Alert, Button, Dialog, EmptyState, Field, Input, Tabs } from "@por-aqui/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import { MapPin, Plus } from "lucide-react";
import { useState } from "react";
import { api, errorMessage } from "../lib/api";
import { capabilitiesQuery } from "../lib/query";
import { MapPanel } from "./map";

/**
 * Añadir una parada: buscar en el catálogo/lugares propios, o crear un lugar personal (privado)
 * eligiendo un punto en el mapa. En móvil se muestra como hoja inferior.
 */
export function AddStopDialog({ open, onClose, near, destinationLabel, onPick, busy }: { open: boolean; onClose: () => void; near?: { lng: number; lat: number } | null; destinationLabel?: string; onPick: (placeId: string) => Promise<unknown>; busy?: boolean }) {
  const [tab, setTab] = useState("search");
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const caps = useQuery(capabilitiesQuery());

  const search = useQuery({
    queryKey: ["place-search", submitted, destinationLabel, near],
    queryFn: ({ signal }) => api.places.search({ q: submitted || undefined, locality: !submitted ? destinationLabel?.split(",")[0]?.trim() : undefined, scope: "all", limit: 20 }, { signal }),
    enabled: open && tab === "search",
  });

  const [name, setName] = useState("");
  const [point, setPoint] = useState<{ lng: number; lat: number } | null>(null);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const create = useMutation({
    mutationFn: () => api.places.create({ name: name.trim(), lng: point!.lng, lat: point!.lat }),
    onSuccess: async (p) => {
      await onPick(p.id);
      setName("");
      setPoint(null);
      setLat("");
      setLng("");
      onClose();
    },
  });
  const setFromInputs = (nlng: string, nlat: string) => {
    setLng(nlng);
    setLat(nlat);
    const a = Number(nlng);
    const b = Number(nlat);
    if (nlng !== "" && nlat !== "" && Math.abs(a) <= 180 && Math.abs(b) <= 90) setPoint({ lng: a, lat: b });
  };

  const [geo, setGeo] = useState("");
  const geocode = useQuery({ queryKey: ["geocode", geo], queryFn: ({ signal }) => api.places.geocode(geo, { signal }), enabled: Boolean(geo) && Boolean(caps.data?.geocoder.available) });

  return (
    <Dialog open={open} onClose={onClose} variant="sheet" title="Añadir una parada" description="Busca un lugar del catálogo o crea uno personal (privado por defecto).">
      <div className="flex flex-col gap-4">
        <Tabs label="Cómo añadir" value={tab} onChange={setTab} tabs={[{ id: "search", label: "Buscar lugar" }, { id: "personal", label: "Lugar personal" }]} />
        {tab === "search" ? (
          <div className="flex flex-col gap-3">
            <form className="flex gap-2" role="search" onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); }}>
              <Input aria-label="Buscar lugar" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Plaza, museo, mercado…" type="search" />
              <Button type="submit" variant="secondary">Buscar</Button>
            </form>
            {search.isPending ? <p role="status" className="text-sm text-muted-foreground">Buscando…</p> : null}
            {search.isError ? <Alert tone="danger" live="assertive">{errorMessage(search.error)}</Alert> : null}
            {search.data && search.data.length === 0 ? (
              <EmptyState title="No encontramos lugares">Prueba con otra palabra o crea un lugar personal en la otra pestaña.</EmptyState>
            ) : (
              <ul className="m-0 flex max-h-80 list-none flex-col gap-2 overflow-y-auto p-0">
                {search.data?.map((p) => (
                  <PlaceRow key={p.id} place={p} busy={busy} onPick={async () => { await onPick(p.id); onClose(); }} />
                ))}
              </ul>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Nombre del lugar" required>{(c) => <Input {...c} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="Mi mirador favorito" />}</Field>
            {caps.data?.geocoder.available ? (
              <Field label="Buscar dirección (opcional)">
                {(c) => (
                  <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); setGeo((e.currentTarget.elements.namedItem("g") as HTMLInputElement).value); }}>
                    <Input {...c} name="g" />
                    <Button type="submit" variant="secondary">Buscar</Button>
                  </form>
                )}
              </Field>
            ) : null}
            {geocode.data?.results.length ? (
              <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
                {geocode.data.results.map((r) => <li key={r.label}><button type="button" className="text-left underline" onClick={() => { setPoint({ lng: r.lng, lat: r.lat }); setLng(String(r.lng)); setLat(String(r.lat)); }}>{r.label}</button></li>)}
              </ul>
            ) : null}
            <p className="text-sm font-semibold">Toca el mapa para elegir el punto</p>
            <MapPanel
              className="h-64"
              ariaLabel="Mapa para elegir la ubicación del lugar"
              markers={point ? [{ id: "nuevo", lng: point.lng, lat: point.lat, state: "current", label: "Lugar nuevo" }] : near ? [] : []}
              onMapClick={(p) => { setPoint(p); setLng(p.lng.toFixed(6)); setLat(p.lat.toFixed(6)); }}
              fitKey={point ? "p" : "n"}
              clickHint="Toca para marcar"
            />
            <div className="grid grid-cols-2 gap-3">
              <Field label="Longitud">{(c) => <Input {...c} inputMode="decimal" value={lng} onChange={(e) => setFromInputs(e.target.value, lat)} />}</Field>
              <Field label="Latitud">{(c) => <Input {...c} inputMode="decimal" value={lat} onChange={(e) => setFromInputs(lng, e.target.value)} />}</Field>
            </div>
            {create.isError ? <Alert tone="danger" live="assertive">{errorMessage(create.error)}</Alert> : null}
            <Button disabled={!name.trim() || !point} loading={create.isPending || busy} onClick={() => create.mutate()}>
              <MapPin className="size-5" aria-hidden="true" /> Crear lugar y añadir
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

function PlaceRow({ place, onPick, busy }: { place: PlaceDto; onPick: () => Promise<void>; busy?: boolean }) {
  const [loading, setLoading] = useState(false);
  return (
    <li className="flex items-center justify-between gap-3 rounded-control border border-border bg-surface p-3">
      <div className="min-w-0">
        <p className="truncate font-semibold">{place.name}</p>
        <p className="truncate text-sm text-muted-foreground">
          {[place.locality, place.countryCode].filter(Boolean).join(", ") || "Sin ubicación descrita"}
          {place.scope === "PERSONAL" ? " · personal" : ""}
        </p>
      </div>
      <Button size="sm" variant="secondary" loading={loading || busy} onClick={async () => { setLoading(true); try { await onPick(); } finally { setLoading(false); } }} aria-label={`Añadir ${place.name}`}>
        <Plus className="size-4" aria-hidden="true" /> Añadir
      </Button>
    </li>
  );
}
