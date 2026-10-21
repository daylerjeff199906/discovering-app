import type { PublicRouteDto } from "@por-aqui/contracts";
import { Alert, Avatar, Badge, Button, Card, Dialog, EmptyState, Field, JourneyTrail, Lightbox, Select, Tabs, Textarea, type TrailItem } from "@por-aqui/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, Copy, Flag, Share2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { api, errorMessage } from "../lib/api";
import { useMe } from "../lib/auth";
import { formatDate, uuid } from "../lib/format";
import { interestsQuery, qk } from "../lib/query";
import { useUi } from "../lib/stores";
import { MapPanel, type MapMarker } from "./map";

const REPORT_REASONS = [
  ["INAPPROPRIATE", "Contenido inapropiado"],
  ["PRIVACY", "Muestra datos privados"],
  ["SPAM", "Spam o publicidad"],
  ["COPYRIGHT", "Derechos de autor"],
  ["OTHER", "Otro motivo"],
] as const;

export function StoryView({ route, shareToken }: { route: PublicRouteDto; shareToken?: string }) {
  const { me } = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const loc = useLocation();
  const [view, setView] = useState<"trail" | "map">("trail");
  const [gallery, setGallery] = useState<{ item: number; index: number } | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const selected = useUi((s) => s.selectedStopId);
  const select = useUi((s) => s.select);
  const interests = useQuery(interestsQuery());
  const labels = Object.fromEntries((interests.data ?? []).map((i) => [i.slug, i.label]));
  const isShared = Boolean(shareToken);

  const needLogin = () => navigate(`/ingresar?returnTo=${encodeURIComponent(loc.pathname)}`);

  const bookmark = useQuery({ queryKey: qk.bookmark(route.id), queryFn: ({ signal }) => api.bookmarks.status(route.id, { signal }), enabled: Boolean(me) && !isShared });
  const toggle = useMutation<{ bookmarked: boolean }, Error, void>({
    mutationFn: () => (bookmark.data?.bookmarked ? api.bookmarks.remove(route.id) : api.bookmarks.add(route.id)),
    onSuccess: (r) => {
      qc.setQueryData(qk.bookmark(route.id), r);
      void qc.invalidateQueries({ queryKey: qk.bookmarks });
    },
  });
  const copy = useMutation({
    mutationFn: () => api.publications.copy(route.id, { clientMutationId: uuid(), shareToken }),
    onSuccess: (r) => navigate(`/app/viajes/${r.journeyId}/editar?copiado=${r.stopsCopied}&omitidas=${r.skippedStops}`),
  });

  const share = async () => {
    const url = isShared ? window.location.href : `${window.location.origin}/r/${route.slug}`;
    try {
      if (navigator.share) await navigator.share({ title: route.title, url });
      else {
        await navigator.clipboard.writeText(url);
        setNotice("Enlace copiado al portapapeles.");
      }
    } catch {
      /* cancelado por la persona */
    }
  };

  const items: TrailItem[] = useMemo(
    () =>
      route.entries.map((e) => ({
        id: String(e.position),
        title: e.displayName,
        subtitle: [e.locationLabel, e.visitedDate ? formatDate(e.visitedDate) : null, e.locationPrecision === "APPROXIMATE" ? "ubicación aproximada" : e.locationPrecision === "HIDDEN" ? "ubicación oculta" : null].filter(Boolean).join(" · "),
        state: "visited" as const,
        media: e.media.map((m) => ({ src: m.thumbUrl, alt: m.altText ?? m.caption ?? `Foto en ${e.displayName}` })),
        note: e.note,
      })),
    [route.entries],
  );
  const markers: MapMarker[] = route.entries.flatMap((e) => (e.location ? [{ id: String(e.position), lng: e.location.lng, lat: e.location.lat, index: e.position + 1, state: "visited" as const, label: `${e.position + 1}. ${e.displayName}` }] : []));
  const lines = route.track?.map((coords, i) => ({ id: `t${i}`, coords })) ?? [];
  const images = route.entries.flatMap((e, ei) => e.media.map((m, mi) => ({ src: m.url, alt: m.altText ?? m.caption ?? `Foto en ${e.displayName}`, caption: m.caption, ei, mi })));

  return (
    <article>
      <header className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {route.isDemo ? <Badge tone="warning">Contenido de demostración</Badge> : null}
            {isShared ? <Badge tone="accent">Solo con enlace</Badge> : null}
            {route.durationDays ? <Badge tone="sage">{route.durationDays} {route.durationDays === 1 ? "día" : "días"}</Badge> : null}
            {route.transportSummary ? <Badge>{route.transportSummary}</Badge> : null}
          </div>
          <h1 className="text-3xl md:text-5xl">{route.title}</h1>
          {route.locationLabel ? <p className="mt-2 text-lg text-muted-foreground">{route.locationLabel}</p> : null}
          {route.description ? <p className="mt-4 max-w-2xl whitespace-pre-wrap text-lg">{route.description}</p> : null}
          <div className="mt-5 flex items-center gap-3">
            <Avatar name={route.author.displayName} src={route.author.avatarUrl} size={44} />
            <div>
              <Link to={`/u/${route.author.username}`} className="font-semibold text-foreground no-underline hover:underline">{route.author.displayName}</Link>
              <p className="text-sm text-muted-foreground">{route.publishedAt ? `Publicado el ${formatDate(route.publishedAt)}` : null}</p>
            </div>
          </div>
          <div className="mt-6 flex flex-wrap gap-3">
            {!isShared ? (
              <Button variant={bookmark.data?.bookmarked ? "secondary" : "outline"} loading={toggle.isPending} aria-pressed={bookmark.data?.bookmarked ?? false} onClick={() => (me ? toggle.mutate() : needLogin())}>
                {bookmark.data?.bookmarked ? <BookmarkCheck className="size-5" aria-hidden="true" /> : <Bookmark className="size-5" aria-hidden="true" />}
                {bookmark.data?.bookmarked ? "Guardada" : "Guardar inspiración"}
              </Button>
            ) : null}
            <Button variant="outline" onClick={share}><Share2 className="size-5" aria-hidden="true" /> Compartir</Button>
            <Button loading={copy.isPending} onClick={() => (me ? copy.mutate() : needLogin())}><Copy className="size-5" aria-hidden="true" /> Usar como base</Button>
            {!isShared ? <Button variant="ghost" onClick={() => (me ? setReportOpen(true) : needLogin())}><Flag className="size-5" aria-hidden="true" /> Reportar</Button> : null}
          </div>
          <div aria-live="polite">{notice ? <p className="mt-3 text-sm font-semibold text-success">{notice}</p> : null}</div>
          {copy.isError ? <Alert tone="danger" live="assertive" className="mt-3">{errorMessage(copy.error)}</Alert> : null}
          {toggle.isError ? <Alert tone="danger" live="assertive" className="mt-3">{errorMessage(toggle.error)}</Alert> : null}
        </div>
        {route.cover ? <img src={route.cover.url} alt={route.cover.altText ?? `Portada de ${route.title}`} width={960} height={720} className="aspect-[4/3] w-full rounded-card object-cover" /> : null}
      </header>

      <div className="mb-4 lg:hidden">
        <Tabs label="Vista" value={view} onChange={(v) => setView(v as "trail" | "map")} tabs={[{ id: "trail", label: "Recorrido" }, { id: "map", label: "Mapa" }]} />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section aria-labelledby="titulo-recorrido" className={view === "map" ? "max-lg:hidden" : undefined}>
          <h2 id="titulo-recorrido" className="sr-only">Recorrido</h2>
          {items.length === 0 ? <EmptyState title="Esta historia aún no tiene paradas" /> : <JourneyTrail items={items} alternate selectedId={selected} onSelect={select} onMediaClick={(itemId, mi) => setGallery({ item: Number(itemId), index: images.findIndex((im) => im.ei === Number(itemId) && im.mi === mi) })} ariaLabel={`Paradas de ${route.title}`} />}
        </section>

        <aside className={`${view === "trail" ? "max-lg:hidden" : ""} lg:sticky lg:top-24 lg:self-start`} aria-label="Mapa y resumen">
          <MapPanel markers={markers} lines={lines} selectedId={selected} onSelect={select} fitKey={route.slug} className="h-[26rem] lg:h-[28rem]" ariaLabel={`Mapa de ${route.title}`} />
          {markers.length < route.entries.length ? <p className="mt-2 text-xs text-muted-foreground">Algunas paradas no muestran ubicación porque su autor la ocultó.</p> : null}
          <Card className="mt-4 p-4">
            <h3 className="text-lg">Resumen</h3>
            <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
              <dt className="text-muted-foreground">Paradas</dt><dd>{route.entries.length}</dd>
              {route.durationDays ? (<><dt className="text-muted-foreground">Duración</dt><dd>{route.durationDays} {route.durationDays === 1 ? "día" : "días"}</dd></>) : null}
              {route.transportSummary ? (<><dt className="text-muted-foreground">Transporte</dt><dd>{route.transportSummary}</dd></>) : null}
              {route.track ? (<><dt className="text-muted-foreground">Trayecto</dt><dd>Compartido por el autor</dd></>) : null}
            </dl>
            {route.interests.length ? <ul className="m-0 mt-3 flex list-none flex-wrap gap-1.5 p-0">{route.interests.map((i) => <li key={i} className="rounded-full bg-surface-muted px-2.5 py-0.5 text-xs">{labels[i] ?? i}</li>)}</ul> : null}
            <p className="mt-3 text-xs text-muted-foreground">Las fotos, notas y el trayecto pertenecen a su autor. «Usar como base» solo copia las paradas a un borrador tuyo.</p>
          </Card>
        </aside>
      </div>

      <Lightbox images={images} index={gallery && gallery.index >= 0 ? gallery.index : null} onClose={() => setGallery(null)} onIndex={(i) => setGallery({ item: images[i]!.ei, index: i })} />
      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} publicationId={route.id} onDone={() => setNotice("Gracias. Revisaremos la publicación.")} />
    </article>
  );
}

function ReportDialog({ open, onClose, publicationId, onDone }: { open: boolean; onClose: () => void; publicationId: string; onDone: () => void }) {
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number][0]>("INAPPROPRIATE");
  const [detail, setDetail] = useState("");
  const m = useMutation({ mutationFn: () => api.reports.create({ publicationId, reason, detail: detail || null }), onSuccess: () => { onDone(); onClose(); } });
  return (
    <Dialog open={open} onClose={onClose} variant="sheet" title="Reportar esta historia" description="Crea una tarea de moderación. No automatizamos sanciones." footer={<><Button variant="ghost" onClick={onClose}>Cancelar</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Enviar reporte</Button></>}>
      <div className="flex flex-col gap-4">
        <Field label="Motivo">{(c) => <Select {...c} value={reason} onChange={(e) => setReason(e.target.value as typeof reason)}>{REPORT_REASONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select>}</Field>
        <Field label="Detalle (opcional)">{(c) => <Textarea {...c} value={detail} maxLength={1000} onChange={(e) => setDetail(e.target.value)} />}</Field>
        {m.isError ? <Alert tone="danger" live="assertive">{errorMessage(m.error)}</Alert> : null}
      </div>
    </Dialog>
  );
}

