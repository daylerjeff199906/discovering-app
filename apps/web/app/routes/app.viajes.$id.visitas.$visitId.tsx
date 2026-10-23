import { Alert, Button, Dialog, Field, Input, Textarea, buttonClass } from "@por-aqui/ui";
import { VisitExtrasFields, emptyExtras, expenseError, extrasFromVisit, extrasPayload } from "../components/visit-extras";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { PhotoUploader } from "../components/photo-uploader";
import { LoadingBlock, PageHeader, QueryError } from "../components/shell";
import { ApiError, api, errorMessage } from "../lib/api";
import { formatDateTime, fromLocalInput, toLocalInput } from "../lib/format";
import { qk } from "../lib/query";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/app.viajes.$id.visitas.$visitId";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Visita — Por aquí", noindex: true });
}

export default function Visita() {
  const { id = "", visitId = "" } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["visit", visitId], queryFn: ({ signal }) => api.visits.get(visitId, { signal }) });
  const v = q.data;
  const [note, setNote] = useState("");
  const [extras, setExtras] = useState(emptyExtras);
  const [when, setWhen] = useState("");
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (v) {
      setNote(v.note ?? "");
      setExtras(extrasFromVisit(v));
      setWhen(toLocalInput(v.visitedAt, v.timezone));
    }
  }, [v?.id, v?.version]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["visit", visitId] });
    void qc.invalidateQueries({ queryKey: qk.visits(id) });
  };
  const update = useMutation({
    mutationFn: () => api.visits.update(visitId, { note: note.trim() || null, visitedAt: fromLocalInput(when, v!.timezone), ...extrasPayload(extras), expectedVersion: v!.version }),
    onSuccess: (dto) => { qc.setQueryData(["visit", visitId], dto); refresh(); setSaved(true); setTimeout(() => setSaved(false), 2500); },
    onError: (e) => { if (e instanceof ApiError && e.isConflict) refresh(); },
  });
  const remove = useMutation({
    mutationFn: () => api.visits.remove(visitId),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.visits(id) }); void qc.invalidateQueries({ queryKey: qk.journey(id) }); navigate(`/app/viajes/${id}`); },
    onError: () => setConfirmDelete(false),
  });

  if (q.isPending) return <LoadingBlock />;
  if (q.isError || !v) return <QueryError error={q.error} retry={() => q.refetch()} />;
  const conflict = update.error instanceof ApiError && update.error.isConflict;

  return (
    <>
      <PageHeader
        title={v.place.name}
        subtitle={`${formatDateTime(v.visitedAt, v.timezone)} · ${v.timezone}`}
        actions={<><Link to={`/app/viajes/${id}`} className={buttonClass({ variant: "outline" })}>Volver al viaje</Link><Button variant="ghost" onClick={() => setConfirmDelete(true)}><Trash2 className="size-5" aria-hidden="true" /> Eliminar</Button></>}
      />
      {search.get("nueva") ? <Alert tone="success" className="mb-4" title="Visita guardada">Añade fotos y una nota si quieres. Todo es opcional.</Alert> : null}
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-10">
        <form onSubmit={(e) => { e.preventDefault(); update.mutate(); }} className="flex flex-col gap-6">
          <section aria-labelledby="visit-details-title" className="visit-section">
            <h2 id="visit-details-title" className="visit-section-title">Detalles</h2>
            <Field label="Fecha y hora">{(c) => <Input {...c} type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />}</Field>
            <Field label="Nota" hint="Texto simple.">{(c) => <Textarea {...c} rows={6} value={note} maxLength={4000} onChange={(e) => setNote(e.target.value)} />}</Field>
          </section>
          <VisitExtrasFields value={extras} onChange={setExtras} disabled={update.isPending} />
          {conflict ? <Alert tone="warning" live="assertive" title="Esta visita cambió en otro lugar">Cargamos la versión más reciente. Revisa y vuelve a guardar.</Alert> : update.isError ? <Alert tone="danger" live="assertive">{errorMessage(update.error)}</Alert> : null}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={Boolean(expenseError(extras))} loading={update.isPending}>Guardar cambios</Button>
            <span role="status" className="text-sm font-semibold text-success">{saved ? "Guardado ✓" : ""}</span>
          </div>
        </form>
        <PhotoUploader visitId={visitId} assets={v.media} onChanged={refresh} />
      </div>

      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="¿Eliminar esta visita?" description="Se borran su nota y sus fotos. No se puede deshacer." footer={<><Button variant="ghost" onClick={() => setConfirmDelete(false)}>Cancelar</Button><Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate()}>Eliminar visita</Button></>} />
      {remove.isError ? <Alert tone="warning" live="assertive" className="mt-4">{remove.error instanceof ApiError && remove.error.code === "MEDIA_IN_PUBLICATION" ? "Alguna foto de esta visita está en una publicación. Actualiza o retira la publicación antes de eliminar la visita." : errorMessage(remove.error)}</Alert> : null}
    </>
  );
}
