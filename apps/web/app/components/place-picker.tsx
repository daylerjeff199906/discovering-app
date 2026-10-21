import type { CreateVisitInput, JourneyDto } from "@por-aqui/contracts";
import { Field, Input, Tabs } from "@por-aqui/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "../lib/api";
import { flattenStops } from "../lib/trail";
import { MapPanel } from "./map";

export type PlaceChoice = Pick<CreateVisitInput, "placeId" | "newPlace" | "stopId">;

/** Elegir el lugar de una visita: una parada del plan, un lugar del catálogo, o un punto nuevo en el mapa. */
export function PlacePicker({ journey, value, onChange }: { journey: JourneyDto; value: PlaceChoice | null; onChange: (v: PlaceChoice | null, label: string) => void }) {
  const stops = flattenStops(journey);
  const [tab, setTab] = useState(stops.length ? "plan" : "search");
  const [q, setQ] = useState("");
  const [submitted, setSubmitted] = useState("");
  const [name, setName] = useState("");
  const [pt, setPt] = useState<{ lng: number; lat: number } | null>(null);
  const [picked, setPicked] = useState<string>("");

  const search = useQuery({ queryKey: ["place-search-visit", submitted], queryFn: ({ signal }) => api.places.search({ q: submitted || undefined, scope: "all", limit: 15, locality: !submitted ? journey.preferences.destinationLabel?.split(",")[0]?.trim() : undefined }, { signal }), enabled: tab === "search" });

  return (
    <div className="flex flex-col gap-3">
      <Tabs label="Elegir lugar" value={tab} onChange={setTab} tabs={[...(stops.length ? [{ id: "plan", label: "Del plan" }] : []), { id: "search", label: "Buscar" }, { id: "new", label: "Lugar nuevo" }]} />
      {tab === "plan" ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {stops.map((s) => (
            <li key={s.id}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-control border border-border bg-surface px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-sage/40 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-focus">
                <input type="radio" name="lugar" className="size-5 accent-[var(--primary)]" checked={value?.stopId === s.id} onChange={() => { setPicked(s.place.name); onChange({ placeId: s.placeId, stopId: s.id }, s.place.name); }} />
                <span><span className="font-semibold">{s.index}. {s.place.name}</span></span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
      {tab === "search" ? (
        <div className="flex flex-col gap-3">
          <form role="search" onSubmit={(e) => { e.preventDefault(); setSubmitted(q.trim()); }}>
            <Input aria-label="Buscar lugar" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Busca por nombre y pulsa Enter" />
          </form>
          {search.isPending ? <p role="status" className="text-sm text-muted-foreground">Buscando…</p> : null}
          {search.data?.length === 0 ? <p className="text-sm text-muted-foreground">Sin resultados. Prueba «Lugar nuevo».</p> : null}
          <ul className="m-0 flex max-h-64 list-none flex-col gap-2 overflow-y-auto p-0">
            {search.data?.map((p) => (
              <li key={p.id}>
                <label className="flex min-h-12 cursor-pointer items-center gap-3 rounded-control border border-border bg-surface px-3 py-2 has-[:checked]:border-primary has-[:checked]:bg-sage/40 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-focus">
                  <input type="radio" name="lugar" className="size-5 accent-[var(--primary)]" checked={value?.placeId === p.id && !value.stopId} onChange={() => { setPicked(p.name); onChange({ placeId: p.id }, p.name); }} />
                  <span><span className="font-semibold">{p.name}</span><span className="block text-sm text-muted-foreground">{[p.locality, p.countryCode].filter(Boolean).join(", ")}{p.scope === "PERSONAL" ? " · personal" : ""}</span></span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {tab === "new" ? (
        <div className="flex flex-col gap-3">
          <Field label="Nombre del lugar" required>{(c) => <Input {...c} value={name} maxLength={120} onChange={(e) => { setName(e.target.value); onChange(pt && e.target.value.trim() ? { newPlace: { name: e.target.value.trim(), lng: pt.lng, lat: pt.lat } } : null, e.target.value); }} placeholder="Un mirador, una casa de té…" />}</Field>
          <p className="text-sm font-semibold">Toca el mapa donde estuviste</p>
          <MapPanel className="h-64" ariaLabel="Mapa para marcar el lugar visitado" markers={pt ? [{ id: "p", lng: pt.lng, lat: pt.lat, state: "current", label: "Lugar nuevo" }] : []} fitKey={pt ? "p" : "n"} onMapClick={(p) => { setPt(p); onChange(name.trim() ? { newPlace: { name: name.trim(), lng: p.lng, lat: p.lat } } : null, name); }} clickHint="Toca para marcar" />
          <p className="text-xs text-muted-foreground">Se guarda como lugar personal: es privado y solo tú lo ves.</p>
        </div>
      ) : null}
      {value ? <p role="status" className="text-sm font-semibold text-success">Lugar elegido: {picked || name}</p> : <p className="text-sm text-muted-foreground">Elige un lugar para continuar.</p>}
    </div>
  );
}
