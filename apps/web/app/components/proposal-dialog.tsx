import { PACES, TRANSPORT_MODES, type JourneyDto, type ProposalDto } from "@por-aqui/contracts";
import { Alert, Badge, Button, Dialog, Field, Input, Select } from "@por-aqui/ui";
import { useQuery } from "@tanstack/react-query";
import { Wand2 } from "lucide-react";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, errorMessage } from "../lib/api";
import { formatDistance, formatDuration, PACE_LABEL, TRANSPORT_LABEL } from "../lib/format";
import { interestsQuery } from "../lib/query";

/**
 * Generador determinista (sin LLM): propone, el usuario revisa y decide aplicar.
 * Muestra el origen de los datos y marca lo «Estimado» o «Por definir»; nunca inventa trayectos.
 */
export function ProposalDialog({ open, onClose, journey, onApplied, onConflict }: { open: boolean; onClose: () => void; journey: JourneyDto; onApplied: (j: JourneyDto) => void; onConflict: () => void }) {
  const prefs = journey.preferences;
  const interests = useQuery(interestsQuery());
  const [destination, setDestination] = useState(prefs.destinationLabel ?? "");
  const [days, setDays] = useState(Math.max(1, journey.days.length || 1));
  const [minutes, setMinutes] = useState(prefs.availableMinutesPerDay ?? 480);
  const [pace, setPace] = useState(prefs.pace);
  const [transport, setTransport] = useState(prefs.transport);
  const [chosen, setChosen] = useState<string[]>(prefs.interests);
  const [proposal, setProposal] = useState<ProposalDto | null>(null);

  const generate = useMutation({
    mutationFn: () => api.journeys.propose(journey.id, { destinationLabel: destination.trim(), daysCount: days, availableMinutesPerDay: minutes, interests: chosen, transport, pace, startDate: prefs.startDate, radiusM: 15000, expectedVersion: journey.version }),
    onSuccess: setProposal,
    onError: (e) => (e as { isConflict?: boolean }).isConflict && onConflict(),
  });
  const apply = useMutation({
    mutationFn: () => api.journeys.applyProposal(journey.id, proposal!, journey.version),
    onSuccess: (j) => { onApplied(j); setProposal(null); onClose(); },
    onError: (e) => (e as { isConflict?: boolean }).isConflict && onConflict(),
  });
  const hasStops = journey.days.some((d) => d.stops.length > 0);

  return (
    <Dialog open={open} onClose={onClose} variant="sheet" className="md:w-[min(92vw,44rem)]" title="Armar una propuesta" description="Una sugerencia explicable a partir del catálogo; tú decides si la aplicas."
      footer={proposal ? (<><Button variant="ghost" onClick={() => setProposal(null)}>Cambiar parámetros</Button><Button loading={apply.isPending} disabled={proposal.days.length === 0} onClick={() => apply.mutate()}>{hasStops ? "Reemplazar mi plan con esta propuesta" : "Aplicar propuesta"}</Button></>) : (<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={generate.isPending} disabled={!destination.trim()} onClick={() => generate.mutate()}><Wand2 className="size-5" aria-hidden="true" /> Generar propuesta</Button></>)}>
      {proposal ? (
        <div className="flex flex-col gap-4">
          {proposal.warnings.map((w) => <Alert key={w.code} tone={w.code === "NO_DATA" ? "danger" : "warning"}>{w.message}</Alert>)}
          {proposal.days.map((d, i) => (
            <section key={i} aria-label={`Día ${i + 1}`} className="rounded-control border border-border p-3">
              <h3 className="text-lg">Día {i + 1}{d.localDate ? ` · ${d.localDate}` : ""}</h3>
              <ol className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
                {d.stops.map((s, k) => {
                  const leg = d.legs[k];
                  return (
                    <li key={s.placeId}>
                      <p className="font-semibold">{k + 1}. {s.place.name}</p>
                      <p className="text-sm text-muted-foreground">
                        Visita {formatDuration(s.visitDurationSeconds)}{s.durationEstimated ? " (estimado)" : ""}
                        {s.hoursKnown ? "" : " · horario desconocido"}
                      </p>
                      {leg ? <p className="ml-3 text-sm text-muted-foreground">↓ {TRANSPORT_LABEL[leg.mode]} · {leg.durationS === null ? "Por definir" : `${formatDuration(leg.durationS)} · ${formatDistance(leg.distanceM) ?? ""}${leg.quality === "ESTIMATED" ? " (estimado)" : ""}`}</p> : null}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-2 text-sm">Tiempo planificado: <strong>{formatDuration(d.plannedSeconds)}</strong></p>
            </section>
          ))}
          <p className="text-sm text-muted-foreground"><strong>Origen de los datos:</strong> {proposal.dataSources.join(" · ") || "—"}</p>
          {apply.isError ? <Alert tone="danger" live="assertive">{errorMessage(apply.error)}</Alert> : null}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Destino" required hint="Debe existir en el catálogo (p. ej. Iquitos, Cusco, Lisboa).">{(c) => <Input {...c} value={destination} onChange={(e) => setDestination(e.target.value)} />}</Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Días">{(c) => <Input {...c} type="number" min={1} max={14} value={days} onChange={(e) => setDays(Math.min(14, Math.max(1, Number(e.target.value) || 1)))} />}</Field>
            <Field label="Minutos por día">{(c) => <Input {...c} type="number" min={60} max={1440} step={30} value={minutes} onChange={(e) => setMinutes(Number(e.target.value) || 480)} />}</Field>
            <Field label="Transporte">{(c) => <Select {...c} value={transport} onChange={(e) => setTransport(e.target.value as typeof transport)}>{TRANSPORT_MODES.map((m) => <option key={m} value={m}>{TRANSPORT_LABEL[m]}</option>)}</Select>}</Field>
            <Field label="Ritmo">{(c) => <Select {...c} value={pace} onChange={(e) => setPace(e.target.value as typeof pace)}>{PACES.map((p) => <option key={p} value={p}>{PACE_LABEL[p]}</option>)}</Select>}</Field>
          </div>
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">Intereses</legend>
            <div className="flex flex-wrap gap-2">
              {interests.data?.map((i) => {
                const on = chosen.includes(i.slug);
                return (
                  <button key={i.slug} type="button" aria-pressed={on} onClick={() => setChosen(on ? chosen.filter((x) => x !== i.slug) : [...chosen, i.slug])} className={`min-h-10 rounded-full border px-3.5 text-sm font-medium ${on ? "border-primary bg-sage text-sage-foreground" : "border-control-border bg-surface"}`}>
                    {on ? "✓ " : "+ "}{i.label}
                  </button>
                );
              })}
            </div>
          </fieldset>
          {hasStops ? <Alert tone="warning">Aplicar una propuesta reemplaza tus días y paradas actuales (las visitas que ya registraste se conservan).</Alert> : null}
          {generate.isError ? <Alert tone="danger" live="assertive">{errorMessage(generate.error)}</Alert> : null}
          <Badge tone="neutral">Sin IA: el orden se calcula con una heurística explicable.</Badge>
        </div>
      )}
    </Dialog>
  );
}
