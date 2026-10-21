import { LOCATION_PRECISIONS, type PublishInput, type Visibility } from "@por-aqui/contracts";
import { Alert, Badge, Button, Card, Dialog, EmptyState, Field, Input, Select, Textarea, cn } from "@por-aqui/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Link2, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router";
import { LoadingBlock, PageHeader, QueryError } from "../components/shell";
import { ApiError, api, errorMessage } from "../lib/api";
import { formatDateTime, VISIBILITY_LABEL } from "../lib/format";
import { qk } from "../lib/query";
import { seoMeta } from "../lib/seo";
import type { Route } from "./+types/app.viajes.$id.compartir";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Compartir — Por aquí", noindex: true });
}

const PRECISION_LABEL = { EXACT: "Exacta", APPROXIMATE: "Aproximada (~1 km)", HIDDEN: "Oculta" } as const;
const VIS_HELP: Record<Visibility, string> = {
  PRIVATE: "Solo tú. Guarda la selección sin publicar nada.",
  UNLISTED: "Cualquiera con el enlace. No aparece en Explorar ni en buscadores.",
  PUBLIC: "Aparece en Explorar y en tu perfil público.",
};

interface EntryState {
  include: boolean;
  includeNote: boolean;
  precision: (typeof LOCATION_PRECISIONS)[number];
  assets: Set<string>;
}

