import { buttonClass } from "@por-aqui/ui";
import { Link } from "react-router";
import { Logo } from "./shell";

const COPY = {
  "not-found": { status: 404, title: "No encontramos esta página", body: "Puede que el enlace esté mal escrito o que el contenido ya no exista." },
  forbidden: { status: 403, title: "No tienes acceso a esto", body: "Inicia sesión con la cuenta correcta o vuelve al inicio." },
  withdrawn: { status: 410, title: "Esta historia ya no está disponible", body: "Su autor la retiró o fue ocultada. No podemos mostrar su contenido anterior." },
  unavailable: { status: 503, title: "Servicio no disponible por ahora", body: "Estamos teniendo problemas para conectar con el servidor. Inténtalo de nuevo en unos minutos." },
  error: { status: 500, title: "Algo salió mal", body: "Ocurrió un error inesperado. Puedes intentarlo de nuevo; tus datos guardados están a salvo." },
} as const;

export type ErrorKind = keyof typeof COPY;

export function ErrorScreen({ kind, detail }: { kind: ErrorKind; detail?: string }) {
  const c = COPY[kind];
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center gap-5 px-6 text-center">
      <Logo />
      <p className="text-sm font-semibold text-muted-foreground">Error {c.status}</p>
      <h1 className="text-3xl">{c.title}</h1>
      <p className="text-muted-foreground">{c.body}</p>
      {detail && import.meta.env.DEV ? <pre className="max-w-full overflow-auto rounded-control bg-surface-muted p-3 text-left text-xs">{detail}</pre> : null}
      <div className="flex flex-wrap justify-center gap-3">
        <Link to="/" className={buttonClass({})}>Ir al inicio</Link>
        <Link to="/explorar" className={buttonClass({ variant: "outline" })}>Explorar recorridos</Link>
        {kind === "error" || kind === "unavailable" ? (
          <button type="button" onClick={() => window.location.reload()} className={buttonClass({ variant: "ghost" })}>Reintentar</button>
        ) : null}
      </div>
    </div>
  );
}
