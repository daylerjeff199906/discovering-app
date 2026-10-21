import { randomUUID } from "node:crypto";
import { ArgumentsHost, CallHandler, Catch, ExceptionFilter, ExecutionContext, HttpException, Injectable, NestInterceptor } from "@nestjs/common";
import { ERROR_CODES, type ApiErrorBody } from "@por-aqui/contracts";
import type { NextFunction, Request, Response } from "express";
import { tap } from "rxjs";
import type { AuthUser } from "./decorators";
import { AppError } from "./errors";

type Req = Request & { requestId?: string; user?: AuthUser };

const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{8,80}$/;

/** requestId por petición + cabeceras de caché seguras por defecto (todo es privado salvo que se indique). */
export function requestContext(req: Req, res: Response, next: NextFunction) {
  const incoming = req.headers["x-request-id"];
  req.requestId = typeof incoming === "string" && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader("X-Request-Id", req.requestId);
  res.setHeader("Cache-Control", "private, no-store");
  next();
}

const PG_CONSTRAINT_MESSAGES: Record<string, [number, string, string]> = {
  "23505": [409, "DUPLICATE", "Ese valor ya existe."],
  "23503": [400, "REFERENCE_INVALID", "La referencia indicada no es válida."],
  "23514": [400, "CONSTRAINT_VIOLATION", "La operación no cumple las reglas de datos."],
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Req>();
    const res = http.getResponse<Response>();
    const requestId = req.requestId;

    let status = 500;
    let body: ApiErrorBody = { code: ERROR_CODES.INTERNAL, message: "Algo salió mal de nuestro lado. Inténtalo de nuevo en un momento.", requestId };

    if (exception instanceof AppError) {
      status = exception.getStatus();
      body = { code: exception.code, message: exception.message, fieldErrors: exception.fieldErrors, details: exception.details, requestId };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const code = status === 404 ? ERROR_CODES.NOT_FOUND : status === 401 ? ERROR_CODES.UNAUTHENTICATED : status === 403 ? ERROR_CODES.FORBIDDEN : status === 413 ? "PAYLOAD_TOO_LARGE" : "HTTP_ERROR";
      const message = status === 404 ? "No encontramos lo que buscas." : status === 413 ? "La solicitud es demasiado grande." : status < 500 ? exception.message : body.message;
      body = { code, message, requestId };
    } else {
      const e = exception as { code?: string; type?: string; status?: number };
      if (e?.type === "entity.parse.failed") {
        status = 400;
        body = { code: ERROR_CODES.VALIDATION, message: "El cuerpo de la solicitud no es JSON válido.", requestId };
      } else if (e?.type === "entity.too.large") {
        status = 413;
        body = { code: "PAYLOAD_TOO_LARGE", message: "La solicitud es demasiado grande.", requestId };
      } else {
        const pg = findPgError(exception);
        const mapped = pg && PG_CONSTRAINT_MESSAGES[pg];
        if (mapped) {
          [status, , ] = mapped;
          body = { code: mapped[1], message: mapped[2], requestId };
        }
      }
    }

    if (status >= 500) {
      console.error(JSON.stringify({ level: "error", msg: "unhandled", requestId, path: req.route?.path ?? req.path, err: exception instanceof Error ? { name: exception.name, message: exception.message, stack: process.env.NODE_ENV === "production" ? undefined : exception.stack } : String(exception) }));
    }
    res.status(status).json(body);
  }
}

function findPgError(err: unknown): string | undefined {
  let cur = err as { code?: string; cause?: unknown } | undefined;
  for (let i = 0; i < 4 && cur; i++) {
    if (typeof cur.code === "string" && /^\d{5}$/.test(cur.code)) return cur.code;
    cur = cur.cause as typeof cur;
  }
  return undefined;
}

/** Log estructurado por petición. Usa el patrón de ruta (no la URL) para no registrar tokens. */
@Injectable()
export class RequestLogInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const started = Date.now();
    const http = context.switchToHttp();
    const req = http.getRequest<Req>();
    const res = http.getResponse<Response>();
    return next.handle().pipe(
      tap({
        next: () => this.log(req, res, started),
        error: () => this.log(req, res, started),
      }),
    );
  }
  private log(req: Req, res: Response, started: number) {
    if (process.env.NODE_ENV === "test") return;
    console.log(JSON.stringify({ level: "info", msg: "request", requestId: req.requestId, method: req.method, route: req.route?.path ?? "?", status: res.statusCode, ms: Date.now() - started, userId: req.user?.id }));
  }
}
