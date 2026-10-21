import { buttonClass, cn, Avatar, Alert } from "@por-aqui/ui";
import { useMutation } from "@tanstack/react-query";
import { Compass, Map as MapIcon, User as UserIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { api, errorMessage } from "../lib/api";
import { useLogout, useMe } from "../lib/auth";
import { useUi } from "../lib/stores";

export function Logo({ className }: { className?: string }) {
  return (
    <Link to="/" className={cn("inline-flex items-center gap-2 font-serif text-xl font-semibold text-primary no-underline", className)} aria-label="Por aquí, inicio">
      <svg viewBox="0 0 32 32" className="size-7" fill="none" aria-hidden="true">
        <circle cx="9" cy="23" r="4" fill="currentColor" />
        <circle cx="23" cy="9" r="4" fill="none" stroke="currentColor" strokeWidth="2.4" />
        <path d="M9 19c0-8 14-4 14-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="1 4.5" />
      </svg>
      Por aquí
    </Link>
  );
}

const NAV = [
  { to: "/explorar", label: "Explorar", Icon: Compass },
  { to: "/app/viajes", label: "Mis viajes", Icon: MapIcon },
  { to: "/app/perfil", label: "Perfil", Icon: UserIcon },
] as const;

function navClass({ isActive }: { isActive: boolean }) {
  return cn("rounded-control px-3 py-2 text-base font-semibold no-underline transition-colors", isActive ? "bg-sage text-sage-foreground" : "text-foreground hover:bg-surface-muted");
}

export function SiteShell({ children, hideFooter }: { children: ReactNode; hideFooter?: boolean }) {
  const { me, isLoading } = useMe();
  const logout = useLogout();
  const loc = useLocation();
  const announcement = useUi((s) => s.announcement);
  const next = encodeURIComponent(loc.pathname + loc.search);

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4 px-4 py-2.5 md:px-6 lg:px-8">
          <Logo />
          <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} className={navClass}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex min-h-11 items-center gap-2">
            {isLoading ? null : me ? (
              <>
                {me.role === "MODERATOR" ? (
                  <Link to="/moderacion" className={buttonClass({ variant: "ghost", size: "sm" })}>
                    Moderación
                  </Link>
                ) : null}
                <Link to="/app/perfil" aria-label={`Perfil de ${me.profile.displayName}`} className="rounded-full">
                  <Avatar name={me.profile.displayName} src={me.profile.avatarUrl} size={36} />
                </Link>
                <button type="button" onClick={() => logout.mutate()} className={buttonClass({ variant: "ghost", size: "sm", className: "hidden sm:inline-flex" })}>
                  Salir
                </button>
              </>
            ) : (
              <>
                <Link to={`/ingresar?returnTo=${next}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
                  Ingresar
                </Link>
                <Link to="/registro" className={buttonClass({ variant: "primary", size: "sm", className: "hidden sm:inline-flex" })}>
                  Crear cuenta
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {me && !me.emailVerified ? <VerifyBanner email={me.email} /> : null}

      <main id="contenido" tabIndex={-1} className="mx-auto w-full max-w-[1440px] flex-1 px-4 pb-28 pt-6 outline-none md:px-6 md:pb-12 lg:px-8">
        {children}
      </main>

      {hideFooter ? null : (
        <footer className="hidden border-t border-border py-6 text-center text-sm text-muted-foreground md:block">
          Por aquí · beta · Tus recorridos son privados hasta que decidas compartirlos.
        </footer>
      )}

      <nav aria-label="Principal (móvil)" className="pa-safe-bottom fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-border bg-background/95 px-2 pt-1.5 backdrop-blur md:hidden">
        {NAV.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} className={({ isActive }) => cn("flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-control text-xs font-semibold no-underline", isActive ? "text-primary" : "text-muted-foreground")}>
            <Icon className="size-5" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div aria-live="polite" className="sr-only">{announcement}</div>
    </div>
  );
}

function VerifyBanner({ email }: { email: string }) {
  const [sent, setSent] = useState(false);
  const resend = useMutation({ mutationFn: () => api.auth.resendVerification(email), onSuccess: () => setSent(true) });
  return (
    <div className="border-b border-warning/30 bg-[#f6e8c8]">
      <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-2 text-sm md:px-6 lg:px-8">
        <p className="text-warning">
          <strong>Verifica tu correo</strong> ({email}) para poder publicar tus recorridos.
        </p>
        {sent ? (
          <span role="status" className="font-semibold text-success">Te enviamos un nuevo enlace.</span>
        ) : (
          <button type="button" onClick={() => resend.mutate()} disabled={resend.isPending} className="font-semibold text-primary underline underline-offset-4">
            {resend.isPending ? "Enviando…" : "Reenviar correo"}
          </button>
        )}
        {resend.isError ? <span role="alert" className="text-danger">{errorMessage(resend.error)}</span> : null}
      </div>
    </div>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-3xl md:text-4xl">{title}</h1>
        {subtitle ? <p className="mt-1 max-w-2xl text-muted-foreground">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function LoadingBlock({ label = "Cargando…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-muted-foreground">
      <svg className="size-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {label}
    </div>
  );
}

export function QueryError({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <Alert tone="danger" title="No pudimos cargar esto" live="assertive">
      <p>{errorMessage(error)}</p>
      {retry ? (
        <button type="button" onClick={retry} className="mt-2 font-semibold underline underline-offset-4">
          Reintentar
        </button>
      ) : null}
    </Alert>
  );
}
