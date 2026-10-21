import { PASSWORD_RULES } from "@por-aqui/contracts";
import { Alert, Input, cn } from "@por-aqui/ui";
import { Eye, EyeOff } from "lucide-react";
import { useState, type ComponentPropsWithRef } from "react";
import { errorMessage } from "../lib/api";

/** Campo de contraseña con botón para mostrarla/ocultarla. */
export function PasswordInput({ invalid, ...rest }: ComponentPropsWithRef<"input"> & { invalid?: boolean }) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...rest} invalid={invalid} type={shown ? "text" : "password"} className="pr-12" />
      <button type="button" onClick={() => setShown((s) => !s)} aria-pressed={shown} aria-label={shown ? "Ocultar contraseña" : "Mostrar contraseña"} className="absolute right-1 top-1/2 inline-flex size-10 -translate-y-1/2 items-center justify-center rounded-control text-muted-foreground hover:bg-surface-muted">
        {shown ? <EyeOff className="size-5" aria-hidden="true" /> : <Eye className="size-5" aria-hidden="true" />}
      </button>
    </div>
  );
}

/** Requisitos de contraseña visibles mientras se escribe (con texto, no solo color). */
export function PasswordRules({ value }: { value: string }) {
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-0 text-sm" aria-label="Requisitos de la contraseña">
      {PASSWORD_RULES.map((r) => {
        const ok = r.test(value);
        return (
          <li key={r.id} className={cn("flex items-center gap-2", ok ? "text-success" : "text-muted-foreground")}>
            <span aria-hidden="true">{ok ? "✓" : "○"}</span>
            {r.label}
            <span className="sr-only">{ok ? " (cumplido)" : " (pendiente)"}</span>
          </li>
        );
      })}
    </ul>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <Alert tone="danger" live="assertive">
      {errorMessage(error)}
    </Alert>
  );
}

export function Checkbox({ label, error, ...rest }: ComponentPropsWithRef<"input"> & { label: React.ReactNode; error?: string }) {
  return (
    <div>
      <label className="flex cursor-pointer items-start gap-3">
        <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--primary)]" aria-invalid={error ? true : undefined} {...rest} />
        <span className="text-[0.95rem]">{label}</span>
      </label>
      {error ? <p role="alert" className="mt-1 text-sm font-medium text-danger">{error}</p> : null}
    </div>
  );
}
