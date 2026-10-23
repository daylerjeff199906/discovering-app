import { Alert, Button, buttonClass } from "@por-aqui/ui";
import { useQuery } from "@tanstack/react-query";
import { capabilitiesQuery } from "../lib/query";

const ERRORS: Record<string, string> = {
  google_no_disponible: "El acceso con Google todavía no está configurado en esta instalación.",
  google_cancelado: "Cancelaste el acceso con Google. Puedes intentarlo de nuevo cuando quieras.",
  google_estado: "La sesión de acceso con Google venció. Vuelve a intentarlo.",
  google_fallo: "No pudimos completar el acceso con Google. Inténtalo de nuevo.",
  google_correo_no_verificado: "Google no tiene verificado ese correo, así que no podemos usarlo para entrar.",
  google_cuenta_inactiva: "Esa cuenta está desactivada.",
  google_sin_cuenta: "Todavía no tienes cuenta con ese correo. Acepta los términos y pulsa «Continuar con Google» para crearla.",
};

export const googleErrorText = (code: string | null): string | null => (code && ERRORS[code]) || null;

export function GoogleAlert({ code }: { code: string | null }) {
  const text = googleErrorText(code);
  return text ? <Alert tone={code === "google_sin_cuenta" ? "sage" : "warning"} live="polite">{text}</Alert> : null;
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.6 3-2.3 5.5-4.8 7.2l7.5 5.8c4.4-4.1 7.1-10.1 7.1-17.5z" />
      <path fill="#FBBC05" d="M10.5 28.7a14.5 14.5 0 0 1 0-9.4l-7.9-6.1a24 24 0 0 0 0 21.6l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/**
 * «Continuar con Google». Solo se muestra si el servidor lo tiene configurado. Es una navegación completa (no fetch):
 * el servidor redirige a Google y, al volver, abre la sesión y redirige a la web. Para crear cuenta exige aceptar los términos.
 */
export function GoogleButton({ mode, returnTo, termsAccepted = true }: { mode: "login" | "register"; returnTo: string; termsAccepted?: boolean }) {
  const caps = useQuery(capabilitiesQuery());
  if (!caps.data?.auth.google) return null;
  const href = `/api/v1/auth/google/start?mode=${mode}${mode === "register" ? "&terms=1" : ""}&returnTo=${encodeURIComponent(returnTo)}`;
  return (
    <div className="flex flex-col gap-3">
      <p className="auth-or" aria-hidden="true"><span>o</span></p>
      {termsAccepted ? (
        <a href={href} className={buttonClass({ variant: "outline" }) + " google-button"}>
          <GoogleMark /> Continuar con Google
        </a>
      ) : (
        <>
          <Button type="button" variant="outline" disabled className="google-button"><GoogleMark /> Continuar con Google</Button>
          <p className="text-xs text-muted-foreground">Acepta los términos de la beta para continuar con Google.</p>
        </>
      )}
    </div>
  );
}
