import { TERMS_VERSION } from "@por-aqui/contracts";
import { seoMeta, siteUrl } from "../lib/seo";
import type { Route } from "./+types/terminos";

export function meta(_: Route.MetaArgs) {
  return seoMeta({ title: "Términos de la beta — Por aquí", canonical: `${siteUrl()}/terminos` });
}

export default function Terminos() {
  return (
    <article className="prose mx-auto max-w-2xl">
      <h1 className="text-3xl">Términos de la beta</h1>
      <p className="mt-2 text-sm text-muted-foreground">Versión {TERMS_VERSION}. Texto de la beta; no es un contrato legal definitivo.</p>
      <h2 className="mt-6 text-xl">Tu contenido</h2>
      <p>Las fotos, notas y trayectos que registras son tuyos y permanecen privados hasta que decidas compartirlos. Al publicar eliges qué visitas, fotos y notas se muestran; las ubicaciones exactas del trayecto GPS están desactivadas por defecto.</p>
      <h2 className="mt-6 text-xl">Lo que no hacemos</h2>
      <p>No vendemos tus datos ni mostramos tu correo públicamente. Copiar una ruta de otra persona solo copia sus paradas, nunca sus fotos, notas ni registros GPS.</p>
      <h2 className="mt-6 text-xl">Uso aceptable</h2>
      <p>No publiques contenido ilegal, que exponga datos privados de terceros o que infrinja derechos de autor. Las publicaciones pueden ser reportadas y ocultadas por moderación.</p>
      <h2 className="mt-6 text-xl">Beta</h2>
      <p>El servicio puede cambiar o interrumpirse. El seguimiento por GPS funciona con la pestaña activa y no sustituye a una aplicación nativa en segundo plano.</p>
    </article>
  );
}
