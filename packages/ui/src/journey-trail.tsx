import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";

export type TrailState = "pending" | "current" | "visited";

export interface TrailItem {
  id: string;
  title: ReactNode;
  subtitle?: ReactNode;
  state: TrailState;
  media?: { src: string; alt: string }[];
  note?: ReactNode;
  /** Controles propios del contexto (editor: subir/bajar, quitar; vivo: registrar visita…). */
  actions?: ReactNode;
  /** Texto auxiliar entre un punto y el siguiente (p. ej. «Por definir» o «15 min en bote»). */
  connector?: ReactNode;
}

const STATE_LABEL: Record<TrailState, string> = { pending: "Pendiente", current: "Aquí ahora", visited: "Visitado" };

interface Pt {
  id: string;
  x: number;
  y: number;
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" className="size-4" fill="none" aria-hidden="true">
      <path d="M4.5 10.5l3.5 3.5 7.5-8" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * El caminito: lista semántica ordenada con una línea curva vertical decorativa.
 * - La línea se calcula con las posiciones reales de los nodos (ResizeObserver): no hay alturas fijas.
 * - El SVG es `aria-hidden` y no captura clics.
 * - Representa SECUENCIA, no geografía: no simula calles.
 */
export function JourneyTrail({
  items,
  selectedId,
  onSelect,
  onMediaClick,
  alternate = false,
  ariaLabel = "Recorrido",
  className,
  wrapCard,
  variant = "card",
}: {
  items: TrailItem[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onMediaClick?: (itemId: string, mediaIndex: number) => void;
  /** Alterna el lado de las fotos (historia pública). El editor mantiene posiciones predecibles. */
  alternate?: boolean;
  ariaLabel?: string;
  className?: string;
  /** Permite envolver cada tarjeta (p. ej. para registrarla como destino de arrastre sin acoplar la librería). */
  wrapCard?: (item: TrailItem, card: ReactNode) => ReactNode;
  variant?: "card" | "diary";
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const nodeRefs = useRef(new Map<string, HTMLElement>());
  const [points, setPoints] = useState<Pt[]>([]);
  const [size, setSize] = useState({ w: 0, h: 0 });

  const measure = useCallback(() => {
    const c = containerRef.current;
    if (!c) return;
    const box = c.getBoundingClientRect();
    const pts: Pt[] = [];
    for (const it of items) {
      const el = nodeRefs.current.get(it.id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      pts.push({ id: it.id, x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2 });
    }
    setPoints((prev) => (prev.length === pts.length && prev.every((p, i) => p.id === pts[i]!.id && Math.abs(p.x - pts[i]!.x) < 0.5 && Math.abs(p.y - pts[i]!.y) < 0.5) ? prev : pts));
    setSize((s) => (Math.abs(s.w - box.width) < 0.5 && Math.abs(s.h - box.height) < 0.5 ? s : { w: box.width, h: box.height }));
  }, [items]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const c = containerRef.current;
    if (!c || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(c);
    c.querySelectorAll("li").forEach((li) => ro.observe(li)); // fotos y notas cambian la altura
    return () => ro.disconnect();
  }, [measure, items]);

  // Los puntos se asocian por id: si los ítems cambian entre mediciones, nunca se usa un punto obsoleto.
  const byId = new Map(points.map((p) => [p.id, p]));
  const segments: { d: string; solid: boolean; key: string }[] = [];
  for (let i = 0; i < items.length - 1; i++) {
    const from = items[i]!;
    const to = items[i + 1]!;
    const a = byId.get(from.id);
    const b = byId.get(to.id);
    if (!a || !b) continue;
    const my = (a.y + b.y) / 2;
    const solid = from.state === "visited" && to.state !== "pending";
    segments.push({ d: `M ${a.x} ${a.y} C ${a.x} ${my}, ${b.x} ${my}, ${b.x} ${b.y}`, solid, key: `${from.id}-${to.id}` });
  }

  return (
    <div ref={containerRef} className={cn("journey-trail relative", className)}>
      <svg aria-hidden="true" focusable="false" className="pointer-events-none absolute inset-0 text-primary" width={size.w || "100%"} height={size.h || "100%"} viewBox={size.w ? `0 0 ${size.w} ${size.h}` : undefined}>
        {segments.map((s) => (
          <path key={s.key} d={s.d} fill="none" stroke="currentColor" strokeWidth={s.solid ? 2 : 1.4} strokeLinecap="round" strokeDasharray={s.solid ? undefined : "4 6"} opacity={s.solid ? 0.9 : 0.7} />
        ))}
      </svg>

      <ol aria-label={ariaLabel} className="relative m-0 list-none space-y-5 p-0">
        {items.map((item, i) => {
          const selected = selectedId === item.id;
          const flip = alternate && i % 2 === 1;
          return (
            <li key={item.id} aria-current={item.state === "current" ? "step" : undefined} data-state={item.state} className="grid grid-cols-[2.75rem_minmax(0,1fr)] items-start gap-3 sm:gap-4">
              <span
                ref={(el) => {
                  if (el) nodeRefs.current.set(item.id, el);
                  else nodeRefs.current.delete(item.id);
                }}
                style={{ marginLeft: i % 2 === 0 ? 0 : 10 }}
                className={cn(
                  "relative z-10 mt-4 inline-flex size-9 items-center justify-center rounded-full text-sm font-bold",
                  item.state === "visited" && "bg-primary text-primary-foreground",
                  item.state === "current" && "bg-surface text-primary ring-[3px] ring-primary ring-offset-2 ring-offset-background",
                  item.state === "pending" && "border-2 border-dashed border-control-border bg-surface text-muted-foreground",
                )}
              >
                {item.state === "visited" && variant !== "diary" ? <CheckIcon /> : i + 1}
                <span className="sr-only"> — {STATE_LABEL[item.state]}</span>
              </span>

              {(() => {
                const card = (
              <div className={cn("trail-stop rounded-card border bg-surface p-5 shadow-card transition-colors duration-150", selected ? "border-primary ring-1 ring-primary" : "border-border")}>
                  <div className={cn("flex flex-col gap-4", item.media?.length && variant !== "diary" ? "sm:flex-row" : "", flip && variant !== "diary" && "sm:flex-row-reverse")}>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        {onSelect ? (
                          <button type="button" onClick={() => onSelect(item.id)} aria-pressed={selected} className="text-left font-serif text-lg font-semibold hover:underline">
                            {item.title}
                          </button>
                        ) : (
                          <h3 className="text-lg font-semibold">{item.title}</h3>
                        )}
                        <span aria-hidden="true" className={cn("rounded-full px-2 py-0.5 text-xs font-semibold", item.state === "visited" && "bg-sage text-sage-foreground", item.state === "current" && "bg-primary text-primary-foreground", item.state === "pending" && "bg-surface-muted text-muted-foreground")}>
                          {STATE_LABEL[item.state]}
                        </span>
                      </div>
                      {item.subtitle ? <p className="mt-0.5 text-sm text-muted-foreground">{item.subtitle}</p> : null}
                      {variant === "diary" && item.media?.length ? (
                        <ul className="polaroid-stack" data-count={Math.min(item.media.length, 4)} aria-label={`Fotos de ${item.title}`}>
                          {item.media.slice(0, 4).map((m, mi, arr) => (
                            <li key={m.src} style={{ ["--tilt" as string]: `${[-3.5, 2.5, -1.5, 3][mi % 4]}deg` }}>
                              <button type="button" disabled={!onMediaClick} onClick={() => onMediaClick?.(item.id, mi)} aria-label={`Ver foto: ${m.alt}`}>
                                <img src={m.src} alt={m.alt} loading="lazy" width={300} height={300} />
                                {mi === arr.length - 1 && item.media!.length > arr.length ? <span className="polaroid-more">+{item.media!.length - arr.length}</span> : null}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {item.note ? <div className="mt-2 whitespace-pre-wrap text-[0.95rem]">{item.note}</div> : null}
                      {item.actions ? <div className="mt-3 flex flex-wrap items-center gap-2">{item.actions}</div> : null}
                    </div>
                    {item.media?.length && variant !== "diary" ? (
                      <ul className={cn("m-0 grid shrink-0 list-none gap-2 p-0", item.media.length === 1 ? "grid-cols-1 sm:w-44" : "grid-cols-2 sm:w-60")}>
                        {item.media.slice(0, 4).map((m, mi) => (
                          <li key={m.src}>
                            <button type="button" onClick={() => onMediaClick?.(item.id, mi)} disabled={!onMediaClick} className="block w-full overflow-hidden rounded-control bg-surface-muted" aria-label={`Ver foto: ${m.alt}`}>
                              <img src={m.src} alt={m.alt} loading="lazy" decoding="async" width={240} height={180} className="aspect-[4/3] w-full object-cover" />
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
                );
                return wrapCard ? wrapCard(item, card) : card;
              })()}

              {item.connector && i < items.length - 1 ? (
                <p className="col-start-2 -mb-2 mt-1 text-xs text-muted-foreground" aria-label="Traslado al siguiente punto">
                  ↓ {item.connector}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
