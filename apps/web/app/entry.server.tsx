import { PassThrough } from "node:stream";

import { createReadableStreamFromReadable } from "@react-router/node";
import { isbot } from "isbot";
import type { RenderToPipeableStreamOptions } from "react-dom/server";
import { renderToPipeableStream } from "react-dom/server";
import type { EntryContext, RouterContextProvider } from "react-router";
import { ServerRouter } from "react-router";

export const streamTimeout = 5_000;

/** Rutas cuyo HTML nunca debe quedar en cachés compartidas (shell privado y formularios de cuenta). */
const PRIVATE_PREFIXES = ["/app", "/bienvenida", "/moderacion", "/ingresar", "/registro", "/verificar-correo", "/recuperar-cuenta", "/restablecer-clave"];

/** Cabeceras de seguridad y de caché por ruta. Las historias por enlace son noindex, no-store y sin Referer. */
function applySecurityHeaders(url: URL, headers: Headers) {
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "SAMEORIGIN");
  headers.set("Permissions-Policy", "geolocation=(self), camera=(), microphone=()");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  const path = url.pathname;
  if (path.startsWith("/s/")) {
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
    headers.set("Referrer-Policy", "no-referrer");
  } else if (PRIVATE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`))) {
    headers.set("Cache-Control", "private, no-store");
    headers.set("X-Robots-Tag", "noindex");
  } else if (!headers.has("Cache-Control")) {
    // Páginas públicas: siempre revalidan (retirar/ocultar una historia debe surtir efecto sin esperar TTL).
    headers.set("Cache-Control", "no-cache");
  }
}

export default function handleRequest(request: Request, responseStatusCode: number, responseHeaders: Headers, routerContext: EntryContext, _loadContext: RouterContextProvider) {
  applySecurityHeaders(new URL(request.url), responseHeaders);

  if (request.method.toUpperCase() === "HEAD") {
    return new Response(null, { status: responseStatusCode, headers: responseHeaders });
  }

  return new Promise((resolve, reject) => {
    let shellRendered = false;
    const userAgent = request.headers.get("user-agent");

    // Los bots esperan a que todo el contenido esté listo (SEO).
    const readyOption: keyof RenderToPipeableStreamOptions = (userAgent && isbot(userAgent)) || routerContext.isSpaMode ? "onAllReady" : "onShellReady";

    let timeoutId: ReturnType<typeof setTimeout> | undefined = setTimeout(() => abort(), streamTimeout + 1000);

    const { pipe, abort } = renderToPipeableStream(<ServerRouter context={routerContext} url={request.url} />, {
      [readyOption]() {
        shellRendered = true;
        const body = new PassThrough({
          final(callback) {
            clearTimeout(timeoutId);
            timeoutId = undefined;
            callback();
          },
        });
        const stream = createReadableStreamFromReadable(body);
        responseHeaders.set("Content-Type", "text/html");
        pipe(body);
        resolve(new Response(stream, { headers: responseHeaders, status: responseStatusCode }));
      },
      onShellError(error: unknown) {
        reject(error);
      },
      onError(error: unknown) {
        responseStatusCode = 500;
        if (shellRendered) console.error(error);
      },
    });
  });
}