export default function Compartir() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: qk.draft(id), queryFn: ({ signal }) => api.publications.draft(id, { signal }) });
  const d = q.data;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [visibility, setVisibility] = useState<Visibility>("PUBLIC");
  const [locationLabel, setLocationLabel] = useState("");
  const [transportSummary, setTransportSummary] = useState("");
  const [cover, setCover] = useState<string | null>(null);
  const [exactTrack, setExactTrack] = useState(false);
  const [entries, setEntries] = useState<Record<string, EntryState>>({});
  const [confirm, setConfirm] = useState(false);
  const [initFor, setInitFor] = useState<string | null>(null);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // Precarga: la selección vigente de la publicación (si existe) o valores seguros por omisión.
  useEffect(() => {
    if (!d) return;
    const key = `${d.publication?.revision ?? 0}:${d.candidates.length}`;
    if (initFor === key) return;
    setInitFor(key);
    const cur = d.publication?.current;
    setTitle(cur?.title ?? d.journeyTitle);
    setDescription(cur?.description ?? "");
    setVisibility(cur?.visibility && cur.visibility !== "PRIVATE" ? cur.visibility : d.publication?.visibility && d.publication.visibility !== "PRIVATE" ? d.publication.visibility : "PUBLIC");
    setLocationLabel(cur?.locationLabel ?? "");
    setTransportSummary(cur?.transportSummary ?? "");
    setCover(cur?.coverAssetId ?? null);
    setExactTrack(cur?.shareExactTrack ?? false);
    const next: Record<string, EntryState> = {};
    for (const c of d.candidates) {
      const prev = cur?.entries.find((e) => e.visitId === c.visitId);
      next[c.visitId] = { include: cur ? Boolean(prev) : true, includeNote: prev?.includeNote ?? false, precision: prev?.locationPrecision ?? "EXACT", assets: new Set(prev ? prev.media.map((m) => m.assetId) : c.media.map((m) => m.id)) };
    }
    setEntries(next);
  }, [d, initFor]);

  const selectedCount = Object.values(entries).filter((e) => e.include).length;
  const photoCount = Object.values(entries).filter((e) => e.include).reduce((a, e) => a + e.assets.size, 0);
  const allSelectedAssets = useMemo(() => new Set(Object.values(entries).filter((e) => e.include).flatMap((e) => [...e.assets])), [entries]);
  useEffect(() => { if (cover && !allSelectedAssets.has(cover)) setCover(null); }, [allSelectedAssets, cover]);

  const body = (): PublishInput => ({
    title: title.trim(),
    description: description.trim() || null,
    visibility,
    coverAssetId: cover,
    locationLabel: locationLabel.trim() || null,
    transportSummary: transportSummary.trim() || null,
    shareExactTrack: exactTrack,
    entries: d!.candidates.filter((c) => entries[c.visitId]?.include).map((c) => ({ visitId: c.visitId, includeNote: entries[c.visitId]!.includeNote && Boolean(c.note), locationPrecision: entries[c.visitId]!.precision, media: [...entries[c.visitId]!.assets].map((assetId) => ({ assetId })) })),
    expectedRevision: d!.publication?.revision ?? undefined,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: qk.draft(id) });
  const publish = useMutation({ mutationFn: () => api.publications.publish(id, body()), onSuccess: () => { setConfirm(false); setInitFor(null); void refresh(); void qc.invalidateQueries({ queryKey: ["journeys"] }); } });
  const setVis = useMutation({ mutationFn: (v: Visibility) => api.publications.setVisibility(d!.publication!.id, v), onSuccess: () => { setInitFor(null); void refresh(); void qc.invalidateQueries({ queryKey: ["journeys"] }); } });
  const links = useQuery({ queryKey: ["links", d?.publication?.id], queryFn: ({ signal }) => api.publications.links(d!.publication!.id, { signal }), enabled: Boolean(d?.publication && d.publication.visibility !== "PRIVATE") });
  const createLink = useMutation({ mutationFn: () => api.publications.createLink(d!.publication!.id, null), onSuccess: (l) => { setNewLink(l.url); void links.refetch(); void refresh(); } });
  const revoke = useMutation({ mutationFn: (linkId: string) => api.publications.revokeLink(d!.publication!.id, linkId), onSuccess: () => { void links.refetch(); void refresh(); } });
  const unpublish = useMutation({ mutationFn: () => api.publications.remove(id), onSuccess: () => { setInitFor(null); void refresh(); void qc.invalidateQueries({ queryKey: ["journeys"] }); } });

  if (q.isPending) return <LoadingBlock />;
  if (q.isError || !d) return <QueryError error={q.error} retry={() => q.refetch()} />;
  const pub = d.publication;
  const conflict = publish.error instanceof ApiError && publish.error.isConflict;
  const publicUrl = pub ? `${window.location.origin}/r/${pub.slug}` : null;
  const valid = title.trim().length > 0 && selectedCount > 0 && d.canPublish;

  const copy = async (text: string) => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <>
      <PageHeader title="Compartir tu historia" subtitle="Tú decides qué se comparte. Lo que no marques no sale de tu diario privado." actions={<Link to={`/app/viajes/${id}`} className="font-semibold">← Volver al diario</Link>} />

      {!d.canPublish ? <Alert tone="warning" className="mb-4" title="Todavía no puedes publicar">{d.blockedReason}</Alert> : null}
      {pub ? (
        <Card className="mb-6 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-muted-foreground">Estado actual</p>
              <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
                {VISIBILITY_LABEL[pub.visibility]} {pub.moderationStatus === "HIDDEN" ? <Badge tone="danger">Oculta por moderación</Badge> : null}
                {pub.revision ? <span className="text-sm font-normal text-muted-foreground">· revisión {pub.revision}</span> : null}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {pub.visibility === "PUBLIC" && pub.moderationStatus === "VISIBLE" && publicUrl ? <a href={publicUrl} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center gap-1.5 rounded-control border border-control-border px-3.5 text-sm font-semibold no-underline"><ExternalLink className="size-4" aria-hidden="true" /> Ver publicada</a> : null}
              {pub.visibility !== "PRIVATE" ? <Button size="sm" variant="outline" loading={setVis.isPending} onClick={() => setVis.mutate("PRIVATE")}>Retirar (volver a privado)</Button> : null}
              <Button size="sm" variant="ghost" loading={unpublish.isPending} onClick={() => unpublish.mutate()}><Trash2 className="size-4" aria-hidden="true" /> Eliminar publicación</Button>
            </div>
          </div>
          {pub.visibility !== "PRIVATE" ? (
            <div className="mt-4 border-t border-border pt-4">
              <h2 className="text-lg">Enlaces compartidos</h2>
              <p className="text-sm text-muted-foreground">Quien tenga el enlace puede ver la historia (aunque sea «Solo con enlace»). Puedes revocarlo cuando quieras. El token solo se muestra al crearlo.</p>
              {newLink ? (
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-control bg-sage/50 p-3">
                  <code className="min-w-0 flex-1 break-all text-sm">{newLink}</code>
                  <Button size="sm" onClick={() => void copy(newLink)}><Copy className="size-4" aria-hidden="true" /> {copied ? "¡Copiado!" : "Copiar"}</Button>
                </div>
              ) : null}
              <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
                {links.data?.map((l) => (
                  <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>Creado {formatDateTime(l.createdAt)}{l.expiresAt ? ` · vence ${formatDateTime(l.expiresAt)}` : ""}{l.revokedAt ? " · revocado" : ""}</span>
                    {!l.revokedAt ? <Button size="sm" variant="ghost" loading={revoke.isPending && revoke.variables === l.id} onClick={() => revoke.mutate(l.id)}>Revocar</Button> : null}
                  </li>
                ))}
              </ul>
              <Button size="sm" variant="outline" className="mt-3" loading={createLink.isPending} onClick={() => createLink.mutate()}><Link2 className="size-4" aria-hidden="true" /> Crear enlace nuevo</Button>
              {createLink.isError ? <p role="alert" className="mt-2 text-sm text-danger">{errorMessage(createLink.error)}</p> : null}
            </div>
          ) : null}
        </Card>
      ) : null}
      {[setVis, unpublish].map((m, i) => m.isError ? <Alert key={i} tone="danger" className="mb-4" live="assertive">{errorMessage(m.error)}</Alert> : null)}

      {d.candidates.length === 0 ? (
        <EmptyState title="No hay visitas para publicar" action={<Link to={`/app/viajes/${id}/visitas/nueva`} className="font-semibold">Añadir una visita</Link>}>Registra al menos una visita en este viaje.</EmptyState>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); if (valid) setConfirm(true); }} className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
          <div className="flex flex-col gap-4">
            <h2 className="text-xl">Datos de la publicación</h2>
            <Field label="Título" required>{(c) => <Input {...c} value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} />}</Field>
            <Field label="Descripción">{(c) => <Textarea {...c} rows={4} value={description} maxLength={2000} onChange={(e) => setDescription(e.target.value)} />}</Field>
            <Field label="Lugar (etiqueta)" hint="Ej.: Iquitos, Loreto, Perú">{(c) => <Input {...c} value={locationLabel} maxLength={120} onChange={(e) => setLocationLabel(e.target.value)} />}</Field>
            <Field label="Transporte (resumen)" hint="Ej.: A pie y en bote">{(c) => <Input {...c} value={transportSummary} maxLength={120} onChange={(e) => setTransportSummary(e.target.value)} />}</Field>
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 font-semibold">Visibilidad</legend>
              {(["PRIVATE", "UNLISTED", "PUBLIC"] as const).map((v) => (
                <label key={v} className={cn("flex cursor-pointer items-start gap-3 rounded-control border p-3 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-focus", visibility === v ? "border-primary bg-sage/40" : "border-border")}>
                  <input type="radio" name="vis" className="mt-1 size-5 accent-[var(--primary)]" checked={visibility === v} onChange={() => setVisibility(v)} />
                  <span><span className="font-semibold">{VISIBILITY_LABEL[v]}</span><span className="block text-sm text-muted-foreground">{VIS_HELP[v]}</span></span>
                </label>
              ))}
            </fieldset>
            <label className={cn("flex items-start gap-3 rounded-control border p-3", !d.hasTrack && "opacity-60")}>
              <input type="checkbox" className="mt-1 size-5 accent-[var(--primary)]" disabled={!d.hasTrack} checked={exactTrack} onChange={(e) => setExactTrack(e.target.checked)} />
              <span><span className="font-semibold">Compartir mi trayecto GPS</span><span className="block text-sm text-muted-foreground">{d.hasTrack ? "Desactivado por omisión: mostraría por dónde caminaste con detalle (simplificado). Actívalo solo si quieres." : "No registraste GPS en este viaje."}</span></span>
            </label>
          </div>

          <div className="flex flex-col gap-4">
            <h2 className="text-xl">Qué incluir <span className="text-base font-normal text-muted-foreground">({selectedCount} visitas · {photoCount} fotos)</span></h2>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {d.candidates.map((c) => {
                const e = entries[c.visitId];
                if (!e) return null;
                const upd = (patch: Partial<EntryState>) => setEntries((s) => ({ ...s, [c.visitId]: { ...e, ...patch } }));
                return (
                  <li key={c.visitId} className={cn("rounded-card border p-4", e.include ? "border-primary bg-surface" : "border-border bg-surface-muted/60")}>
                    <label className="flex cursor-pointer items-start gap-3">
                      <input type="checkbox" className="mt-1 size-5 accent-[var(--primary)]" checked={e.include} onChange={(ev) => upd({ include: ev.target.checked })} />
                      <span><span className="font-semibold">{c.placeName}</span><span className="block text-sm text-muted-foreground">{formatDateTime(c.visitedAt, c.timezone)}</span></span>
                    </label>
                    {e.include ? (
                      <div className="mt-3 flex flex-col gap-3 pl-8">
                        {c.note ? (
                          <label className="flex items-start gap-2 text-sm">
                            <input type="checkbox" className="mt-0.5 size-4 accent-[var(--primary)]" checked={e.includeNote} onChange={(ev) => upd({ includeNote: ev.target.checked })} />
                            <span>Incluir mi nota: <em className="text-muted-foreground">«{c.note.length > 120 ? `${c.note.slice(0, 120)}…` : c.note}»</em></span>
                          </label>
                        ) : null}
                        <label className="flex flex-wrap items-center gap-2 text-sm">
                          Ubicación
                          <Select aria-label={`Precisión de ubicación de ${c.placeName}`} value={e.precision} onChange={(ev) => upd({ precision: ev.target.value as EntryState["precision"] })} className="!min-h-10 w-auto py-1.5">
                            {LOCATION_PRECISIONS.map((p) => <option key={p} value={p}>{PRECISION_LABEL[p]}</option>)}
                          </Select>
                        </label>
                        {c.media.length > 0 ? (
                          <ul className="m-0 grid list-none grid-cols-3 gap-2 p-0 sm:grid-cols-4">
                            {c.media.map((m) => {
                              const on = e.assets.has(m.id);
                              return (
                                <li key={m.id} className={cn("relative overflow-hidden rounded-control border-2", on ? "border-primary" : "border-transparent opacity-60")}>
                                  <label className="block cursor-pointer">
                                    <img src={m.thumbUrl!} alt={m.caption ?? "Foto de la visita"} loading="lazy" width={160} height={120} className="aspect-[4/3] w-full object-cover" />
                                    <input type="checkbox" className="absolute left-1.5 top-1.5 size-5 accent-[var(--primary)]" checked={on} aria-label={`Incluir foto de ${c.placeName}`} onChange={(ev) => { const next = new Set(e.assets); if (ev.target.checked) next.add(m.id); else next.delete(m.id); upd({ assets: next }); }} />
                                  </label>
                                  {on ? <button type="button" onClick={() => setCover(cover === m.id ? null : m.id)} aria-pressed={cover === m.id} className={cn("absolute inset-x-0 bottom-0 py-1 text-xs font-semibold", cover === m.id ? "bg-primary text-primary-foreground" : "bg-surface/90")}>{cover === m.id ? "Portada ✓" : "Usar de portada"}</button> : null}
                                </li>
                              );
                            })}
                          </ul>
                        ) : <p className="text-sm text-muted-foreground">Sin fotos listas en esta visita.</p>}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            {publish.isError ? <Alert tone={conflict ? "warning" : "danger"} live="assertive" title={conflict ? "La publicación cambió" : undefined}>{conflict ? "Recargamos el estado vigente. Revisa y vuelve a intentarlo." : errorMessage(publish.error)}</Alert> : null}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" disabled={!valid} loading={publish.isPending}>{pub?.revision ? "Actualizar publicación" : visibility === "PRIVATE" ? "Guardar selección" : "Publicar…"}</Button>
              {!valid ? <span className="text-sm text-muted-foreground">{!d.canPublish ? d.blockedReason : selectedCount === 0 ? "Elige al menos una visita." : "Escribe un título."}</span> : null}
            </div>
          </div>
        </form>
      )}

      <Dialog open={confirm} onClose={() => setConfirm(false)} title={pub?.revision ? "Actualizar publicación" : "Confirmar publicación"} description="Revisa qué se va a mostrar."
        footer={<><Button variant="ghost" onClick={() => setConfirm(false)}>Revisar</Button><Button loading={publish.isPending} onClick={() => publish.mutate()}>{visibility === "PRIVATE" ? "Guardar" : visibility === "UNLISTED" ? "Publicar solo con enlace" : "Publicar en la comunidad"}</Button></>}>
        <dl className="grid grid-cols-2 gap-y-1.5 text-sm">
          <dt className="text-muted-foreground">Visibilidad</dt><dd className="font-semibold">{VISIBILITY_LABEL[visibility]}</dd>
          <dt className="text-muted-foreground">Visitas</dt><dd>{selectedCount}</dd>
          <dt className="text-muted-foreground">Fotos</dt><dd>{photoCount}</dd>
          <dt className="text-muted-foreground">Notas incluidas</dt><dd>{d.candidates.filter((c) => entries[c.visitId]?.include && entries[c.visitId]?.includeNote && c.note).length}</dd>
          <dt className="text-muted-foreground">Trayecto GPS</dt><dd>{exactTrack ? "Sí (simplificado)" : "No"}</dd>
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">Se publica una copia de lo que elegiste. Si luego editas tu diario, la publicación no cambia hasta que la actualices. Tus originales con EXIF nunca se muestran.</p>
        {publish.isError && !conflict ? <Alert tone="danger" live="assertive" className="mt-3">{errorMessage(publish.error)}</Alert> : null}
      </Dialog>
    </>
  );
}
