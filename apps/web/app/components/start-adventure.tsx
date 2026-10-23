import { Alert, Button, cn } from "@por-aqui/ui";
import { ArrowLeft, ArrowRight, MapPin, Pencil } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { errorMessage } from "../lib/api";

export type AdventureMode = "FOLLOW_ROUTE" | "FREE";

export function StartAdventure({ journeyId, hasStops, defaultFree, pending, error, onStart }: {
  journeyId: string; hasStops: boolean; defaultFree: boolean; pending: boolean; error: unknown;
  onStart: (choice: { mode: AdventureMode; gps: boolean }) => void;
}) {
  const [mode, setMode] = useState<AdventureMode>(defaultFree || !hasStops ? "FREE" : "FOLLOW_ROUTE");
  const [gps, setGps] = useState(false);
  return <section className="start-adventure">
    <Link to={`/app/viajes/${journeyId}/editar`} className="adventure-back"><ArrowLeft size={18} aria-hidden="true" /> Volver a mi aventura</Link>
    <p className="eyebrow mb-2">Iquitos, a tu manera</p>
    <h1>Comenzar aventura</h1>
    <p className="adventure-intro">Tu ruta está lista. ¿Cómo quieres explorar?</p>
    <fieldset disabled={pending}>
      <legend className="sr-only">Tipo de recorrido</legend>
      <div className="adventure-options">
        {([
          { value: "FOLLOW_ROUTE", title: "Seguir mi ruta", image: "follow-route-iquitos.webp", body: "Te guiaremos por las paradas que has seleccionado, pero con la libertad de hacer cambios sobre la marcha." },
          { value: "FREE", title: "Explorar libremente", image: "explore-freely-iquitos.webp", body: "Descubre lugares a tu ritmo. Podrás ir añadiendo visitas durante el recorrido." },
        ] as const).map((option) => <label key={option.value} className={cn("adventure-option", mode === option.value && "selected", option.value === "FOLLOW_ROUTE" && !hasStops && "unavailable")}>
          <input type="radio" name="adventure-mode" value={option.value} checked={mode === option.value} disabled={option.value === "FOLLOW_ROUTE" && !hasStops} onChange={() => setMode(option.value)} />
          <img src={`/images/${option.image}`} alt="" width={2172} height={724} />
          <span className="adventure-option-copy"><strong>{option.title}</strong><span>{option.body}</span>{option.value === "FOLLOW_ROUTE" && !hasStops ? <small>Añade paradas al plan para seguir una ruta.</small> : null}</span>
        </label>)}
      </div>
    </fieldset>
    <label className="adventure-gps"><MapPin size={22} aria-hidden="true" /><span><strong>Registrar trayecto con GPS</strong><small>Actívalo para dibujar por dónde pasas en el mapa.</small></span><input type="checkbox" role="switch" checked={gps} onChange={(e) => setGps(e.target.checked)} disabled={pending} /></label>
    <p className="adventure-note"><Pencil size={19} aria-hidden="true" />También puedes añadir visitas manualmente en cualquier momento.</p>
    {error ? <Alert tone="danger" live="assertive" className="mb-4">{errorMessage(error)}</Alert> : null}
    <Button className="w-full" loading={pending} onClick={() => onStart({ mode, gps })}>Iniciar recorrido <ArrowRight size={18} aria-hidden="true" /></Button>
  </section>;
}
