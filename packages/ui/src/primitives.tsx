import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { cn } from "./cn";

/* ───────────── Botones ───────────── */

export type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
export type ButtonSize = "md" | "sm" | "icon";

const variants: Record<ButtonVariant, string> = {
  primary: "bg-primary text-primary-foreground hover:bg-primary-hover disabled:bg-control-border",
  secondary: "bg-sage text-sage-foreground hover:bg-[#cfdcc0]",
  outline: "border border-control-border bg-surface text-foreground hover:bg-surface-muted",
  ghost: "text-foreground hover:bg-surface-muted",
  danger: "bg-danger text-white hover:bg-[#962d29]",
};
const sizes: Record<ButtonSize, string> = {
  md: "min-h-11 px-5 py-2.5 text-base",
  sm: "min-h-10 px-3.5 py-2 text-sm",
  icon: "size-11",
};

/** Clases de botón reutilizables para enlaces (`<Link className={buttonClass(...)}>`). */
export function buttonClass({ variant = "primary", size = "md", className }: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return cn(
    "inline-flex items-center justify-center gap-2 rounded-control font-semibold no-underline transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-70 aria-disabled:opacity-70",
    variants[variant],
    sizes[size],
    className,
  );
}

export function Button({ variant, size, loading, className, children, disabled, type = "button", ...rest }: ComponentPropsWithRef<"button"> & { variant?: ButtonVariant; size?: ButtonSize; loading?: boolean }) {
  return (
    <button type={type} className={buttonClass({ variant, size, className })} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner className="size-4" /> : null}
      {children}
    </button>
  );
}

export function Spinner({ className, label }: { className?: string; label?: string }) {
  return (
    <svg className={cn("animate-spin", className ?? "size-5")} viewBox="0 0 24 24" fill="none" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* ───────────── Formularios ───────────── */

const controlBase =
  "w-full min-h-11 rounded-control border border-control-border bg-surface px-3.5 py-2.5 text-base text-foreground placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-surface-muted aria-invalid:border-danger aria-invalid:border-2";

export function Input({ className, invalid, ...rest }: ComponentPropsWithRef<"input"> & { invalid?: boolean }) {
  return <input className={cn(controlBase, className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Textarea({ className, invalid, ...rest }: ComponentPropsWithRef<"textarea"> & { invalid?: boolean }) {
  return <textarea className={cn(controlBase, "min-h-24 resize-y", className)} aria-invalid={invalid || undefined} {...rest} />;
}

export function Select({ className, invalid, children, ...rest }: ComponentPropsWithRef<"select"> & { invalid?: boolean }) {
  return (
    <select className={cn(controlBase, "pr-9", className)} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
}

export interface FieldProps {
  label: ReactNode;
  error?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  /** Recibe los atributos de accesibilidad a aplicar al control. */
  children: (control: { id: string; "aria-describedby"?: string; invalid: boolean }) => ReactNode;
}

/** Etiqueta + control + ayuda + error enlazados por aria-describedby. */
export function Field({ label, error, hint, required, className, children }: FieldProps) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-err` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
        {required ? <span className="text-danger" aria-hidden="true"> *</span> : null}
      </label>
      {children({ id, "aria-describedby": describedBy, invalid: Boolean(error) })}
      {hint ? <p id={`${id}-hint`} className="text-sm text-muted-foreground">{hint}</p> : null}
      {error ? <p id={`${id}-err`} role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
    </div>
  );
}

/* ───────────── Superficies ───────────── */

export function Card({ className, ...rest }: ComponentPropsWithRef<"div">) {
  return <div className={cn("rounded-card border border-border bg-surface shadow-card", className)} {...rest} />;
}

export type BadgeTone = "neutral" | "sage" | "success" | "warning" | "danger" | "accent";
const tones: Record<BadgeTone, string> = {
  neutral: "bg-surface-muted text-foreground",
  sage: "bg-sage text-sage-foreground",
  success: "bg-[#dcefe3] text-success",
  warning: "bg-[#f6e8c8] text-warning",
  danger: "bg-[#f7dddb] text-danger",
  accent: "bg-[#faeee8] text-accent",
};
export function Badge({ tone = "neutral", className, ...rest }: ComponentPropsWithRef<"span"> & { tone?: BadgeTone }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold", tones[tone], className)} {...rest} />;
}

export function Alert({ tone = "neutral", title, children, className, live = "polite" }: { tone?: BadgeTone; title?: ReactNode; children?: ReactNode; className?: string; live?: "polite" | "assertive" | "off" }) {
  const border = { neutral: "border-border", sage: "border-sage-foreground/30", success: "border-success/40", warning: "border-warning/40", danger: "border-danger/40", accent: "border-accent/40" }[tone];
  return (
    <div role={live === "assertive" ? "alert" : live === "polite" ? "status" : undefined} className={cn("rounded-control border px-4 py-3 text-sm", tones[tone], border, className)}>
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={title ? "mt-0.5" : undefined}>{children}</div> : null}
    </div>
  );
}

export function EmptyState({ title, children, action, icon }: { title: ReactNode; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-card border border-dashed border-control-border bg-surface px-6 py-12 text-center">
      {icon ? <div className="text-primary" aria-hidden="true">{icon}</div> : null}
      <h2 className="text-xl">{title}</h2>
      {children ? <p className="max-w-md text-muted-foreground">{children}</p> : null}
      {action}
    </div>
  );
}

export function Avatar({ name, src, size = 40, className }: { name: string; src?: string | null; size?: number; className?: string }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
  const style = { width: size, height: size };
  return src ? (
    <img src={src} alt="" width={size} height={size} style={style} className={cn("shrink-0 rounded-full object-cover", className)} />
  ) : (
    <span aria-hidden="true" style={{ ...style, fontSize: size * 0.38 }} className={cn("inline-flex shrink-0 items-center justify-center rounded-full bg-sage font-semibold text-sage-foreground", className)}>
      {initials || "·"}
    </span>
  );
}

export function ProgressBar({ value, label, tone = "primary" }: { value: number; label: string; tone?: "primary" | "danger" }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} className="h-2 w-full overflow-hidden rounded-full bg-surface-muted">
      <div className={cn("h-full rounded-full transition-[width] duration-200", tone === "danger" ? "bg-danger" : "bg-primary")} style={{ width: `${pct}%` }} />
    </div>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
