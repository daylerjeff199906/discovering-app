import { Outlet } from "react-router";
import { SiteShell } from "../components/shell";
import { useRequireAuth } from "../lib/auth";

/**
 * Shell privado. La sesión se comprueba sin mensajes ni indicadores visibles: ningún dato del usuario va en el HTML
 * (y la cabecera es private, no-store). Los datos se piden en el cliente con la cookie de sesión.
 */
export default function LayoutApp() {
  const me = useRequireAuth();
  return <SiteShell hideFooter privateArea>{me ? <Outlet /> : <div className="min-h-[50dvh]" aria-hidden="true" />}</SiteShell>;
}
