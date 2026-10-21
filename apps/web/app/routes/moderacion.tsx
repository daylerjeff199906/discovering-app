import { Alert, Badge, Button, EmptyState, Field, Tabs, Textarea } from "@por-aqui/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { LoadingBlock, PageHeader, QueryError } from "../components/shell";
import { api, errorMessage } from "../lib/api";
import { useMe } from "../lib/auth";
import { formatDateTime } from "../lib/format";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/moderacion";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Moderación — Por aquí", noindex: true });
}

const REASONS: Record<string, string> = { INAPPROPRIATE: "Contenido inapropiado", PRIVACY: "Datos privados", SPAM: "Spam", COPYRIGHT: "Derechos de autor", OTHER: "Otro" };

/** Solo moderadores. Solo se ve el SNAPSHOT publicado; nunca diarios privados. Cada acción queda auditada. */
export default function Moderacion() {
  const { me } = useMe();
  const qc = useQueryClient();
  const [status, setStatus] = useState<"OPEN" | "RESOLVED" | "DISMISSED">("OPEN");
  const [openId, setOpenId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const reports = useQuery({ queryKey: ["mod-reports", status], queryFn: ({ signal }) => api.moderation.reports(status, { signal }), enabled: me?.role === "MODERATOR" });
  const current = reports.data?.find((r) => r.id === openId);
  const preview = useQuery({ queryKey: ["mod-preview", current?.publicationId], queryFn: ({ signal }) => api.moderation.preview(current!.publicationId, { signal }), enabled: Boolean(current) });
  const act = useMutation({
    mutationFn: (v: { action: "HIDE" | "RESTORE"; resolve: "RESOLVED" | "DISMISSED" }) => api.moderation.act(current!.publicationId, { action: v.action, reason: reason.trim(), reportId: current!.id, resolveReport: v.resolve }),
    onSuccess: () => { setReason(""); setOpenId(null); void qc.invalidateQueries({ queryKey: ["mod-reports"] }); },
  });
  const dismiss = useMutation({
    // Descartar sin ocultar: se registra como RESTORE con motivo (auditoría) y el reporte pasa a DISMISSED.
    mutationFn: () => api.moderation.act(current!.publicationId, { action: "RESTORE", reason: reason.trim(), reportId: current!.id, resolveReport: "DISMISSED" }),
    onSuccess: () => { setReason(""); setOpenId(null); void qc.invalidateQueries({ queryKey: ["mod-reports"] }); },
  });

  if (!me) return <LoadingBlock />;
  if (me.role !== "MODERATOR") return <Alert tone="danger" title="Sin acceso">Esta sección es solo para moderadores.</Alert>;
  const reasonOk = reason.trim().length >= 5;
  return (
    <>
      <PageHeader title="Moderación" subtitle="Reportes de la comunidad. Solo ves lo publicado, nunca los diarios privados." />
      <div className="mb-5"><Tabs label="Estado del reporte" value={status} onChange={(v) => { setStatus(v as typeof status); setOpenId(null); }} tabs={[{ id: "OPEN", label: "Abiertos" }, { id: "RESOLVED", label: "Resueltos" }, { id: "DISMISSED", label: "Descartados" }]} /></div>
      {reports.isPending ? <LoadingBlock /> : null}
      {reports.isError ? <QueryError error={reports.error} retry={() => reports.refetch()} /> : null}
      {reports.data?.length === 0 ? <EmptyState title="No hay reportes en este estado" /> : null}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {reports.data?.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => setOpenId(r.id)} aria-pressed={openId === r.id} className={`w-full rounded-card border bg-surface p-4 text-left ${openId === r.id ? "border-primary" : "border-border"}`}>
                <p className="flex flex-wrap items-center gap-2 font-semibold">{r.publicationTitle ?? "(sin contenido activo)"} {r.moderationStatus === "HIDDEN" ? <Badge tone="danger">Oculta</Badge> : null}</p>
                <p className="text-sm text-muted-foreground">{REASONS[r.reason] ?? r.reason} · {formatDateTime(r.createdAt)}</p>
                {r.detail ? <p className="mt-1 text-sm">«{r.detail}»</p> : null}
              </button>
            </li>
          ))}
        </ul>
        <section aria-label="Detalle del reporte">
          {!current ? <p className="text-muted-foreground">Elige un reporte para revisar la publicación.</p> : (
            <div className="flex flex-col gap-4">
              {preview.isPending ? <LoadingBlock /> : null}
              {preview.data ? (
                <div className="rounded-card border border-border bg-surface p-4">
                  <h2 className="text-xl">{preview.data.title}</h2>
                  <p className="text-sm text-muted-foreground">por {preview.data.author.displayName} (@{preview.data.author.username}) · {preview.data.entries.length} paradas</p>
                  {preview.data.description ? <p className="mt-2">{preview.data.description}</p> : null}
                  <ol className="m-0 mt-3 list-decimal pl-5 text-sm">
                    {preview.data.entries.map((e) => <li key={e.position}><strong>{e.displayName}</strong>{e.note ? <> — {e.note}</> : null}{e.media.length ? ` (${e.media.length} foto/s)` : ""}</li>)}
                  </ol>
                  <div className="mt-3 grid grid-cols-4 gap-2">{preview.data.entries.flatMap((e) => e.media).slice(0, 8).map((m) => <img key={m.url} src={m.thumbUrl} alt={m.altText ?? m.caption ?? "Foto publicada"} width={160} height={120} className="aspect-[4/3] w-full rounded-control object-cover" />)}</div>
                </div>
              ) : null}
              {preview.isError ? <Alert tone="warning">{errorMessage(preview.error)}</Alert> : null}
              {current.status === "OPEN" ? (
                <>
                  <Field label="Motivo de la decisión (queda en la auditoría)" required hint="Mínimo 5 caracteres.">{(c) => <Textarea {...c} rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />}</Field>
                  {act.isError || dismiss.isError ? <Alert tone="danger" live="assertive">{errorMessage(act.error ?? dismiss.error)}</Alert> : null}
                  <div className="flex flex-wrap gap-3">
                    <Button variant="danger" disabled={!reasonOk} loading={act.isPending} onClick={() => act.mutate({ action: "HIDE", resolve: "RESOLVED" })}>Ocultar publicación</Button>
                    <Button variant="outline" disabled={!reasonOk} loading={dismiss.isPending} onClick={() => dismiss.mutate()}>Descartar reporte (mantener visible)</Button>
                    {current.moderationStatus === "HIDDEN" ? <Button variant="secondary" disabled={!reasonOk} loading={act.isPending} onClick={() => act.mutate({ action: "RESTORE", resolve: "RESOLVED" })}>Restituir</Button> : null}
                  </div>
                </>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
