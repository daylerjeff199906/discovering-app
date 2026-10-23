import { ApiError } from "@por-aqui/api-client";
import type { RecordingDto } from "@por-aqui/contracts";
import { Alert, Badge, Button, Dialog, EmptyState, Field, Input, JourneyTrail, Lightbox, buttonClass, type TrailItem } from "@por-aqui/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Crosshair, MapPinPlus, Pause, Play, RefreshCw, WifiOff } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { MapPanel, type MapLine, type MapMarker } from "../components/map";
import { LoadingBlock, PageHeader, QueryError } from "../components/shell";
import { StartAdventure, type AdventureMode } from "../components/start-adventure";
import { api, errorMessage } from "../lib/api";
import { useMe } from "../lib/auth";
import { browserTimezone, formatDateTime, STATUS_LABEL, STATUS_TONE, uuid } from "../lib/format";
import { useJourney } from "../lib/journey-hooks";
import { discardPending, pendingCounts, segmentWatermarks } from "../lib/offline-queue";
import { capabilitiesQuery, qk, visitsQuery } from "../lib/query";
import { TrackRecorder, type GpsStatus } from "../lib/recorder";
import { flushAll, submitVisit } from "../lib/recording-sync";
import { seoMeta } from "../lib/seo";
import { useUi } from "../lib/stores";
import { flattenStops, stopStates } from "../lib/trail";
import type { Route } from "./+types/app.viajes.$id.recorrido";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Recorrido en vivo — Por aquí", noindex: true });
}

const GPS_TEXT: Record<GpsStatus, string> = {
  idle: "GPS apagado. Puedes registrar visitas a mano sin GPS.",
  asking: "Esperando el permiso de ubicación del navegador…",
  tracking: "Registrando el trayecto (con la pantalla activa).",
  denied: "Permiso de ubicación denegado. Sigue registrando visitas a mano.",
  unavailable: "Este dispositivo no ofrece geolocalización.",
  error: "No se pudo obtener la ubicación. Se reintentará.",
  full: "La cola local está llena: conéctate para sincronizar antes de seguir.",
};

