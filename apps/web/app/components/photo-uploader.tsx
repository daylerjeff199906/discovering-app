import type { AssetDto } from "@por-aqui/contracts";
import { uploadToStorage } from "@por-aqui/api-client";
import { Alert, Button, Lightbox, ProgressBar } from "@por-aqui/ui";
import { DndContext, KeyboardSensor, MouseSensor, TouchSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, arrayMove, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, GripVertical, Plus, Upload as UploadIcon, RotateCcw, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, api, errorMessage } from "../lib/api";
import { capabilitiesQuery } from "../lib/query";

interface Upload {
  key: string;
  name: string;
  file?: File;
  assetId?: string;
  progress: number;
  phase: "uploading" | "processing" | "done" | "error";
  error?: string;
  retryable?: boolean;
}

const FAIL_TEXT: Record<string, string> = {
  UNSUPPORTED_FORMAT: "El archivo no es una imagen válida (JPEG, PNG o WebP).",
  TOO_LARGE: "La foto supera el tamaño máximo.",
  TOO_MANY_PIXELS: "La imagen tiene demasiados píxeles.",
  UPLOAD_EXPIRED: "La subida venció. Vuelve a elegir la foto.",
  OBJECT_MISSING: "No llegó el archivo. Inténtalo de nuevo.",
  PROCESSING_ERROR: "Hubo un problema procesando la foto.",
};
const NOT_RETRYABLE = new Set(["UNSUPPORTED_FORMAT", "TOO_LARGE", "TOO_MANY_PIXELS", "UPLOAD_EXPIRED"]);


/** Miniatura arrastrable (ratón/táctil sobre toda la tarjeta; teclado desde el asa: Espacio, flechas, Espacio). */
function SortablePhoto({ asset, index, disabled, onOpen, onRemove }: { asset: AssetDto; index: number; disabled?: boolean; onOpen: () => void; onRemove: () => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: asset.id, disabled });
  return (
    <li ref={setNodeRef} {...listeners} style={{ transform: CSS.Translate.toString(transform), transition }} className={isDragging ? "is-dragging" : undefined}>
      <button type="button" className="visit-photo-preview" onClick={onOpen} aria-label={"Ver foto " + (index + 1)}>
        <img src={asset.thumbUrl!} alt={asset.caption ?? "Foto " + (index + 1)} width={160} height={145} draggable={false} />
      </button>
      <button type="button" ref={setActivatorNodeRef} {...attributes} className="visit-photo-grip" disabled={disabled} aria-label={"Mover foto " + (index + 1)} title="Arrastra para cambiar el orden">
        <GripVertical size={15} aria-hidden="true" />
      </button>
      <button type="button" className="visit-photo-del" disabled={disabled} aria-label={"Eliminar foto " + (index + 1)} title="Eliminar foto" onClick={onRemove}>
        <Trash2 size={15} aria-hidden="true" />
      </button>
    </li>
  );
}

