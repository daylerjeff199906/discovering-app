import { Alert, Button, Field, Input, Select, Textarea } from "@por-aqui/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { PlacePicker, type PlaceChoice } from "../components/place-picker";
import { LoadingBlock, PageHeader, QueryError } from "../components/shell";
import { api, errorMessage } from "../lib/api";
import { useMe } from "../lib/auth";
import { browserTimezone, fromLocalInput, toLocalInput, uuid } from "../lib/format";
import { useJourney } from "../lib/journey-hooks";
import { qk } from "../lib/query";
import { submitVisit } from "../lib/recording-sync";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/app.viajes.$id.visitas.nueva";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Nueva visita — Por aquí", noindex: true });
}

const zones = () => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
  } catch {
    return [browserTimezone()];
  }
};

export default function NuevaVisita() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { me } = useMe();
  const journey = useJourney(id);
  const [choice, setChoice] = useState<PlaceChoice | null>(null);
  const [tz, setTz] = useState(browserTimezone());
  const [when, setWhen] = useState(() => toLocalInput(new Date().toISOString(), browserTimezone()));
  const [note, setNote] = useState("");
  const [clientMutationId] = useState(uuid); // el mismo id en cada reintento: nunca duplica

  const save = useMutation({
    mutationFn: async () => {
      const j = journey.data!;
      let rec = j.recording;
      if (!rec) rec = await api.recording.start(id); // un viaje sin iniciar se inicia al registrar la primera visita
      const payload = { clientMutationId, ...choice!, visitedAt: fromLocalInput(when, tz), timezone: tz, note: note.trim() || null, retroactive: rec.status === "COMPLETED" ? true : undefined };
      if (rec.status === "COMPLETED") {
        const v = await api.visits.create(rec.id, payload);
        return { status: "saved" as const, visitId: v.id };
      }
      const r = await submitVisit(me!.id, id, rec.id, payload);
      if (r.status === "saved") {
        const list = await api.visits.listForJourney(id);
        return { status: "saved" as const, visitId: list.find((v) => v.clientMutationId === clientMutationId)?.id };
      }
      return { status: "queued" as const, visitId: undefined };
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: qk.journey(id) });
      void qc.invalidateQueries({ queryKey: qk.visits(id) });
      void qc.invalidateQueries({ queryKey: ["journeys"] });
      if (r.visitId) navigate(`/app/viajes/${id}/visitas/${r.visitId}?nueva=1`);
      else navigate(`/app/viajes/${id}/recorrido`);
    },
  });

  if (journey.isPending) return <LoadingBlock />;
  if (journey.isError || !journey.data) return <QueryError error={journey.error} retry={() => journey.refetch()} />;
  const j = journey.data;
  const completed = j.recording?.status === "COMPLETED";

  return (
    <>
      <PageHeader title="Nueva visita" subtitle="Registra un lugar que visitaste. Las fotos y el GPS son opcionales; puedes añadir una visita pasada." />
      {!j.recording ? <Alert tone="sage" className="mb-4">Este viaje todavía no se inició. Al guardar la visita se iniciará el registro (podrás finalizarlo cuando quieras).</Alert> : null}
      {completed ? <Alert tone="warning" className="mb-4" title="Estás añadiendo una visita pasada">Este recorrido ya está finalizado. La visita se agregará al diario; si ya publicaste, usa «Actualizar publicación» para mostrarla.</Alert> : null}
      <form onSubmit={(e) => { e.preventDefault(); if (choice) save.mutate(); }} className="grid max-w-3xl gap-6">
        <PlacePicker journey={j} value={choice} onChange={(v) => setChoice(v)} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Fecha y hora de la visita" hint="En la zona horaria elegida. Puede ser un momento pasado.">{(c) => <Input {...c} type="datetime-local" required value={when} onChange={(e) => setWhen(e.target.value)} />}</Field>
          <Field label="Zona horaria">{(c) => <Select {...c} value={tz} onChange={(e) => { const next = e.target.value; setWhen(toLocalInput(fromLocalInput(when, tz), next)); setTz(next); }}>{zones().map((z) => <option key={z} value={z}>{z}</option>)}</Select>}</Field>
        </div>
        <Field label="Nota (opcional)" hint="Texto simple; se muestra tal cual, sin formato.">{(c) => <Textarea {...c} value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} rows={4} />}</Field>
        {save.isError ? <Alert tone="danger" live="assertive">{errorMessage(save.error)}</Alert> : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={!choice} loading={save.isPending}>Guardar visita</Button>
          <Button variant="ghost" onClick={() => navigate(-1)}>Cancelar</Button>
        </div>
      </form>
    </>
  );
}