export default function Recorrido() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { me } = useMe();
  const userId = me?.id ?? "";
  const journey = useJourney(id);
  const visits = useQuery({ ...visitsQuery(id), enabled: Boolean(journey.data) });
  const caps = useQuery(capabilitiesQuery());
  const rec = journey.data?.recording ?? null;
  const select = useUi((s) => s.select);
  const selected = useUi((s) => s.selectedStopId);
  const announce = useUi((s) => s.announce);
  const [view, setView] = useState<"trail" | "map">("trail");

  const [gps, setGps] = useState<GpsStatus>("idle");
  const [gpsDetail, setGpsDetail] = useState("");
  const [live, setLive] = useState<[number, number][]>([]);
  const recorder = useRef<TrackRecorder | null>(null);
  const wasTracking = useRef(false);
  const [online, setOnline] = useState(true);
  const [counts, setCounts] = useState({ points: 0, visits: 0, failedVisits: 0 });
  const [syncing, setSyncing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [finishTitle, setFinishTitle] = useState("");
  const [finishVisibility, setFinishVisibility] = useState<"PRIVATE" | "PUBLIC">("PRIVATE");
  const [pendingDialog, setPendingDialog] = useState<null | { points: number; visits: number }>(null);
  const [gallery, setGallery] = useState<{ urls: { src: string; alt: string }[]; index: number } | null>(null);

  const refreshCounts = useCallback(async () => {
    if (userId && rec) setCounts(await pendingCounts(userId, rec.id, id));
  }, [userId, rec, id]);

  const sync = useCallback(async () => {
    if (!userId || !rec) return;
    setSyncing(true);
    try {
      const r = await flushAll(userId, id, rec.id);
      setOnline(r.online);
      setCounts(r.remaining);
      if (r.sentVisits) void qc.invalidateQueries({ queryKey: qk.visits(id) });
      if (r.sentPoints) void qc.invalidateQueries({ queryKey: ["track", rec.id] });
    } finally {
      setSyncing(false);
    }
  }, [userId, rec, id, qc]);

  // Sincronización periódica y al volver la conexión
  useEffect(() => {
    if (!rec || rec.status === "COMPLETED") return;
    void refreshCounts();
    void sync();
    const t = setInterval(() => void sync(), 15_000);
    const on = () => { setOnline(true); void sync(); };
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    setOnline(navigator.onLine);
    return () => { clearInterval(t); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [rec?.id, rec?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Avisar antes de cerrar la pestaña si quedan datos sin sincronizar
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (counts.points + counts.visits > 0) e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [counts]);

  useEffect(() => () => recorder.current?.stop(), []);

  const startGps = (recording: RecordingDto | null = rec) => {
    if (!recording || !userId) return;
    const cfg = { maxAccuracyM: caps.data?.track.maxAccuracyM ?? 100, minDistanceM: caps.data?.track.minDistanceM ?? 5, gapMs: 60_000 };
    recorder.current?.stop();
    recorder.current = new TrackRecorder(userId, recording.id, cfg, {
      onStatus: (s, d) => { setGps(s); setGpsDetail(d ?? ""); },
      onPoint: (p) => { setLive((l) => [...l.slice(-1999), [p.lng, p.lat]]); void refreshCounts(); },
    });
    recorder.current.start();
    wasTracking.current = true;
  };
  const stopGps = () => {
    recorder.current?.stop();
    wasTracking.current = false;
    setLive([]);
    void sync();
  };

  const track = useQuery({ queryKey: ["track", rec?.id], queryFn: ({ signal }) => api.recording.track(rec!.id, { signal }), enabled: Boolean(rec), refetchInterval: gps === "tracking" ? 20_000 : false });

  const pause = useMutation({ mutationFn: async () => { const was = gps === "tracking"; recorder.current?.stop(); wasTracking.current = was; await sync(); return api.recording.pause(id); }, onSuccess: () => { void qc.invalidateQueries({ queryKey: qk.journey(id) }); announce("Recorrido en pausa"); } });
  const resume = useMutation({ mutationFn: () => api.recording.resume(id), onSuccess: async () => { await qc.invalidateQueries({ queryKey: qk.journey(id) }); announce("Recorrido reanudado"); if (wasTracking.current) setTimeout(startGps, 100); } });
  const start = useMutation({ mutationFn: async (choice: { mode: AdventureMode; gps: boolean }) => {
    const current = journey.data!;
    const updated = await api.journeys.update(id, { expectedVersion: current.version, preferences: { ...current.preferences, explorationMode: choice.mode } });
    qc.setQueryData(qk.journey(id), updated);
    return api.recording.start(id);
  }, onSuccess: async (recording, choice) => {
    if (choice.gps) startGps(recording);
    await Promise.all([qc.invalidateQueries({ queryKey: qk.journey(id) }), qc.invalidateQueries({ queryKey: ["journeys"] })]);
  } });

  const finish = useMutation({
    mutationFn: async (discard: boolean) => {
      if (!finishTitle.trim()) throw new Error("Escribe un título para guardar el recorrido.");
      recorder.current?.stop();
      if (discard && userId && rec) await discardPending(userId, rec.id, id);
      else await sync();
      const watermarks = discard ? {} : userId && rec ? await segmentWatermarks(userId, rec.id) : {};
      if (journey.data && finishTitle.trim() !== journey.data.title) {
        const updated = await api.journeys.update(id, { expectedVersion: journey.data.version, title: finishTitle.trim() });
        qc.setQueryData(qk.journey(id), updated);
      }
      return api.recording.finish(id, { watermarks, discardPending: discard });
    },
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["journeys"] }); navigate(finishVisibility === "PRIVATE" ? `/app/viajes/${id}?finalizado=1` : `/app/viajes/${id}/compartir?visibilidad=PUBLIC&ocultarTrayecto=1`); },
    onError: async (err) => {
      if (err instanceof ApiError && err.code === "PENDING_TRACK_DATA") {
        const c = userId && rec ? await pendingCounts(userId, rec.id, id) : { points: 0, visits: 0, failedVisits: 0 };
        setFinishOpen(false);
        setPendingDialog({ points: c.points, visits: c.visits });
      }
    },
  });
  const tryFinish = async () => {
    // Antes de cerrar: sincronizar; si queda algo local, el servidor/UI lo informan.
    await sync();
    if (userId && rec) {
      const c = await pendingCounts(userId, rec.id, id);
      if (c.points + c.visits > 0) {
        setFinishOpen(false);
        setPendingDialog({ points: c.points, visits: c.visits });
        return;
      }
    }
    finish.mutate(false);
  };

  const quickVisit = useMutation({
    mutationFn: async (stop: { id: string; placeId: string; name: string }) => {
      if (!rec) throw new Error("Sin recorrido");
      return { name: stop.name, ...(await submitVisit(userId, id, rec.id, { clientMutationId: uuid(), placeId: stop.placeId, stopId: stop.id, visitedAt: new Date().toISOString(), timezone: browserTimezone() })) };
    },
    onSuccess: (r) => {
      setNotice(r.status === "saved" ? `Visita en «${r.name}» registrada.` : `Sin conexión: guardamos «${r.name}» en este dispositivo y se enviará al reconectar.`);
      announce(`Visita en ${r.name} registrada`);
      void qc.invalidateQueries({ queryKey: qk.visits(id) });
      void refreshCounts();
    },
  });

  const j = journey.data;
  const states = useMemo(() => (j ? stopStates(j, visits.data ?? []) : new Map()), [j, visits.data]);
  const stops = useMemo(() => (j && j.preferences.explorationMode !== "FREE" ? flattenStops(j) : []), [j]);

  if (journey.isPending) return <LoadingBlock label="Cargando el recorrido…" />;
  if (journey.isError || !j) return <QueryError error={journey.error} retry={() => journey.refetch()} />;

  if (!rec) {
    if (j.status === "ARCHIVED") return <EmptyState title="Este viaje está archivado" action={<Link to="/app/viajes" className={buttonClass({})}>Volver a mis viajes</Link>}>Desarchívalo desde Mis viajes para iniciar el recorrido.</EmptyState>;
    return (
      <StartAdventure journeyId={id} hasStops={flattenStops(j).length > 0} defaultFree={j.creationMode === "FREE" || j.preferences.explorationMode === "FREE"} pending={start.isPending} error={start.error} onStart={(choice) => start.mutate(choice)} />
    );
  }
  if (rec.status === "COMPLETED") {
    return (
      <EmptyState title="Este recorrido ya terminó" action={<Link to={`/app/viajes/${id}`} className={buttonClass({})}>Ver el diario</Link>}>
        Si quieres añadir una visita olvidada, hazlo desde el diario como visita pasada.
      </EmptyState>
    );
  }

  const byStop = new Map<string, typeof visits.data>();
  for (const v of visits.data ?? []) if (v.stopId) byStop.set(v.stopId, [...(byStop.get(v.stopId) ?? []), v]);
  const planItems: TrailItem[] = stops.map((s) => {
    const vs = byStop.get(s.id) ?? [];
    const last = vs[vs.length - 1];
    return {
      id: s.id,
      title: s.place.name,
      subtitle: last ? `Visitado ${formatDateTime(last.visitedAt, last.timezone)}${vs.length > 1 ? ` · ${vs.length} visitas` : ""}` : s.place.locality,
      state: states.get(s.id) ?? "pending",
      note: last?.note,
      media: last?.media.filter((m) => m.status === "READY").map((m) => ({ src: m.thumbUrl!, alt: m.caption ?? `Foto en ${s.place.name}` })),
      actions: (
        <>
          <Button size="sm" loading={quickVisit.isPending && quickVisit.variables?.id === s.id} disabled={rec.status === "PAUSED"} onClick={() => quickVisit.mutate({ id: s.id, placeId: s.placeId, name: s.place.name })}>
            <CheckCircle2 className="size-4" aria-hidden="true" /> {last ? "Otra visita aquí" : "Confirmar visita"}
          </Button>
          {last ? <Link to={`/app/viajes/${id}/visitas/${last.id}`} className={buttonClass({ variant: "outline", size: "sm" })}>Fotos y nota</Link> : null}
        </>
      ),
    };
  });
  const freeVisits = (visits.data ?? []).filter((v) => j.preferences.explorationMode === "FREE" || !v.stopId);
  const freeItems: TrailItem[] = freeVisits.map((v) => ({
    id: v.id,
    title: v.place.name,
    subtitle: formatDateTime(v.visitedAt, v.timezone),
    state: "visited",
    note: v.note,
    media: v.media.filter((m) => m.status === "READY").map((m) => ({ src: m.thumbUrl!, alt: m.caption ?? `Foto en ${v.place.name}` })),
    actions: <Link to={`/app/viajes/${id}/visitas/${v.id}`} className={buttonClass({ variant: "outline", size: "sm" })}>Fotos y nota</Link>,
  }));

  const markers: MapMarker[] = [
    ...stops.map((s) => ({ id: s.id, lng: s.place.lng, lat: s.place.lat, index: s.index, state: states.get(s.id) ?? "pending", label: `${s.index}. ${s.place.name}` }) satisfies MapMarker),
    ...freeVisits.map((v, i) => ({ id: v.id, lng: v.place.lng, lat: v.place.lat, index: stops.length + i + 1, state: "visited" as const, label: v.place.name })),
  ];
  const lines: MapLine[] = [...(track.data?.segments.map((s) => ({ id: s.id, coords: s.points.map((p) => [p.lng, p.lat] as [number, number]) })) ?? []), ...(live.length > 1 ? [{ id: "live", coords: live }] : [])];
  const nextStop = stops.find((s) => states.get(s.id) === "current");
  const totalPending = counts.points + counts.visits;
  const photos = (visits.data ?? []).reduce((a, v) => a + v.media.filter((m) => m.status === "READY").length, 0);

  return (
    <>
      <PageHeader
        title={j.title}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge>{nextStop ? <span>Siguiente: <strong>{nextStop.place.name}</strong></span> : <span>Registra lo que vayas visitando.</span>}</span>}
        actions={
          <>
            <Link to={`/app/viajes/${id}/visitas/nueva`} className={buttonClass({ variant: "secondary" })}><MapPinPlus className="size-5" aria-hidden="true" /> Añadir otro lugar</Link>
            {rec.status === "ACTIVE" ? <Button variant="outline" loading={pause.isPending} onClick={() => pause.mutate()}><Pause className="size-5" aria-hidden="true" /> Pausar</Button> : <Button variant="outline" loading={resume.isPending} onClick={() => resume.mutate()}><Play className="size-5" aria-hidden="true" /> Reanudar</Button>}
            <Button onClick={() => { setFinishTitle(j.title); setFinishOpen(true); }}>Finalizar</Button>
          </>
        }
      />

      {rec.status === "PAUSED" ? <Alert tone="warning" className="mb-4" title="Recorrido en pausa">La captura de trayecto está detenida. Reanuda para seguir confirmando visitas y registrando el GPS.</Alert> : null}
      {!online ? <Alert tone="warning" className="mb-4" title={<span className="inline-flex items-center gap-2"><WifiOff className="size-4" aria-hidden="true" /> Sin conexión</span>}>Sigue registrando: guardamos visitas y puntos en este dispositivo y los enviaremos al reconectar. Las fotos necesitan conexión.</Alert> : null}
      {notice ? <Alert tone="success" className="mb-4">{notice}</Alert> : null}
      {quickVisit.isError ? <Alert tone="danger" className="mb-4" live="assertive">{errorMessage(quickVisit.error)}</Alert> : null}
      {pause.isError || resume.isError ? <Alert tone="danger" className="mb-4" live="assertive">{errorMessage(pause.error ?? resume.error)}</Alert> : null}

      <section aria-label="Trayecto GPS" className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-card border border-border bg-surface p-4">
        <div className="min-w-0">
          <p className="font-semibold"><Crosshair className="mr-1.5 inline size-4" aria-hidden="true" />Registrar trayecto (GPS)</p>
          <p role="status" className="text-sm text-muted-foreground">{GPS_TEXT[gps]}{gpsDetail ? ` (${gpsDetail})` : ""}</p>
          <p className="mt-1 text-xs text-muted-foreground">Solo funciona en primer plano: si bloqueas la pantalla o el navegador suspende la pestaña, la captura se interrumpe y se abre un nuevo segmento al reanudar.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {totalPending > 0 || counts.failedVisits > 0 ? (
            <p className="text-sm font-semibold text-warning" role="status">
              {counts.points} punto(s) y {counts.visits} visita(s) pendientes de sincronizar{counts.failedVisits ? ` · ${counts.failedVisits} con error` : ""}
            </p>
          ) : <p className="text-sm text-success" role="status">Todo sincronizado ✓</p>}
          <Button size="sm" variant="outline" loading={syncing} onClick={() => void sync()}><RefreshCw className="size-4" aria-hidden="true" /> Sincronizar</Button>
          {gps === "tracking" || gps === "asking" ? <Button size="sm" variant="outline" onClick={stopGps}>Detener GPS</Button> : <Button size="sm" disabled={rec.status !== "ACTIVE"} onClick={() => startGps()}>Activar GPS</Button>}
        </div>
      </section>

      <div className="mb-4 flex gap-2 lg:hidden" role="tablist" aria-label="Vista">
        {(["trail", "map"] as const).map((v) => <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} className={`min-h-11 flex-1 rounded-control px-4 font-semibold ${view === v ? "bg-sage text-sage-foreground" : "bg-surface-muted"}`}>{v === "trail" ? "Recorrido" : "Mapa"}</button>)}
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <section aria-label="Recorrido" className={view === "map" ? "max-lg:hidden" : undefined}>
          {planItems.length > 0 ? <JourneyTrail items={planItems} selectedId={selected} onSelect={select} onMediaClick={(itemId, mi) => { const it = planItems.find((p) => p.id === itemId); if (it?.media) setGallery({ urls: it.media.map((m) => ({ src: m.src.replace("variant=thumb", "variant=display"), alt: m.alt })), index: mi }); }} ariaLabel="Paradas del plan" /> : null}
          {freeItems.length > 0 ? (
            <div className="mt-8">
              <h2 className="mb-3 text-2xl">{planItems.length ? "Otros lugares que visitaste" : "Lo que has visitado"}</h2>
              <JourneyTrail items={freeItems} selectedId={selected} onSelect={select} ariaLabel="Lugares añadidos durante el recorrido" />
            </div>
          ) : null}
          {planItems.length === 0 && freeItems.length === 0 ? (
            <EmptyState title="Aún no registras nada" icon={<MapPinPlus className="size-8" />} action={<Link to={`/app/viajes/${id}/visitas/nueva`} className={buttonClass({})}>Registrar mi primera visita</Link>}>
              Elige un lugar, añade una nota y, si quieres, fotos. Puedes hacerlo sin GPS.
            </EmptyState>
          ) : null}
        </section>
        <aside className={`${view === "trail" ? "max-lg:hidden" : ""} lg:sticky lg:top-24 lg:self-start`} aria-label="Mapa">
          <MapPanel markers={markers} lines={lines} selectedId={selected} onSelect={select} fitKey={`${markers.length}`} className="h-[26rem] lg:h-[32rem]" ariaLabel="Mapa del recorrido en vivo" />
          <p className="mt-2 text-xs text-muted-foreground">Pasar cerca de un lugar no cuenta como visita: tú la confirmas.</p>
        </aside>
      </div>

      <Dialog open={finishOpen} onClose={() => { if (!finish.isPending) setFinishOpen(false); }} title="Finalizar recorrido" className="finish-journey-dialog" footer={<><Button variant="outline" disabled={finish.isPending} onClick={() => setFinishOpen(false)}>Seguir explorando</Button><Button disabled={!finishTitle.trim()} loading={finish.isPending} onClick={() => void tryFinish()}>{finishVisibility === "PRIVATE" ? "Guardar recorrido" : "Guardar y revisar publicación"}</Button></>}>
        <h3 className="text-2xl mb-2">{j.title}</h3><p className="text-sm text-muted-foreground mb-4">{j.preferences.destinationLabel}</p>
        {visits.data?.flatMap((v) => v.media).find((m) => m.status === "READY")?.displayUrl ? <img className="finish-journey-cover" src={visits.data.flatMap((v) => v.media).find((m) => m.status === "READY")!.displayUrl!} alt="Una foto de tu recorrido" width={650} height={330} /> : null}
        <div className="finish-counts"><span>{visits.data?.length ?? 0} visitas</span><span>{photos} fotos</span></div>
        <Field label="Título del recorrido">{(c) => <Input {...c} value={finishTitle} maxLength={120} disabled={finish.isPending} onChange={(e) => setFinishTitle(e.target.value)} />}</Field>
        <fieldset className="finish-visibility" disabled={finish.isPending}><legend>Visibilidad</legend><label><input type="radio" name="finish-visibility" checked={finishVisibility === "PRIVATE"} onChange={() => setFinishVisibility("PRIVATE")} />Privado</label><label><input type="radio" name="finish-visibility" checked={finishVisibility === "PUBLIC"} onChange={() => setFinishVisibility("PUBLIC")} />Público</label></fieldset>
        <p className="text-sm text-muted-foreground mb-5">{finishVisibility === "PRIVATE" ? "Solo tú puedes verlo." : "Revisarás qué visitas, notas y fotos publicar antes de compartirlo."}</p>
        <dl className="grid grid-cols-2 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Visitas registradas</dt><dd>{visits.data?.length ?? 0}</dd>
          <dt className="text-muted-foreground">Fotos</dt><dd>{photos}</dd>
          <dt className="text-muted-foreground">Paradas del plan sin visitar</dt><dd>{stops.filter((s) => states.get(s.id) !== "visited").length}</dd>
          <dt className="text-muted-foreground">Pendiente de sincronizar</dt><dd>{totalPending ? `${counts.points} puntos, ${counts.visits} visitas` : "Nada"}</dd>
        </dl>
        <p className="mt-3 text-sm text-muted-foreground">Después podrás decidir si tu historia queda privada, se comparte por enlace o se publica. Podrás seguir añadiendo visitas pasadas al diario.</p>
        {finish.isError && !(finish.error instanceof ApiError && finish.error.code === "PENDING_TRACK_DATA") ? <Alert tone="danger" live="assertive" className="mt-3">{errorMessage(finish.error)}</Alert> : null}
      </Dialog>

      <Dialog open={pendingDialog !== null} onClose={() => setPendingDialog(null)} title="Quedan datos sin sincronizar" description="No queremos que pierdas nada en silencio." footer={<><Button variant="danger" loading={finish.isPending && finish.variables === true} onClick={() => { setPendingDialog(null); finish.mutate(true); }}>Descartar y finalizar</Button><Button loading={syncing} onClick={async () => { await sync(); const c = userId && rec ? await pendingCounts(userId, rec.id, id) : { points: 0, visits: 0, failedVisits: 0 }; if (c.points + c.visits === 0) { setPendingDialog(null); finish.mutate(false); } else setPendingDialog({ points: c.points, visits: c.visits }); }}>Reintentar sincronizar</Button></>}>
        <p>En este dispositivo quedan <strong>{pendingDialog?.points ?? 0} punto(s) de trayecto</strong> y <strong>{pendingDialog?.visits ?? 0} visita(s)</strong> que no llegaron al servidor{online ? "" : " (sin conexión)"}.</p>
        <p className="mt-2 text-sm text-muted-foreground">Conéctate y reintenta. Si prefieres seguir sin ellos, descártalos explícitamente: no se podrán recuperar.</p>
      </Dialog>
      <Lightbox images={gallery?.urls ?? []} index={gallery?.index ?? null} onClose={() => setGallery(null)} onIndex={(i) => gallery && setGallery({ ...gallery, index: i })} />
    </>
  );
}
