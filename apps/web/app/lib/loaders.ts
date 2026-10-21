import { ApiError, NetworkError } from "@por-aqui/api-client";

/** Traduce errores de la API a respuestas HTTP reales para el SSR (404/410/503), sin filtrar detalles internos. */
export function toResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    if (err.status === 404 && err.code === "NOT_AVAILABLE") return new Response("No disponible", { status: 410 });
    if (err.status === 404) return new Response("No encontrado", { status: 404 });
    if (err.status === 401 || err.status === 403) return new Response("Sin acceso", { status: 403 });
    if (err.status === 429) return new Response("Demasiadas solicitudes", { status: 429 });
  }
  if (err instanceof NetworkError) return new Response("Servicio no disponible", { status: 503 });
  return new Response("Error", { status: 500 });
}
