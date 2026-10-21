import { Alert, Button, Field, Input, cn } from "@por-aqui/ui";
import { useMutation } from "@tanstack/react-query";
import { Compass, MapPinned, Wand2 } from "lucide-react";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { PageHeader } from "../components/shell";
import { api, errorMessage } from "../lib/api";
import { browserTimezone } from "../lib/format";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/app.viajes.nuevo";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Nuevo viaje — Por aquí", noindex: true });
}

type Mode = "auto" | "manual" | "libre";
const OPTIONS: { id: Mode; title: string; body: string; Icon: typeof Wand2 }[] = [
  { id: "auto", title: "Armar automáticamente", body: "Elige destino, tiempo e intereses y revisa una propuesta explicable. Sin IA, sin sorpresas.", Icon: Wand2 },
  { id: "manual", title: "Armar manualmente", body: "Añade días y paradas tú mismo, busca lugares o marca puntos propios en el mapa.", Icon: MapPinned },
  { id: "libre", title: "Registrar mientras exploro", body: "Empieza sin itinerario: registra lugares, fotos y notas conforme avanzas.", Icon: Compass },
];

export default function NuevoViaje() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initial = (["auto", "manual", "libre"] as const).find((m) => m === params.get("modo")) ?? "auto";
  const [mode, setMode] = useState<Mode>(initial);
  const [destination, setDestination] = useState(params.get("destino") ?? "");
  const [title, setTitle] = useState("");

  const create = useMutation({
    mutationFn: async () => {
      const t = title.trim() || (destination.trim() ? `Viaje a ${destination.trim()}` : mode === "libre" ? "Mi aventura" : "Mi viaje");
      const j = await api.journeys.create({
        title: t,
        creationMode: mode === "auto" ? "AUTOMATIC" : mode === "manual" ? "MANUAL" : "FREE",
        timezone: browserTimezone(),
        preferences: { interests: [], pace: "MODERATE", transport: "WALK", ...(destination.trim() ? { destinationLabel: destination.trim() } : {}) },
      });
      if (mode === "libre") await api.recording.start(j.id);
      return j;
    },
    onSuccess: (j) => navigate(mode === "libre" ? `/app/viajes/${j.id}/recorrido` : `/app/viajes/${j.id}/editar${mode === "auto" ? "?auto=1" : ""}`),
  });

  return (
    <>
      <PageHeader title="Nuevo viaje" subtitle="Elige cómo quieres empezar. Siempre podrás cambiarlo después." />
      <fieldset className="mb-8">
        <legend className="sr-only">Cómo empezar</legend>
        <div className="grid gap-4 md:grid-cols-3">
          {OPTIONS.map(({ id, title: t, body, Icon }) => (
            <label key={id} className={cn("flex min-h-36 cursor-pointer flex-col gap-2 rounded-card border-2 bg-surface p-5 transition-colors focus-within:ring-[3px] focus-within:ring-focus", mode === id ? "border-primary bg-sage/40" : "border-border hover:border-control-border")}>
              <input type="radio" name="modo" value={id} checked={mode === id} onChange={() => setMode(id)} className="sr-only" />
              <Icon className="size-7 text-primary" aria-hidden="true" />
              <span className="font-serif text-xl font-semibold">{t}</span>
              <span className="text-sm text-muted-foreground">{body}</span>
            </label>
          ))}
        </div>
      </fieldset>

      <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="flex max-w-xl flex-col gap-4">
        {mode !== "libre" ? <Field label="Destino" hint="Ciudad o región. Puedes dejarlo vacío y completarlo luego.">{(c) => <Input {...c} value={destination} maxLength={120} onChange={(e) => setDestination(e.target.value)} placeholder="Iquitos, Cusco, Lisboa…" />}</Field> : null}
        <Field label="Título (opcional)">{(c) => <Input {...c} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} placeholder={mode === "libre" ? "Mi aventura" : "Mi viaje"} />}</Field>
        {mode === "libre" ? <Alert tone="sage">Al continuar empieza tu recorrido. El GPS es opcional y solo se pide cuando activas «Registrar trayecto».</Alert> : null}
        {create.isError ? <Alert tone="danger" live="assertive">{errorMessage(create.error)}</Alert> : null}
        <div><Button type="submit" loading={create.isPending}>{mode === "libre" ? "Empezar a registrar" : "Crear viaje"}</Button></div>
      </form>
    </>
  );
}
