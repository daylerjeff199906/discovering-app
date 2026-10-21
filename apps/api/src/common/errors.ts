import { HttpException } from "@nestjs/common";
import { ERROR_CODES, type ErrorCode } from "@por-aqui/contracts";

/** Error de aplicación con código estable y mensaje seguro para el cliente. */
export class AppError extends HttpException {
  constructor(
    status: number,
    public readonly code: ErrorCode | string,
    message: string,
    public readonly fieldErrors?: Record<string, string[]>,
    public readonly details?: unknown,
  ) {
    super({ code, message, fieldErrors, details }, status);
  }
}

export const notFound = (message = "No encontramos lo que buscas.") => new AppError(404, ERROR_CODES.NOT_FOUND, message);
export const forbidden = (message = "No tienes permiso para esto.") => new AppError(403, ERROR_CODES.FORBIDDEN, message);
export const unauthenticated = (message = "Inicia sesión para continuar.") => new AppError(401, ERROR_CODES.UNAUTHENTICATED, message);
export const badRequest = (code: string, message: string, fieldErrors?: Record<string, string[]>, details?: unknown) =>
  new AppError(400, code, message, fieldErrors, details);
export const conflict = (code: string, message: string, details?: unknown) => new AppError(409, code, message, undefined, details);
export const versionConflict = (currentVersion: number) =>
  new AppError(409, ERROR_CODES.CONFLICT, "Este recurso cambió mientras lo editabas. Revisa los cambios y vuelve a intentarlo.", undefined, { currentVersion });
