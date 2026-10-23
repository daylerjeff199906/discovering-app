import { TRANSPORT_MODES, type TransportMode, type VisitDto } from "@por-aqui/contracts";
import { Field, Input, Select, Textarea } from "@por-aqui/ui";
import { Bike, Bus, Car, Ellipsis, Footprints, Lightbulb, Plane, Ship, Wallet, type LucideIcon } from "lucide-react";
import { TRANSPORT_LABEL } from "../lib/format";

export const TRANSPORT_ICON: Record<TransportMode, LucideIcon> = {
  WALK: Footprints,
  BIKE: Bike,
  CAR: Car,
  TRANSIT: Bus,
  BOAT: Ship,
  FLIGHT: Plane,
  OTHER: Ellipsis,
};

/** Monedas frecuentes para el gasto (el código es ISO 4217). */
export const CURRENCIES = ["PEN", "USD", "EUR", "COP", "MXN", "ARS", "BRL", "CLP", "GBP"] as const;

/**
 * Campos OPCIONALES de una visita. El gasto y el transporte son siempre privados; la recomendación solo se
 * publica si el autor lo elige al compartir.
 */
export interface VisitExtrasState {
  expense: string;
  currency: string;
  transport: TransportMode | "";
  recommendation: string;
}

export const emptyExtras = (): VisitExtrasState => ({ expense: "", currency: "PEN", transport: "", recommendation: "" });

export function extrasFromVisit(v: Pick<VisitDto, "expenseMinor" | "expenseCurrency" | "transportMode" | "recommendation">): VisitExtrasState {
  return {
    expense: v.expenseMinor === null ? "" : (v.expenseMinor / 100).toFixed(2),
    currency: v.expenseCurrency ?? "PEN",
    transport: v.transportMode ?? "",
    recommendation: v.recommendation ?? "",
  };
}

/** «12,50» o «12.5» → 1250 (unidad menor). Vacío → null. Texto inválido → undefined. */
export function parseExpense(text: string): number | null | undefined {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  if (!/^\d{1,9}(\.\d{1,2})?$/.test(t)) return undefined;
  return Math.round(Number(t) * 100);
}

export const expenseError = (s: VisitExtrasState): string | undefined => (parseExpense(s.expense) === undefined ? "Escribe un monto válido, por ejemplo 12.50" : undefined);

export function extrasPayload(s: VisitExtrasState) {
  const minor = parseExpense(s.expense) ?? null;
  return {
    expenseMinor: minor,
    expenseCurrency: minor === null ? null : s.currency,
    transportMode: s.transport === "" ? null : s.transport,
    recommendation: s.recommendation.trim() || null,
  };
}

export function formatMoney(minor: number, currency: string): string {
  try {
    return new Intl.NumberFormat("es", { style: "currency", currency }).format(minor / 100);
  } catch {
    return `${(minor / 100).toFixed(2)} ${currency}`;
  }
}

/** Suma de gastos por moneda (no se mezclan monedas). */
export function totalsByCurrency(visits: Pick<VisitDto, "expenseMinor" | "expenseCurrency">[]): { currency: string; minor: number }[] {
  const map = new Map<string, number>();
  for (const v of visits) if (v.expenseMinor !== null && v.expenseCurrency) map.set(v.expenseCurrency, (map.get(v.expenseCurrency) ?? 0) + v.expenseMinor);
  return [...map].map(([currency, minor]) => ({ currency, minor }));
}

export function VisitExtrasFields({ value, onChange, disabled }: { value: VisitExtrasState; onChange: (next: VisitExtrasState) => void; disabled?: boolean }) {
  const set = <K extends keyof VisitExtrasState>(k: K, v: VisitExtrasState[K]) => onChange({ ...value, [k]: v });
  return (
    <section aria-labelledby="visit-extras-title" className="visit-section">
      <h2 id="visit-extras-title" className="visit-section-title">Gasto, transporte y recomendación <small>(opcional)</small></h2>
      <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
        <Field label="¿Cuánto gastaste aquí?" error={expenseError(value)} hint="Solo lo ves tú; nunca se publica.">
          {(c) => <Input {...c} inputMode="decimal" placeholder="0.00" disabled={disabled} value={value.expense} onChange={(e) => set("expense", e.target.value)} />}
        </Field>
        <Field label="Moneda">
          {(c) => (
            <Select {...c} disabled={disabled} value={value.currency} onChange={(e) => set("currency", e.target.value)}>
              {CURRENCIES.map((m) => <option key={m} value={m}>{m}</option>)}
            </Select>
          )}
        </Field>
      </div>
      <div role="radiogroup" aria-labelledby="visit-transport-label" className="flex flex-col gap-2">
        <p id="visit-transport-label" className="text-sm font-semibold">¿Cómo llegaste? <span className="font-normal text-muted-foreground">· también es privado</span></p>
        <div className="transport-cards">
          {TRANSPORT_MODES.map((m) => {
            const Icon = TRANSPORT_ICON[m];
            const selected = value.transport === m;
            return (
              <button key={m} type="button" role="radio" aria-checked={selected} disabled={disabled} className="transport-card" data-selected={selected} onClick={() => set("transport", selected ? "" : m)}>
                <Icon size={22} aria-hidden="true" />
                <span>{TRANSPORT_LABEL[m]}</span>
              </button>
            );
          })}
        </div>
      </div>
      <Field label="Tu recomendación" hint={`${value.recommendation.length}/1000 · Un consejo para quien visite este lugar. Solo se publica si tú lo eliges al compartir.`}>
        {(c) => <Textarea {...c} rows={3} disabled={disabled} maxLength={1000} value={value.recommendation} onChange={(e) => set("recommendation", e.target.value)} placeholder="Ve temprano, pide el menú del día…" />}
      </Field>
    </section>
  );
}

/** Resumen de solo lectura para el diario. */
export function VisitExtrasView({ visit }: { visit: Pick<VisitDto, "expenseMinor" | "expenseCurrency" | "transportMode" | "recommendation"> }) {
  const chips: React.ReactNode[] = [];
  if (visit.expenseMinor !== null && visit.expenseCurrency) chips.push(<li key="e"><Wallet size={14} aria-hidden="true" /> <span className="sr-only">Gasto: </span>{formatMoney(visit.expenseMinor, visit.expenseCurrency)}</li>);
  if (visit.transportMode) chips.push(<li key="t"><span aria-hidden="true">↳</span> <span className="sr-only">Transporte: </span>{TRANSPORT_LABEL[visit.transportMode]}</li>);
  if (!chips.length && !visit.recommendation) return null;
  return (
    <div className="visit-extras-view">
      {chips.length ? <ul className="visit-chips">{chips}</ul> : null}
      {visit.recommendation ? <p className="visit-tip"><Lightbulb size={15} aria-hidden="true" /> <span><strong>Recomendación:</strong> {visit.recommendation}</span></p> : null}
    </div>
  );
}
