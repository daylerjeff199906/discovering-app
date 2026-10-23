import { buttonClass, cn, Avatar, Alert } from "@por-aqui/ui";
import { useMutation } from "@tanstack/react-query";
import { Bookmark, ChevronDown, Compass, Home, Map as MapIcon, Plus, Settings, User as UserIcon, LogOut } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router";
import { api, errorMessage } from "../lib/api";
import { useLogout, useMe } from "../lib/auth";
import { useUi } from "../lib/stores";

export function Logo({ className, to = "/" }: { className?: string; to?: string }) {
  return (
    <Link to={to} className={cn("brand-wordmark inline-flex flex-col items-start font-serif text-primary no-underline", className)} aria-label={to === "/" ? "Por aquí, inicio" : "Por aquí, mi inicio"}>
      <span>por aquí<span className="ml-1 text-[0.6em]">↗</span></span>
      <span className="brand-tagline">Viajes que dejan huella</span>
    </Link>
  );
}

const PRIVATE_NAV = [
  { to: "/app/inicio", label: "Inicio", Icon: Home },
  { to: "/app/guardados", label: "Guardados", Icon: Bookmark },
  { to: "/app/viajes/nuevo", label: "Nueva aventura", Icon: Plus },
] as const;
const PUBLIC_NAV = [
  { to: "/", label: "Inicio", Icon: Home },
  { to: "/explorar", label: "Ideas en Iquitos", Icon: Compass },
] as const;

function navClass({ isActive }: { isActive: boolean }) {
  return cn("site-nav-link", isActive ? "text-primary" : "text-muted-foreground");
}

export function SiteShell({ children, hideFooter, privateArea = false }: { children: ReactNode; hideFooter?: boolean; privateArea?: boolean }) {
  const { me, isLoading } = useMe();
  const loc = useLocation();
  const announcement = useUi((s) => s.announcement);
  const next = encodeURIComponent(loc.pathname === "/" ? "/app/inicio" : loc.pathname + loc.search);
  const navigation = privateArea ? PRIVATE_NAV : PUBLIC_NAV;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="site-header sticky top-0 z-30">
        <div className="site-header-inner mx-auto flex max-w-[1280px] items-center justify-between gap-4 px-4 md:px-6 lg:px-8">
          <Logo to={privateArea ? "/app/inicio" : "/"} />
          <nav aria-label="Principal" className="hidden items-center gap-1 md:flex">
            {navigation.map((n) => (
              <NavLink key={n.to} to={n.to} end className={navClass}>
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex min-h-11 items-center gap-2">
            {isLoading ? null : me ? (
              <AccountPopover />
            ) : (
              <>
                <Link to={`/ingresar?returnTo=${next}`} className={buttonClass({ variant: "ghost", size: "sm" })}>
                  Ingresar
                </Link>
                <Link to="/registro" className={buttonClass({ variant: "primary", size: "sm", className: "header-desktop-action" })}>
                  Crear cuenta
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {me && !me.emailVerified ? <VerifyBanner email={me.email} /> : null}

      <main id="contenido" tabIndex={-1} className="site-main mx-auto w-full flex-1 px-4 pb-28 outline-none md:px-6 md:pb-12 lg:px-8">
        {children}
      </main>

      {hideFooter ? null : (
        <footer className="site-footer hidden border-t border-border md:block">
          <div className="site-footer-inner"><Logo /><p className="site-footer-note">Lugares que descubres. Caminos que haces tuyos.<br />Historias que se quedan contigo.</p><div className="text-xs text-muted-foreground"><Link to="/terminos">Términos de la beta</Link><p className="mt-2">Hecho para viajar a tu manera.</p></div></div>
        </footer>
      )}

      <nav aria-label="Principal (móvil)" className={cn("mobile-nav pa-safe-bottom fixed inset-x-0 bottom-0 z-30 grid border-t border-border bg-background/95 px-2 pt-1.5 backdrop-blur md:hidden", privateArea ? "grid-cols-3" : "grid-cols-2")}>
        {navigation.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} end className={({ isActive }) => cn("relative flex min-h-14 flex-col items-center justify-center gap-1 rounded-control text-[10px] font-medium no-underline", isActive ? "text-primary" : "text-muted-foreground")}>
            <Icon className="size-5" aria-hidden="true" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div aria-live="polite" className="sr-only">{announcement}</div>
    </div>
  );
}

function AccountPopover() {
  const { me } = useMe();
  const logout = useLogout();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname, location.search]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", escape); };
  }, [open]);
  if (!me) return null;
  const firstName = me.profile.displayName.trim().split(/\s+/u)[0] || "Mi cuenta";
  return <div ref={root} className="account-popover-root" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} type="button" className="account-trigger" aria-label={`Opciones de ${me.profile.displayName}`} aria-expanded={open} aria-controls={id} onClick={() => setOpen((v) => !v)}>
      <Avatar name={me.profile.displayName} src={me.profile.avatarUrl} size={36} />
      <span className="account-trigger-identity"><strong>{firstName}</strong><span>{me.email}</span></span>
      <ChevronDown size={14} aria-hidden="true" />
    </button>
    {open ? <div id={id} className="account-popover" aria-label="Tu cuenta">
      <div className="account-identity"><strong>{firstName}</strong><span>{me.email}</span></div>
      <nav aria-label="Opciones de usuario">
        <Link to="/app/inicio"><Home size={17} aria-hidden="true" /> Inicio</Link>
        <Link to="/app/viajes"><MapIcon size={17} aria-hidden="true" /> Mis aventuras</Link>
        <Link to="/app/perfil"><UserIcon size={17} aria-hidden="true" /> Mi perfil</Link>
        <Link to="/app/cuenta"><Settings size={17} aria-hidden="true" /> Configuración de cuenta</Link>
        {me.role === "MODERATOR" ? <><Link to="/app/catalogo">Administrar catálogo</Link><Link to="/moderacion">Moderación</Link></> : null}
      </nav>
      <button type="button" disabled={logout.isPending} onClick={() => logout.mutate()}><LogOut size={17} aria-hidden="true" />{logout.isPending ? "Cerrando sesión…" : "Cerrar sesión"}</button>
      {logout.isError ? <p role="alert" className="text-sm text-danger">{errorMessage(logout.error)}</p> : null}
    </div> : null}
  </div>;
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
    <div className="page-heading flex flex-wrap items-end justify-between gap-4">
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
