import type { TravelCatalog } from "@por-aqui/contracts";
import { Alert, Button, Field, Input, Textarea, Select } from "@por-aqui/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { LoadingBlock, PageHeader, QueryError } from "../components/shell";
import { ApiError, api, errorMessage } from "../lib/api";
import { useMe } from "../lib/auth";
import { catalogKey } from "../lib/catalog";
import { interestsQuery } from "../lib/query";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/app.catalogo";

export function meta(_: Route.MetaArgs) { return seoMeta({ title: "Administrar catálogo — Por aquí", noindex: true }); }
export default function Catalogo() {
  const { me } = useMe();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-catalog"], queryFn: ({ signal }) => api.catalog.admin({ signal }), enabled: me?.role === "MODERATOR" });
  const tags = useQuery(interestsQuery());
  const [data, setData] = useState<TravelCatalog | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data) setData(q.data); }, [q.data]);
  const save = useMutation({ mutationFn: () => api.catalog.save(data!), onSuccess: (v) => {
    setData(v); qc.setQueryData(["admin-catalog"], v); setSaved(true);
    void qc.invalidateQueries({ queryKey: catalogKey });
    for (const key of ["place-search", "place-search-visit", "destinations", "saved-places"]) void qc.invalidateQueries({ queryKey: [key] });
  } });
  const change = (fn: (c: TravelCatalog) => TravelCatalog) => { setSaved(false); setData((c) => c && fn(c)); };
  if (me?.role !== "MODERATOR") return <Alert tone="danger" title="Sin acceso">La administración del catálogo está disponible para moderadores.</Alert>;
  if (q.isPending || (!data && !q.isError)) return <LoadingBlock />;
  if (q.isError || !data) return <QueryError error={q.error} retry={() => q.refetch()} />;
  return <div className="catalog-admin">
    <PageHeader title="Catálogo y presentación" subtitle="Administra el banner, las ciudades y los lugares que aparecen en la aplicación." />
    <form onSubmit={(e) => { e.preventDefault(); save.mutate(); }} className="grid gap-6">
      <fieldset disabled={save.isPending} className="grid gap-6">
        <section className="catalog-editor-section"><h2>Tarjetas de creación de aventura</h2>{data.modes.map((mode, i) => <div className="catalog-editor-fields" key={mode.id}><h3>{mode.id === "auto" ? "Automático" : mode.id === "manual" ? "Manual" : "Libre"}</h3>{([['title','Título'],['body','Descripción'],['image','URL de la ilustración']] as const).map(([key,label]) => <Field key={key} label={label}>{(c) => <Input {...c} required value={mode[key]} onChange={(e) => change((d) => ({ ...d, modes: d.modes.map((v,n) => n === i ? { ...v, [key]: e.target.value } : v) }))} />}</Field>)}</div>)}</section>
        <section className="catalog-editor-section"><h2>Banner del inicio</h2>
          {([['title', 'Título'], ['subtitle', 'Descripción'], ['planLabel', 'Acción: planear'], ['recordLabel', 'Acción: registrar']] as const).map(([key, label]) => <Field key={key} label={label}>{(c) => <Input {...c} required value={data.banner[key]} onChange={(e) => change((d) => ({ ...d, banner: { ...d.banner, [key]: e.target.value } }))} />}</Field>)}
        </section>
        <section className="catalog-editor-section"><div className="flex flex-wrap justify-between gap-3"><h2>Ciudades</h2><Button variant="outline" onClick={() => change((d) => ({ ...d, cities: [...d.cities, { id: `ciudad-${crypto.randomUUID().slice(0, 8)}`, name: "Nueva ciudad", region: "", country: "Perú", countryCode: "PE", description: "", imageUrl: "/images/iquitos-malecon.jpg", lat: 0, lng: 0, enabled: false, highlights: [] }] }))}><Plus size={17} /> Añadir ciudad</Button></div>
          {data.cities.map((city, i) => <details key={city.id} className="catalog-editor-item"><summary>{city.name} {city.enabled ? "· Activa" : "· Oculta"}</summary><div className="catalog-editor-fields">
            {([['name','Ciudad'], ['region','Región'], ['country','País'], ['countryCode','Código del país (PE)'], ['imageUrl','URL de la imagen de fondo']] as const).map(([key,label]) => <Field key={key} label={label}>{(c) => <Input {...c} required={key === 'name' || key === 'imageUrl'} value={city[key]} onChange={(e) => change((d) => ({ ...d, cities: d.cities.map((v,n) => n === i ? { ...v, [key]: e.target.value } : v) }))} />}</Field>)}
            <Field label="Descripción">{(c) => <Textarea {...c} value={city.description} onChange={(e) => change((d) => ({ ...d, cities: d.cities.map((v,n) => n === i ? { ...v, description: e.target.value } : v) }))} />}</Field>
            <Field label="Características (una por línea)">{(c) => <Textarea {...c} value={city.highlights.join('\n')} onChange={(e) => change((d) => ({ ...d, cities: d.cities.map((v,n) => n === i ? { ...v, highlights: e.target.value.split('\n') } : v) }))} />}</Field>
            {(['lat','lng'] as const).map((key) => <Field key={key} label={key === 'lat' ? 'Latitud' : 'Longitud'}>{(c) => <Input {...c} type="number" step="any" required min={key === 'lat' ? -90 : -180} max={key === 'lat' ? 90 : 180} value={city[key]} onChange={(e) => change((d) => ({ ...d, cities: d.cities.map((v,n) => n === i ? { ...v, [key]: Number(e.target.value) } : v) }))} />}</Field>)}
            <label><input type="checkbox" checked={city.enabled} onChange={(e) => change((d) => ({ ...d, cities: d.cities.map((v,n) => n === i ? { ...v, enabled: e.target.checked } : v) }))} /> Disponible en el buscador</label>
          </div></details>)}
        </section>
        <section className="catalog-editor-section"><div className="flex flex-wrap justify-between gap-3"><h2>Lugares</h2><Button variant="outline" onClick={() => change((d) => ({ ...d, places: [...d.places, { id: crypto.randomUUID(), cityId: d.cities[0]!.id, name: "Nuevo lugar", description: "", category: "Lugar de interés", imageUrl: d.cities[0]!.imageUrl, lat: d.cities[0]!.lat, lng: d.cities[0]!.lng, enabled: false, interests: [] }] }))}><Plus size={17} /> Añadir lugar</Button></div>
          <p className="text-sm text-muted-foreground">Desactiva un lugar para retirarlo de las búsquedas. Los recuerdos que ya lo usaron se conservan.</p>
          {data.places.map((place, i) => <details key={place.id} className="catalog-editor-item"><summary>{place.name} {place.enabled ? "· Activo" : "· Oculto"}</summary><div className="catalog-editor-fields">
            <Field label="Ciudad">{(c) => <Select {...c} value={place.cityId} onChange={(e) => change((d) => ({ ...d, places: d.places.map((v,n) => n === i ? { ...v, cityId: e.target.value } : v) }))}>{data.cities.map((city) => <option key={city.id} value={city.id}>{city.name}</option>)}</Select>}</Field>
            {([['name','Nombre'], ['category','Tipo de lugar'], ['imageUrl','URL de la imagen']] as const).map(([key,label]) => <Field key={key} label={label}>{(c) => <Input {...c} required value={place[key]} onChange={(e) => change((d) => ({ ...d, places: d.places.map((v,n) => n === i ? { ...v, [key]: e.target.value, ...(key === 'imageUrl' ? { imageCredit: undefined } : {}) } : v) }))} />}</Field>)}
            <Field label="Descripción">{(c) => <Textarea {...c} value={place.description} onChange={(e) => change((d) => ({ ...d, places: d.places.map((v,n) => n === i ? { ...v, description: e.target.value } : v) }))} />}</Field>
            {(['lat','lng'] as const).map((key) => <Field key={key} label={key === 'lat' ? 'Latitud' : 'Longitud'}>{(c) => <Input {...c} type="number" step="any" required min={key === 'lat' ? -90 : -180} max={key === 'lat' ? 90 : 180} value={place[key]} onChange={(e) => change((d) => ({ ...d, places: d.places.map((v,n) => n === i ? { ...v, [key]: Number(e.target.value) } : v) }))} />}</Field>)}
            <fieldset className="flex flex-wrap gap-3"><legend>Intereses de la propuesta automática</legend>{tags.data?.map((tag) => <label key={tag.slug}><input type="checkbox" checked={place.interests.includes(tag.slug)} onChange={(e) => change((d) => ({ ...d, places: d.places.map((v,n) => n === i ? { ...v, interests: e.target.checked ? [...v.interests,tag.slug] : v.interests.filter((s) => s !== tag.slug) } : v) }))} /> {tag.label}</label>)}</fieldset>
            <label><input type="checkbox" checked={place.enabled} onChange={(e) => change((d) => ({ ...d, places: d.places.map((v,n) => n === i ? { ...v, enabled: e.target.checked } : v) }))} /> Disponible en el catálogo</label>
          </div></details>)}
        </section>
      </fieldset>
      {save.isError ? <Alert tone="danger" live="assertive">{errorMessage(save.error)}{save.error instanceof ApiError && save.error.fieldErrors ? <ul>{Object.entries(save.error.fieldErrors).map(([field, errors]) => <li key={field}>{field}: {errors.join(" ")}</li>)}</ul> : null}<Button variant="ghost" onClick={() => q.refetch()}>Recargar catálogo (descarta cambios)</Button></Alert> : null}
      {saved ? <p role="status" className="text-success">Catálogo guardado.</p> : null}
      <Button type="submit" loading={save.isPending}><Save size={18} /> Guardar cambios</Button>
    </form>
  </div>;
}