/** Subida directa al almacenamiento con progreso y error POR ARCHIVO, y estado de procesamiento. */
export function PhotoUploader({ visitId, assets, onChanged, disabled }: { visitId: string; assets: AssetDto[]; onChanged: () => void; disabled?: boolean }) {
  const caps = useQuery(capabilitiesQuery());
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<Upload[]>([]);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [orderOverride, setOrderOverride] = useState<string[] | null>(null);
  const [orderError, setOrderError] = useState<string | null>(null);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const patch = (key: string, p: Partial<Upload>) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, ...p } : x)));

  const run = async (up: Upload) => {
    const file = up.file!;
    patch(up.key, { phase: "uploading", progress: 0, error: undefined });
    try {
      const max = caps.data?.media.maxBytes ?? 10 * 1024 * 1024;
      if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) throw Object.assign(new Error("HEIC"), { friendly: "HEIC todavía no es compatible. Conviértela a JPEG (en iPhone: Ajustes → Cámara → Formatos → «Más compatible») e inténtalo de nuevo." });
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw Object.assign(new Error("tipo"), { friendly: "Formato no admitido. Usa JPEG, PNG o WebP." });
      if (file.size > max) throw Object.assign(new Error("tamaño"), { friendly: `La foto pesa ${(file.size / 1048576).toFixed(1)} MB y el máximo es ${Math.round(max / 1048576)} MB.` });

      const auth = await api.media.reserve(visitId, { mimeType: file.type as "image/jpeg", sizeBytes: file.size, fileName: file.name });
      patch(up.key, { assetId: auth.assetId });
      await uploadToStorage(auth, file, (p) => patch(up.key, { progress: Math.round((p.loaded / p.total) * 100) }));
      patch(up.key, { phase: "processing", progress: 100 });
      let asset = await api.media.complete(auth.assetId);
      for (let i = 0; i < 60 && asset.status !== "READY" && asset.status !== "FAILED"; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        asset = await api.media.status(auth.assetId);
      }
      if (asset.status === "READY") {
        patch(up.key, { phase: "done" });
        onChanged();
      } else if (asset.status === "FAILED") {
        patch(up.key, { phase: "error", error: FAIL_TEXT[asset.failureCode ?? ""] ?? "No pudimos procesar la foto.", retryable: !NOT_RETRYABLE.has(asset.failureCode ?? "") });
        onChanged();
      } else {
        patch(up.key, { phase: "error", error: "Sigue procesándose. Revisa en unos segundos.", retryable: false });
        onChanged();
      }
    } catch (err) {
      const friendly = (err as { friendly?: string }).friendly;
      const msg = friendly ?? (err instanceof ApiError ? err.message : (err as Error).message?.startsWith("UPLOAD_REJECTED") ? "El almacenamiento rechazó el archivo (tamaño o tipo)." : errorMessage(err, "No pudimos subir la foto."));
      patch(up.key, { phase: "error", error: msg, retryable: !friendly });
    }
  };

  const add = (files: FileList | null) => {
    if (!files?.length) return;
    const next: Upload[] = Array.from(files).map((f) => ({ key: `${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`, name: f.name, file: f, progress: 0, phase: "uploading" }));
    setUploads((u) => [...u, ...next]);
    for (const up of next) void run(up);
  };

  const remove = async (a: AssetDto) => {
    setDeleteError(null);
    try {
      await api.media.remove(a.id);
      void qc.invalidateQueries({ queryKey: ["visit"] });
      onChanged();
    } catch (err) {
      setDeleteError(err instanceof ApiError && err.code === "MEDIA_IN_PUBLICATION" ? "Esta foto está en una publicación. Actualiza o retira la publicación antes de eliminarla." : errorMessage(err));
    }
  };

  const readyServer = assets.filter((a) => a.status === "READY");
  const ready = orderOverride ? [...readyServer].sort((a, b) => orderOverride.indexOf(a.id) - orderOverride.indexOf(b.id)) : readyServer;
  // Cuando llega el orden del servidor, deja de usarse el orden optimista.
  const serverOrder = assets.map((a) => `${a.id}:${a.position}`).join();
  useEffect(() => setOrderOverride(null), [serverOrder]);
  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const ids = ready.map((a) => a.id);
    const next = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    setOrderOverride(next);
    setOrderError(null);
    try {
      // La API exige el conjunto completo: las fotos aún en proceso o con error van al final.
      await api.media.reorder(visitId, [...next, ...assets.filter((a) => a.status !== "READY").map((a) => a.id)]);
      onChanged();
    } catch (err) {
      setOrderError(errorMessage(err, "No pudimos guardar el nuevo orden."));
      setOrderOverride(null);
    }
  };
  const failed = assets.filter((a) => a.status === "FAILED");
  const shownKeys = new Set(uploads.filter((u) => u.phase !== "done").map((u) => u.assetId));
  const images = ready.map((a) => ({ src: a.displayUrl!, alt: a.caption ?? "Foto de la visita", caption: a.caption }));

  return (
    <section aria-labelledby="fotos" className="visit-section visit-photo-component flex flex-col gap-3">
      <div className="visit-photo-heading"><h2 id="fotos" className="visit-section-title">Multimedia</h2><span>{ready.length} de {caps.data?.media.maxPerVisit ?? 20}</span></div>
      <input ref={input} type="file" multiple accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Elegir fotos de la visita" tabIndex={-1} onChange={(e) => { add(e.target.files); e.target.value = ""; }} disabled={disabled} />
      <input ref={camera} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Tomar foto de la visita" tabIndex={-1} disabled={disabled} onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => void onDragEnd(e)}>
        <SortableContext items={ready.map((a) => a.id)} strategy={rectSortingStrategy}>
          <ul className="visit-photo-strip">
            {ready.map((asset, i) => <SortablePhoto key={asset.id} asset={asset} index={i} disabled={disabled} onOpen={() => setLightbox(i)} onRemove={() => void remove(asset)} />)}
            {ready.length < (caps.data?.media.maxPerVisit ?? 20) ? <li><button type="button" className="visit-photo-add" aria-label="Añadir fotos" disabled={disabled} onClick={() => input.current?.click()}><Plus size={28} strokeWidth={1.3} aria-hidden="true" /></button></li> : null}
          </ul>
        </SortableContext>
      </DndContext>
      {ready.length > 1 ? <p className="text-xs text-muted-foreground">Arrastra las fotos para cambiar el orden (con teclado: enfoca «Mover foto», Espacio y flechas).</p> : null}
      {orderError ? <Alert tone="warning" live="assertive">{orderError}</Alert> : null}
      <div className="visit-photo-buttons"><Button variant="secondary" disabled={disabled} onClick={() => camera.current?.click()}><Camera size={18} aria-hidden="true" />Tomar foto</Button><Button variant="outline" disabled={disabled} onClick={() => input.current?.click()}><UploadIcon size={18} aria-hidden="true" />Subir fotos</Button></div>
      <p className="text-xs text-muted-foreground">JPEG, PNG o WebP · hasta {Math.round((caps.data?.media.maxBytes ?? 10485760) / 1048576)} MB por foto.</p>
      {uploads.length > 0 ? (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Subidas en curso">
          {uploads.map((u) => (
            <li key={u.key} className="rounded-control border border-border bg-surface p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="truncate text-sm font-semibold">{u.name}</p>
                <p role="status" className="shrink-0 text-xs text-muted-foreground">{u.phase === "uploading" ? `Subiendo ${u.progress}%` : u.phase === "processing" ? "Procesando…" : u.phase === "done" ? "Lista ✓" : "Error"}</p>
              </div>
              {u.phase === "uploading" || u.phase === "processing" ? <div className="mt-2"><ProgressBar value={u.phase === "processing" ? 100 : u.progress} label={`Progreso de ${u.name}`} /></div> : null}
              {u.phase === "error" ? (
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <p role="alert" className="text-sm text-danger">{u.error}</p>
                  {u.retryable && u.file ? <Button size="sm" variant="outline" onClick={() => void run(u)}><RotateCcw className="size-4" aria-hidden="true" /> Reintentar</Button> : null}
                  <Button size="sm" variant="ghost" onClick={() => setUploads((x) => x.filter((y) => y.key !== u.key))}>Descartar</Button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {failed.filter((a) => !shownKeys.has(a.id)).map((a) => (
        <Alert key={a.id} tone="danger" title="Una foto no se pudo procesar">
          {FAIL_TEXT[a.failureCode ?? ""] ?? "Error desconocido."}
          <div className="mt-2 flex gap-2">
            {!NOT_RETRYABLE.has(a.failureCode ?? "") ? <Button size="sm" variant="outline" onClick={async () => { await api.media.retry(a.id).catch(() => undefined); onChanged(); }}>Reintentar</Button> : null}
            <Button size="sm" variant="ghost" onClick={() => void remove(a)}>Quitar</Button>
          </div>
        </Alert>
      ))}
      {deleteError ? <Alert tone="warning" live="assertive">{deleteError}</Alert> : null}

      <Lightbox images={images} index={lightbox} onClose={() => setLightbox(null)} onIndex={setLightbox} />
    </section>
  );
}
