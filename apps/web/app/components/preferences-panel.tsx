import { PACES, TRANSPORT_MODES, type JourneyPreferences } from "@por-aqui/contracts";
import { Field, Input, Select, cn } from "@por-aqui/ui";
import { useQuery } from "@tanstack/react-query";
import { PACE_LABEL, TRANSPORT_LABEL } from "../lib/format";
import { interestsQuery } from "../lib/query";

/** Preferencias del viaje (autoguardado por el editor). */
export function PreferencesPanel({ value, onChange }: { value: JourneyPreferences; onChange: (next: JourneyPreferences) => void }) {
  const interests = useQuery(interestsQuery());
  const set = <K extends keyof JourneyPreferences>(k: K, v: JourneyPreferences[K]) => onChange({ ...value, [k]: v });
  const toggle = (slug: string) => set("interests", value.interests.includes(slug) ? value.interests.filter((i) => i !== slug) : [...value.interests, slug]);
  return (
    <section aria-labelledby="prefs" className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
      <h2 id="prefs" className="text-lg">Preferencias</h2>
      <Field label="Destino">{(c) => <Input {...c} value={value.destinationLabel ?? ""} maxLength={120} onChange={(e) => set("destinationLabel", e.target.value)} placeholder="Ciudad o región" />}</Field>
      <Field label="Fecha de inicio (opcional)">{(c) => <Input {...c} type="date" value={value.startDate ?? ""} onChange={(e) => set("startDate", e.target.value || undefined)} />}</Field>
      <Field label="Tiempo por día (min)" hint="Para armar propuestas automáticas.">
        {(c) => <Input {...c} type="number" min={30} max={1440} step={30} value={value.availableMinutesPerDay ?? ""} onChange={(e) => set("availableMinutesPerDay", e.target.value ? Number(e.target.value) : undefined)} placeholder="480" />}
      </Field>
      <Field label="Transporte principal">
        {(c) => (
          <Select {...c} value={value.transport} onChange={(e) => set("transport", e.target.value as JourneyPreferences["transport"])}>
            {TRANSPORT_MODES.map((m) => <option key={m} value={m}>{TRANSPORT_LABEL[m]}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Ritmo">
        {(c) => (
          <Select {...c} value={value.pace} onChange={(e) => set("pace", e.target.value as JourneyPreferences["pace"])}>
            {PACES.map((p) => <option key={p} value={p}>{PACE_LABEL[p]}</option>)}
          </Select>
        )}
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-semibold">Intereses</legend>
        <div className="flex flex-wrap gap-2">
          {interests.data?.map((i) => {
            const on = value.interests.includes(i.slug);
            return (
              <label key={i.slug} className={cn("inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors", on ? "border-primary bg-sage text-sage-foreground" : "border-control-border bg-surface hover:bg-surface-muted")}>
                <input type="checkbox" className="sr-only" checked={on} onChange={() => toggle(i.slug)} />
                <span aria-hidden="true">{on ? "✓" : "+"}</span>
                {i.label}
              </label>
            );
          })}
        </div>
      </fieldset>
    </section>
  );
}
