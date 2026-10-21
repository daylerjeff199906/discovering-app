import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ERROR_CODES } from "@por-aqui/contracts";
import type { Request } from "express";
import type { Observable } from "rxjs";
import { z } from "zod";
import { AppError } from "./errors";

export function toFieldErrors(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

export function parseOrThrow<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AppError(400, ERROR_CODES.VALIDATION, "Revisa los campos marcados.", toFieldErrors(result.error));
  }
  return result.data;
}

/** Valida cuerpo y query con Zod antes de llegar al controlador y sustituye los valores por los parseados. */
@Injectable()
export class ZodInputInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const spec = this.reflector.get<{ body?: z.ZodType; query?: z.ZodType }>("zodInput", context.getHandler());
    if (spec) {
      const req = context.switchToHttp().getRequest<Request>();
      if (spec.body) req.body = parseOrThrow(spec.body, req.body ?? {});
      if (spec.query) {
        // Express 5: req.query es un getter; se guarda el resultado en una propiedad propia.
        (req as Request & { parsedQuery?: unknown }).parsedQuery = parseOrThrow(spec.query, req.query);
      }
    }
    return next.handle();
  }
}

import { createParamDecorator } from "@nestjs/common";
/** Query ya validada por @Api({ query }). */
export const ParsedQuery = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return (ctx.switchToHttp().getRequest<Request & { parsedQuery?: unknown }>()).parsedQuery;
});
