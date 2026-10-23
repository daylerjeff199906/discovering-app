import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";

/**
 * Diálogo accesible sobre <dialog> nativo: atrapa el foco, cierra con Esc y devuelve el foco al disparador.
 * `sheet` se ancla abajo en móvil (hoja inferior) y se centra en pantallas amplias.
 */
export function Dialog({ open, onClose, title, description, children, footer, variant = "center", className }: { open: boolean; onClose: () => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; variant?: "center" | "sheet"; className?: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cn(
        "m-auto w-[min(92vw,34rem)] max-h-[90dvh] overflow-hidden rounded-card border border-border bg-surface p-0 text-foreground shadow-xl backdrop:bg-black/40",
        variant === "sheet" && "max-md:mb-0 max-md:mt-auto max-md:w-full max-md:max-w-none max-md:rounded-b-none",
        className,
      )}
    >
      {open ? (
        <div className="flex max-h-[90dvh] flex-col">
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div>
              <h2 id={titleId} className="text-xl">{title}</h2>
              {description ? <p id={descId} className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="-mr-2 inline-flex size-11 items-center justify-center rounded-full text-xl leading-none hover:bg-surface-muted">
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer ? <div className="pa-safe-bottom flex flex-wrap justify-end gap-3 border-t border-border px-5 py-3">{footer}</div> : null}
        </div>
      ) : null}
    </dialog>
  );
}

export interface TabDef {
  id: string;
  label: ReactNode;
}

/** Pestañas con roles ARIA y navegación con flechas / Inicio / Fin. */
export function Tabs({ tabs, value, onChange, label, className }: { tabs: TabDef[]; value: string; onChange: (id: string) => void; label: string; className?: string }) {
  const base = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent, i: number) => {
    const last = tabs.length - 1;
    const next = e.key === "ArrowRight" ? (i === last ? 0 : i + 1) : e.key === "ArrowLeft" ? (i === 0 ? last : i - 1) : e.key === "Home" ? 0 : e.key === "End" ? last : null;
    if (next === null) return;
    e.preventDefault();
    onChange(tabs[next]!.id);
    refs.current[next]?.focus();
  };
  return (
    <div role="tablist" aria-label={label} className={cn("inline-flex rounded-control bg-surface-muted p-1", className)}>
      {tabs.map((t, i) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            id={`${base}-${t.id}`}
            aria-selected={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn("min-h-11 rounded-[10px] px-4 text-sm font-medium transition-colors", active ? "bg-sage text-primary" : "text-muted-foreground hover:text-foreground")}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function tabPanelProps(baseId: string, id: string) {
  return { role: "tabpanel" as const, id: `${baseId}-panel-${id}`, "aria-labelledby": `${baseId}-${id}` };
}

/** Galería a pantalla completa con teclado (← → Esc). */
export function Lightbox({ images, index, onClose, onIndex }: { images: { src: string; alt: string; caption?: string | null }[]; index: number | null; onClose: () => void; onIndex: (i: number) => void }) {
  const open = index !== null && images.length > 0;
  const img = open ? images[index!] : null;
  const [loaded, setLoaded] = useState(false);
  useEffect(() => setLoaded(false), [index]);
  const go = (d: number) => onIndex((index! + d + images.length) % images.length);
  return (
    <Dialog open={open} onClose={onClose} title={open ? `Foto ${index! + 1} de ${images.length}` : "Foto"} className="w-[min(96vw,64rem)]">
      {img ? (
        <div
          onKeyDown={(e) => {
            if (e.key === "ArrowRight") go(1);
            if (e.key === "ArrowLeft") go(-1);
          }}
        >
          <div className="flex items-center justify-center bg-surface-muted">
            <img src={img.src} alt={img.alt} onLoad={() => setLoaded(true)} className={cn("max-h-[65dvh] w-auto max-w-full object-contain transition-opacity duration-200", loaded ? "opacity-100" : "opacity-0")} />
          </div>
          {img.caption ? <p className="mt-3 text-sm text-muted-foreground">{img.caption}</p> : null}
          {images.length > 1 ? (
            <div className="mt-3 flex justify-between gap-3">
              <button type="button" onClick={() => go(-1)} className="min-h-11 rounded-control border border-control-border px-4 font-semibold hover:bg-surface-muted">← Anterior</button>
              <button type="button" onClick={() => go(1)} className="min-h-11 rounded-control border border-control-border px-4 font-semibold hover:bg-surface-muted">Siguiente →</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  );
}

/** Región viva para anuncios (reordenar, guardado, errores no bloqueantes). */
export function LiveRegion({ message }: { message: string }) {
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
