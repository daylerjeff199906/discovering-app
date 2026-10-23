import { Alert, Button, Field, Input, Select, Textarea } from "@por-aqui/ui";
import { VisitExtrasFields, emptyExtras, expenseError, extrasPayload } from "../components/visit-extras";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { ArrowLeft, CalendarDays, Clock, Info, MapPin } from "lucide-react";
import { Link, useNavigate, useParams } from "react-router";
import { VisitPhotoPicker } from "../components/visit-photo-picker";
import { useTravelCatalog } from "../lib/catalog";
import { uploadVisitPhoto, type VisitPhotoUpload } from "../lib/visit-photo-upload";
import { PlacePicker, type PlaceChoice } from "../components/place-picker";
import { LoadingBlock, QueryError } from "../components/shell";
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
  const [placeName, setPlaceName] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [createdVisitId, setCreatedVisitId] = useState<string | null>(null);
  const jobs = useRef(new Map<File, VisitPhotoUpload>());
  const [progress, setProgress] = useState("");
  const [changingPhotos, setChangingPhotos] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const catalog = useTravelCatalog();
  const changePhotos = async (next: File[]) => {
    setChangingPhotos(true); setPhotoError("");
    try {
      for (const file of files.filter((f) => !next.includes(f))) {
        const job = jobs.current.get(file);
        if (job?.authorization) await api.media.remove(job.authorization.assetId);
        jobs.current.delete(file);
      }
      setFiles(next);
    } catch (error) { setPhotoError(errorMessage(error)); }
    finally { setChangingPhotos(false); }
  };
  const [tz, setTz] = useState(browserTimezone());
  const [when, setWhen] = useState(() => toLocalInput(new Date().toISOString(), browserTimezone()));
  const [note, setNote] = useState("");
  const [extras, setExtras] = useState(emptyExtras);
  const [clientMutationId] = useState(uuid); // el mismo id en cada reintento: nunca duplica

  const save = useMutation({
    mutationFn: async () => {
      if (files.length && !navigator.onLine) throw new Error("Conéctate para guardar las fotos, o retíralas para registrar la visita sin conexión.");
      const j = journey.data!;
      let rec = j.recording;
      if (!rec) rec = await api.recording.start(id); // un viaje sin iniciar se inicia al registrar la primera visita
      const payload = { clientMutationId, ...choice!, visitedAt: fromLocalInput(when, tz), timezone: tz, note: note.trim() || null, ...extrasPayload(extras), retroactive: rec.status === "COMPLETED" ? true : undefined };
      if (createdVisitId || files.length) {
        let visitId = createdVisitId;
        if (!visitId) {
          const v = await api.visits.create(rec.id, payload);
          visitId = v.id; setCreatedVisitId(v.id);
        } else {
          const existing = await api.visits.get(visitId);
          await api.visits.update(visitId, { note: payload.note, visitedAt: payload.visitedAt, ...extrasPayload(extras), expectedVersion: existing.version });
        }
        for (const file of files) {
          const job = jobs.current.get(file) ?? {};
          jobs.current.set(file, job);
          await uploadVisitPhoto(visitId, file, job, setProgress);
        }
        setProgress("");
        return { status: "saved" as const, visitId };
      }
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
  const placeVisual = catalog.data?.places.find((p) => p.id === choice?.placeId);

  return (
    <section className="visit-editor-page">
      <Link to={`/app/viajes/${id}`} className="adventure-back"><ArrowLeft size={18} aria-hidden="true" /> Volver a mi viaje</Link>
      <h1>Registrar visita</h1>
      {choice ? <p className="visit-place-label"><MapPin size={20} aria-hidden="true" />{placeName}{placeVisual ? ` · ${catalog.data?.cities.find((c) => c.id === placeVisual.cityId)?.name ?? ""}` : ""}</p> : <p className="adventure-intro">Elige un lugar y guarda lo que quieres recordar.</p>}
      {placeVisual ? <figure className="visit-place-cover"><img src={placeVisual.imageUrl} alt={`Imagen de referencia de ${placeName}`} width={700} height={300} /><figcaption>Imagen de referencia del catálogo</figcaption></figure> : null}
      {!j.recording ? <Alert tone="sage" className="mb-4">Este viaje todavía no se inició. Al guardar la visita se iniciará el registro (podrás finalizarlo cuando quieras).</Alert> : null}
      {completed ? <Alert tone="warning" className="mb-4" title="Estás añadiendo una visita pasada">Este recorrido ya está finalizado. La visita se agregará al diario; si ya publicaste, usa «Actualizar publicación» para mostrarla.</Alert> : null}
      <form onSubmit={(e) => { e.preventDefault(); if (choice) save.mutate(); }} className="grid gap-6">
        <fieldset disabled={save.isPending || Boolean(createdVisitId)}><details className="visit-place-picker" open={!choice}><summary>{choice ? "Cambiar lugar de la visita" : "Seleccionar lugar"}</summary><PlacePicker journey={j} value={choice} onChange={(v, label) => { setChoice(v); setPlaceName(label); }} /></details></fieldset>
        <div className="visit-date-fields">
          <Field label={<span><CalendarDays size={17} aria-hidden="true" /> Fecha</span>}>{(c) => <Input {...c} type="date" required disabled={save.isPending} value={when.split("T")[0]} onChange={(e) => setWhen(`${e.target.value}T${when.split("T")[1] ?? "12:00"}`)} />}</Field>
          <Field label={<span><Clock size={17} aria-hidden="true" /> Hora</span>}>{(c) => <Input {...c} type="time" required disabled={save.isPending} value={when.split("T")[1]?.slice(0,5)} onChange={(e) => setWhen(`${when.split("T")[0]}T${e.target.value}`)} />}</Field>
        </div>
        <VisitPhotoPicker files={files} onChange={(next) => void changePhotos(next)} disabled={save.isPending || changingPhotos} />
        {photoError ? <Alert tone="danger" live="assertive">{photoError}</Alert> : null}
        <Field label="¿Qué quieres recordar?" hint={`${note.length}/4000`}>{(c) => <Textarea {...c} value={note} disabled={save.isPending} maxLength={4000} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="Un lugar, un detalle, lo que sentiste al estar aquí…" />}</Field>
        <VisitExtrasFields value={extras} onChange={setExtras} disabled={save.isPending} />
        <details className="visit-timezone"><summary>Zona horaria: {tz}</summary><Field label="Zona horaria">{(c) => <Select {...c} value={tz} disabled={save.isPending} onChange={(e) => { const next = e.target.value; setWhen(toLocalInput(fromLocalInput(when, tz), next)); setTz(next); }}>{zones().map((z) => <option key={z} value={z}>{z}</option>)}</Select>}</Field></details>
        <p className="visit-past-note"><Info size={16} aria-hidden="true" /> Puedes registrar una visita pasada.</p>
        {progress && save.isPending ? <p role="status" className="text-sm text-primary">{progress}</p> : null}
        {createdVisitId && save.isError ? <Alert tone="warning">La visita ya está guardada. Puedes reintentar las fotos; no se creará otra visita.</Alert> : null}
        {save.isError ? <Alert tone="danger" live="assertive">{errorMessage(save.error, save.error instanceof Error ? save.error.message : undefined)}</Alert> : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" className="w-full" disabled={!choice || changingPhotos || Boolean(expenseError(extras))} loading={save.isPending}>{createdVisitId ? "Guardar cambios y fotos" : "Guardar visita"}</Button>
          <Button variant="ghost" disabled={save.isPending || changingPhotos} onClick={() => createdVisitId ? navigate(`/app/viajes/${id}`) : navigate(-1)}>{createdVisitId ? "Volver al diario" : "Cancelar"}</Button>
        </div>
      </form>
    </section>
  );
}
