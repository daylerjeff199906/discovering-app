import { Outlet } from "react-router";
import { LoadingBlock, SiteShell } from "../components/shell";
import { useRequireAuth } from "../lib/auth";

/**
 * Shell privado. En servidor solo se renderiza el marco y «Cargando…»: ningún dato del usuario va en el HTML
 * (y la cabecera es private, no-store). Los datos se piden en el cliente con la cookie de sesión.
 */
export default function LayoutApp() {
  const me = useRequireAuth();
  return <SiteShell hideFooter>{me ? <Outlet /> : <LoadingBlock label="Verificando tu sesión…" />}</SiteShell>;
}
