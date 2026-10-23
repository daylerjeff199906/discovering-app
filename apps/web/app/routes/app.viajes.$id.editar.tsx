import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import type { JourneyPreferences } from "@por-aqui/contracts";
import { Alert, Button, Card, EmptyState, JourneyTrail, buttonClass, type TrailItem } from "@por-aqui/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, GripVertical, Plus, Trash2, Wand2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { AddStopDialog } from "../components/add-stop-dialog";
import { MapPanel, type MapMarker } from "../components/map";
import { PreferencesPanel } from "../components/preferences-panel";
import { ProposalDialog } from "../components/proposal-dialog";
import { SaveIndicator } from "../components/save-indicator";
import { LoadingBlock, PageHeader, QueryError } from "../components/shell";
import { api, errorMessage } from "../lib/api";
import { formatDuration, STATUS_LABEL, STATUS_TONE } from "../lib/format";
import { useJourney, useJourneyMutation } from "../lib/journey-hooks";
import { capabilitiesQuery, qk, visitsQuery } from "../lib/query";
import { useUi } from "../lib/stores";
import { applyLayout, connectorFor, flattenStops, layoutOf, moveStop, shiftStop, stopStates, summarize } from "../lib/trail";
import { seoMeta } from "../lib/seo";
import { Badge } from "@por-aqui/ui";
import type { Route } from "./+types/app.viajes.$id.editar";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Editar viaje — Por aquí", noindex: true });
}

function DragHandle({ id, label }: { id: string; label: string }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id });
  return (
    <button ref={setNodeRef} type="button" {...attributes} {...listeners} aria-label={`Arrastrar ${label}. También puedes usar los botones Subir y Bajar.`} className={`inline-flex size-10 touch-none items-center justify-center rounded-control border border-control-border bg-surface text-muted-foreground hover:bg-surface-muted ${isDragging ? "opacity-50" : ""}`}>
      <GripVertical className="size-5" aria-hidden="true" />
    </button>
  );
}

function DropTarget({ id, children, className }: { id: string; children: React.ReactNode; className?: string }) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return <div ref={setNodeRef} className={`${className ?? ""} ${isOver ? "rounded-card outline outline-2 outline-dashed outline-primary" : ""}`}>{children}</div>;
}

