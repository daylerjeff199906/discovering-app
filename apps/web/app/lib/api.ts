import { ApiError, NetworkError, createApiClient } from "@por-aqui/api-client";

const isServer = typeof window === "undefined";

/**
 * En el navegador las peticiones van al mismo origen (`/api/v1/*`, con la cookie de sesión).
 * Al renderizar en servidor se usa la URL interna de NUESTRA API, sin reenviar cookies de usuarios.
 */
export const { http, api } = createApiClient({
  baseUrl: isServer ? (process.env.API_INTERNAL_URL ?? "http://localhost:4000") : "",
});

export { ApiError, NetworkError };

export function errorMessage(err: unknown, fallback = "Algo salió mal. Inténtalo de nuevo."): string {
  if (err instanceof NetworkError) return "No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.";
  if (err instanceof ApiError) return err.message;
  return fallback;
}

/** Aplica los errores por campo de la API a un formulario de React Hook Form. */
export function applyFieldErrors(err: unknown, setError: (name: never, e: { message: string }) => void): boolean {
  if (err instanceof ApiError && err.fieldErrors) {
    for (const [field, msgs] of Object.entries(err.fieldErrors)) setError(field as never, { message: msgs[0] ?? "Valor inválido" });
    return Object.keys(err.fieldErrors).length > 0;
  }
  return false;
}
