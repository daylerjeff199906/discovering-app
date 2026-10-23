import { Alert, Button, Field, Input, cn } from "@por-aqui/ui";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, FileUp } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { api, errorMessage } from "../lib/api";
import { DestinationPicker } from "../components/destination-picker";
import { useTravelCatalog } from "../lib/catalog";
import { browserTimezone } from "../lib/format";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/app.viajes.nuevo";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Nuevo viaje — Por aquí", noindex: true });
}

type Mode = "auto" | "manual" | "libre";
const OPTIONS: { id: Mode; title: string; body: string; image: string }[] = [
  { id: "auto", title: "Armar automáticamente", body: "Cuéntanos qué te gusta y te propondremos una ruta por Iquitos. Podrás hacerla tuya antes de salir.", image: "explore-freely-iquitos.webp" },
  { id: "manual", title: "Armar manualmente", body: "Elige los lugares que quieres visitar y organiza cada parada. Tú decides por dónde empieza tu historia.", image: "follow-route-iquitos.webp" },
  { id: "libre", title: "Registrar mientras exploro", body: "Sal sin un itinerario y guarda tus visitas, fotos y recuerdos sobre la marcha.", image: "explore-freely-iquitos.webp" },
];

export default function NuevoViaje() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initial = (["auto", "manual", "libre"] as const).find((m) => m === params.get("modo")) ?? "auto";
  const [mode, setMode] = useState<Mode>(initial);
  const [destination, setDestination] = useState(params.get("destino") ?? "Iquitos");
  const [pickerOpen, setPickerOpen] = useState(false);
  const catalog = useTravelCatalog();
  const selectedCity = catalog.data?.cities.find((c) => c.name === destination) ?? catalog.data?.cities[0];
  const [title, setTitle] = useState(params.get("titulo") ?? "");
  const create = useMutation({
    mutationFn: () => api.journeys.create({
      title: title.trim() || (selectedCity ? `Viaje a ${selectedCity.name}` : "Mi aventura"),
      creationMode: mode === "auto" ? "AUTOMATIC" : mode === "manual" ? "MANUAL" : "FREE",
      timezone: browserTimezone(),
      preferences: { interests: [], pace: "MODERATE", transport: "WALK", ...(selectedCity ? { destinationLabel: selectedCity.name } : {}) },
    }),
    onSuccess: (j) => navigate(mode === "libre" ? `/app/viajes/${j.id}/recorrido` : `/app/viajes/${j.id}/editar${mode === "auto" ? "?auto=1" : ""}`),
  });

  return <section className="start-adventure new-journey-page new-journey-centered">
    <Link to="/app/inicio" className="adventure-back"><ArrowLeft size={18} aria-hidden="true" /> Volver a mi inicio</Link>
    <p className="eyebrow mb-2">Iquitos, a tu manera</p>
    <h1>Crea tu próxima aventura</h1>
    <p className="adventure-intro">Un nuevo camino te espera. ¿Cómo quieres empezar?</p>
    <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
      <fieldset disabled={create.isPending}>
        <legend className="sr-only">Cómo empezar tu viaje</legend>
        <div className="adventure-options new-journey-options">
          {(catalog.data?.modes ?? OPTIONS).map((option) => <label key={option.id} className={cn("adventure-option", mode === option.id && "selected")}>
            <input type="radio" name="modo" value={option.id} checked={mode === option.id} onChange={() => setMode(option.id)} />
            <img src={option.image.startsWith("/") || option.image.startsWith("https://") ? option.image : `/images/${option.image}`} alt="" width={1400} height={467} />
            <span className="adventure-option-copy"><strong>{option.title}</strong><span>{option.body}</span></span>
          </label>)}
        </div>
      </fieldset>
      <div className="new-journey-details">
        <Field label="Nombre de tu viaje" hint="Opcional. También puedes cambiarlo después.">
          {(c) => <Input {...c} value={title} maxLength={120} disabled={create.isPending} onChange={(e) => setTitle(e.target.value)} placeholder="Un día para descubrir Iquitos" />}
        </Field>
        <Field label="Ciudad" hint="Elige una ciudad del catálogo.">
          {(c) => <button {...c} type="button" className="city-field-button" disabled={create.isPending} onClick={() => setPickerOpen(true)}>{selectedCity?.name ?? "Elegir ciudad"}<ArrowRight size={17} aria-hidden="true" /></button>}
        </Field>
      </div>
      {mode === "libre" ? <p className="adventure-note">En el siguiente paso podrás elegir si quieres registrar tu trayecto con GPS. También puedes añadir visitas manualmente.</p> : null}
      {create.isError ? <Alert tone="danger" live="assertive" className="mb-4">{errorMessage(create.error)}</Alert> : null}
      <Button type="submit" className="w-full" disabled={!selectedCity} loading={create.isPending}>{mode === "libre" ? "Continuar mi aventura" : "Crear viaje"}<ArrowRight size={18} aria-hidden="true" /></Button>
    </form>
    <p className="adventure-note import-link"><FileUp size={18} aria-hidden="true" /><span>¿Ya hiciste el recorrido? <Link to="/app/viajes/importar" className="underline">Importar un recorrido</Link> desde un archivo GPX, KML o de Google Takeout.</span></p>
    <DestinationPicker open={pickerOpen} onClose={() => setPickerOpen(false)} selected={selectedCity?.id} onSelect={(c) => setDestination(c.name)} />
  </section>;
}