export default function EditarViaje() {
  const { id = "" } = useParams();
  const [search] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const journey = useJourney(id);
  const visits = useQuery({ ...visitsQuery(id), enabled: Boolean(journey.data) });
  const caps = useQuery(capabilitiesQuery());
  const selected = useUi((s) => s.selectedStopId);
  const select = useUi((s) => s.select);
  const announce = useUi((s) => s.announce);
  const setSave = useUi((s) => s.setSaveState);
  const mapOpen = useUi((s) => s.mapOpen);
  const setMapOpen = useUi((s) => s.setMapOpen);

  const [conflict, setConflict] = useState(false);
  const [addToDay, setAddToDay] = useState<string | null>(null);
  const [proposalOpen, setProposalOpen] = useState(false);
  const onConflict = useCallback(() => setConflict(true), []);

  /* ───────── Mutaciones (en serie, con la versión vigente) ───────── */
  const update = useJourneyMutation(id, (v: { title?: string; preferences?: JourneyPreferences; planStatus?: "DRAFT" | "READY" }, j) => api.journeys.update(id, { ...v, expectedVersion: j.version }), { onConflict });
  const addStop = useJourneyMutation(id, (v: { dayId: string; placeId: string }, j) => api.journeys.addStop(id, { ...v, expectedVersion: j.version }), { onConflict });
  const removeStop = useJourneyMutation(id, (stopId: string, j) => api.journeys.deleteStop(id, stopId, j.version), { onConflict });
  const setDuration = useJourneyMutation(id, (v: { stopId: string; seconds: number | null }, j) => api.journeys.updateStop(id, v.stopId, { visitDurationSeconds: v.seconds, expectedVersion: j.version }), { onConflict });
  const addDay = useJourneyMutation(id, (_: void, j) => api.journeys.addDay(id, { expectedVersion: j.version }), { onConflict });
  const removeDay = useJourneyMutation(id, (dayId: string, j) => api.journeys.deleteDay(id, dayId, j.version), { onConflict });
  const reorder = useJourneyMutation(id, (layout: ReturnType<typeof layoutOf>, j) => api.journeys.reorder(id, { layout, expectedVersion: j.version }), { onConflict });


  /* ───────── Tramos: se recalculan solo si hay proveedor (debounce) ───────── */
  const recalcTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scheduleRecalc = useCallback(() => {
    if (!caps.data?.routing.available) return;
    if (recalcTimer.current) clearTimeout(recalcTimer.current);
    recalcTimer.current = setTimeout(async () => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      try {
        const r = await api.journeys.recalculateLegs(id, { signal: abortRef.current.signal });
        if (r.applied) qc.setQueryData(qk.journey(id), r.journey);
      } catch {
        /* cancelado o sin red: los tramos quedan «Por definir» */
      }
    }, 700);
  }, [caps.data?.routing.available, id, qc]);
  useEffect(() => () => { if (recalcTimer.current) clearTimeout(recalcTimer.current); abortRef.current?.abort(); }, []);

  /* ───────── Autoguardado de título y preferencias ───────── */
  const [draft, setDraft] = useState<{ title: string; prefs: JourneyPreferences } | null>(null);
  const dirty = useRef(false);
  useEffect(() => {
    if (journey.data && !draft) setDraft({ title: journey.data.title, prefs: journey.data.preferences });
  }, [journey.data, draft]);
  const flush = useCallback(() => {
    if (!draft || !dirty.current) return;
    dirty.current = false;
    update.mutate({ title: draft.title.trim() || "Mi viaje", preferences: draft.prefs }, { onSuccess: () => scheduleRecalc() });
  }, [draft, update, scheduleRecalc]);
  useEffect(() => {
    if (!dirty.current) return;
    setSave("pending");
    const t = setTimeout(flush, 800);
    return () => clearTimeout(t);
  }, [draft, flush, setSave]);
  useEffect(() => {
    const on = () => flush();
    window.addEventListener("online", on);
    return () => window.removeEventListener("online", on);
  }, [flush]);
  const edit = (next: Partial<{ title: string; prefs: JourneyPreferences }>) => {
    dirty.current = true;
    setDraft((d) => (d ? { ...d, ...next } : d));
  };

  /* ───────── Reordenar (arrastrar, o botones Subir / Bajar) ───────── */
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const doReorder = (layout: ReturnType<typeof layoutOf>, message: string) => {
    const j = journey.data;
    if (!j) return;
    qc.setQueryData(qk.journey(id), applyLayout(j, layout)); // optimista
    reorder.mutate(layout, { onSuccess: () => { announce(message); scheduleRecalc(); }, onError: () => void qc.invalidateQueries({ queryKey: qk.journey(id) }) });
  };
  const onDragEnd = (e: DragEndEvent) => {
    const j = journey.data;
    if (!j || !e.over || e.active.id === e.over.id) return;
    const layout = layoutOf(j);
    const overId = String(e.over.id);
    let target: ReturnType<typeof layoutOf>;
    if (overId.startsWith("day:")) {
      const dayId = overId.slice(4);
      target = moveStop(layout, String(e.active.id), dayId, Number.MAX_SAFE_INTEGER);
    } else {
      const day = layout.find((d) => d.stopIds.includes(overId));
      if (!day) return;
      target = moveStop(layout, String(e.active.id), day.dayId, day.stopIds.indexOf(overId));
    }
    const name = flattenStops(j).find((s) => s.id === e.active.id)?.place.name ?? "La parada";
    doReorder(target, `${name} se movió`);
  };
  const shift = (stopId: string, delta: -1 | 1, name: string) => {
    const j = journey.data;
    if (!j) return;
    const next = shiftStop(layoutOf(j), stopId, delta);
    if (next) doReorder(next, `${name} ahora está en la posición ${next.flatMap((d) => d.stopIds).indexOf(stopId) + 1}`);
  };

  const j = journey.data;
  const states = useMemo(() => (j ? stopStates(j, visits.data ?? []) : new Map()), [j, visits.data]);
  const flat = useMemo(() => (j ? flattenStops(j) : []), [j]);
  const markers: MapMarker[] = flat.map((s) => ({ id: s.id, lng: s.place.lng, lat: s.place.lat, index: s.index, state: states.get(s.id) ?? "pending", label: `${s.index}. ${s.place.name}` }));
  const sum = j ? summarize(j) : null;

  if (journey.isPending) return <LoadingBlock label="Cargando tu viaje…" />;
  if (journey.isError || !j || !draft) return <QueryError error={journey.error} retry={() => journey.refetch()} />;
  const locked = j.status === "ARCHIVED";
  const copied = search.get("copiado");

  return (
    <>
      <PageHeader
        title={
          <input aria-label="Título del viaje" value={draft.title} maxLength={120} disabled={locked} onChange={(e) => edit({ title: e.target.value })} onBlur={flush} className="w-full max-w-2xl rounded-control border border-transparent bg-transparent px-1 font-serif text-3xl hover:border-control-border focus:border-control-border md:text-4xl" />
        }
        subtitle={<span className="flex flex-wrap items-center gap-3"><Badge tone={STATUS_TONE[j.status]}>{STATUS_LABEL[j.status]}</Badge><SaveIndicator /></span>}
        actions={
          <>
            <Link to={`/app/viajes/${id}`} className={buttonClass({ variant: "ghost" })}>Ver resumen</Link>
            <Button variant="outline" loading={update.isPending} disabled={locked || j.planStatus === "READY"} onClick={() => update.mutate({ planStatus: "READY" })}>{j.planStatus === "READY" ? "Plan guardado ✓" : "Guardar plan"}</Button>
            {j.status === "COMPLETED" ? null : <Button disabled={locked} onClick={() => navigate(`/app/viajes/${id}/recorrido`)}>{j.recording ? "Continuar recorrido" : "Iniciar recorrido"}</Button>}
          </>
        }
      />

      {copied ? <Alert tone="success" className="mb-4" title="Copiamos las paradas a tu borrador">{`${copied} paradas copiadas. No se copian fotos, notas ni trayectos de la otra persona.${Number(search.get("omitidas")) > 0 ? ` ${search.get("omitidas")} parada(s) no se copiaron porque su autor ocultó la ubicación.` : ""}`}</Alert> : null}
      {conflict ? (
        <Alert tone="warning" live="assertive" className="mb-4" title="Este viaje cambió en otra pestaña o dispositivo">
          Cargamos la versión más reciente. Revisa los cambios y vuelve a aplicar lo que necesites.
          <button type="button" className="ml-3 font-semibold underline" onClick={() => { setConflict(false); setDraft(null); dirty.current = false; }}>Entendido</button>
        </Alert>
      ) : null}
      {locked ? <Alert tone="neutral" className="mb-4">Este viaje está archivado. Desarchívalo desde «Mis viajes» para editarlo.</Alert> : null}
      {j.recording ? <Alert tone="sage" className="mb-4">Este viaje ya tiene un recorrido ({j.recording.status === "COMPLETED" ? "finalizado" : "en curso"}). Si cambias el plan, tus visitas registradas se conservan.</Alert> : null}

      <div className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-4">
          <PreferencesPanel value={draft.prefs} onChange={(prefs) => edit({ prefs })} />
          <Button variant="secondary" disabled={locked} onClick={() => setProposalOpen(true)}><Wand2 className="size-5" aria-hidden="true" /> Armar propuesta automática</Button>
        </div>

        <section aria-label="Plan del viaje" className="min-w-0">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <div className="flex flex-col gap-8">
              {j.days.length === 0 ? <EmptyState title="Aún no hay días" action={<Button onClick={() => addDay.mutate()}>Añadir el primer día</Button>}>Un viaje libre empieza vacío. Añade un día para planear paradas, o inicia el recorrido y registra lo que visites.</EmptyState> : null}
              {j.days.map((day, di) => {
                const items: TrailItem[] = day.stops.map((s, i) => ({
                  id: s.id,
                  title: s.place.name,
                  subtitle: [s.place.locality, s.place.scope === "PERSONAL" ? "lugar personal" : null].filter(Boolean).join(" · "),
                  state: states.get(s.id) ?? "pending",
                  connector: connectorFor(j, day.stops, i),
                  actions: locked ? undefined : (
                    <>
                      <DragHandle id={s.id} label={s.place.name} />
                      <Button size="icon" variant="outline" title="Subir parada" aria-label={`Subir ${s.place.name}`} onClick={() => shift(s.id, -1, s.place.name)}><ArrowUp className="size-4" aria-hidden="true" /></Button>
                      <Button size="icon" variant="outline" title="Bajar parada" aria-label={`Bajar ${s.place.name}`} onClick={() => shift(s.id, 1, s.place.name)}><ArrowDown className="size-4" aria-hidden="true" /></Button>
                      <label className="flex items-center gap-1.5 text-sm">
                        <span className="text-muted-foreground">Visita</span>
                        <input aria-label={`Minutos de visita en ${s.place.name}`} type="number" min={1} max={1440} defaultValue={s.visitDurationSeconds ? Math.round(s.visitDurationSeconds / 60) : ""} placeholder="—" onBlur={(e) => { const v = e.target.value ? Number(e.target.value) * 60 : null; if (v !== s.visitDurationSeconds) setDuration.mutate({ stopId: s.id, seconds: v }, { onSuccess: scheduleRecalc }); }} className="h-10 w-20 rounded-control border border-control-border bg-surface px-2" />
                        <span className="text-muted-foreground">min</span>
                      </label>
                      <Button size="icon" variant="ghost" title="Quitar parada" aria-label={`Quitar ${s.place.name}`} onClick={() => removeStop.mutate(s.id, { onSuccess: scheduleRecalc })}><Trash2 className="size-4" aria-hidden="true" /></Button>
                    </>
                  ),
                }));
                return (
                  <div key={day.id}>
                    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                      <h2 className="text-2xl">Día {di + 1}{day.localDate ? <span className="ml-2 text-base font-normal text-muted-foreground">{day.localDate}</span> : null}{day.destinationLabel ? <span className="ml-2 text-base font-normal text-muted-foreground">· {day.destinationLabel}</span> : null}</h2>
                      {locked ? null : (
                        <div className="flex gap-2">
                          <Button size="sm" variant="secondary" onClick={() => setAddToDay(day.id)}><Plus className="size-4" aria-hidden="true" /> Añadir parada</Button>
                          {j.days.length > 1 || day.stops.length === 0 ? <Button size="sm" variant="ghost" onClick={() => removeDay.mutate(day.id)} aria-label={`Quitar el día ${di + 1}`}><Trash2 className="size-4" aria-hidden="true" /> Quitar día</Button> : null}
                        </div>
                      )}
                    </div>
                    {items.length === 0 ? (
                      <DropTarget id={`day:${day.id}`}>
                        <p className="rounded-card border border-dashed border-control-border p-6 text-center text-muted-foreground">Este día no tiene paradas. Añade una o arrastra una desde otro día.</p>
                      </DropTarget>
                    ) : (
                      <JourneyTrail items={items} selectedId={selected} onSelect={select} ariaLabel={`Paradas del día ${di + 1}`} wrapCard={(item, card) => <DropTarget id={item.id}>{card}</DropTarget>} />
                    )}
                  </div>
                );
              })}
              {j.days.length > 0 && !locked ? <div><Button variant="outline" loading={addDay.isPending} onClick={() => addDay.mutate()}><Plus className="size-4" aria-hidden="true" /> Añadir día</Button></div> : null}
            </div>
          </DndContext>
          {[addStop, removeStop, setDuration, addDay, removeDay, reorder, update].map((m, i) => (m.isError && !(m.error as { isConflict?: boolean }).isConflict ? <Alert key={i} tone="danger" live="assertive" className="mt-4">{errorMessage(m.error)}</Alert> : null))}
        </section>

        <aside className="flex min-w-0 flex-col gap-4" aria-label="Mapa y resumen">
          <button type="button" className="rounded-control border border-control-border bg-surface px-4 py-2 font-semibold xl:hidden" aria-expanded={mapOpen} onClick={() => setMapOpen(!mapOpen)}>{mapOpen ? "Ocultar mapa" : "Ver mapa"}</button>
          <div className={`${mapOpen ? "block" : "hidden"} xl:block`}>
            <MapPanel markers={markers} selectedId={selected} onSelect={select} fitKey={`${id}:${flat.length}`} className="h-80 xl:h-[22rem]" ariaLabel="Mapa de las paradas" />
          </div>
          <Card className="p-4">
            <h2 className="text-lg">Resumen</h2>
            {sum && sum.stops > 0 ? (
              <dl className="mt-2 grid grid-cols-2 gap-y-1 text-sm">
                <dt className="text-muted-foreground">Paradas</dt><dd>{sum.stops}</dd>
                <dt className="text-muted-foreground">Tiempo de visita</dt><dd>{sum.visitSeconds ? formatDuration(sum.visitSeconds) : "—"}{sum.unknownVisits ? ` (+${sum.unknownVisits} sin definir)` : ""}</dd>
                <dt className="text-muted-foreground">Traslados</dt><dd>{sum.unknownLegs === 0 && sum.stops > 1 ? formatDuration(sum.travelSeconds) : sum.travelSeconds ? `${formatDuration(sum.travelSeconds)} + ${sum.unknownLegs} por definir` : "Por definir"}{sum.estimatedLegs ? " (estimado)" : ""}</dd>
              </dl>
            ) : <p className="mt-2 text-sm text-muted-foreground">Añade paradas para ver el resumen.</p>}
            {caps.data && !caps.data.routing.available ? <p className="mt-3 text-xs text-muted-foreground">Sin proveedor de rutas configurado: los tiempos de traslado quedan «Por definir» (puedes fijar uno a mano). Nunca inventamos trayectos.</p> : null}
          </Card>
        </aside>
      </div>

      <AddStopDialog open={addToDay !== null} onClose={() => setAddToDay(null)} destinationLabel={draft.prefs.destinationLabel} onPick={async (placeId) => { await addStop.mutateAsync({ dayId: addToDay!, placeId }); scheduleRecalc(); }} busy={addStop.isPending} />
      <ProposalDialog open={proposalOpen} onClose={() => setProposalOpen(false)} journey={j} onConflict={onConflict} onApplied={(dto) => { qc.setQueryData(qk.journey(id), dto); setDraft(null); dirty.current = false; announce("Propuesta aplicada"); scheduleRecalc(); }} />
    </>
  );
}
