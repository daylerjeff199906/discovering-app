import { applyDecorators, createParamDecorator, SetMetadata, UseInterceptors, type ExecutionContext } from "@nestjs/common";
import { ApiBody, ApiOperation, ApiQuery, ApiResponse } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import { ZodInputInterceptor } from "./zod-input.interceptor";

export const IS_PUBLIC = "isPublic";
export const ROLES = "roles";
export const REQUIRE_VERIFIED = "requireVerified";
export const ZOD_INPUT = "zodInput";
export const RATE_LIMIT = "rateLimit";

export interface AuthUser {
  id: string;
  email: string;
  role: "USER" | "MODERATOR";
  emailVerified: boolean;
  accountStatus: "ACTIVE" | "DISABLED" | "DELETION_PENDING";
  sessionId: string;
}

export interface RateLimitOptions {
  key: string;
  limit: number;
  windowSec: number;
  /** Además de la IP, limitar por el email enviado en el cuerpo. */
  byEmail?: boolean;
}

/** Endpoint accesible sin sesión (la sesión, si existe, igualmente se resuelve). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: ("USER" | "MODERATOR")[]) => SetMetadata(ROLES, roles);
export const RequireVerified = () => SetMetadata(REQUIRE_VERIFIED, true);
export const RateLimit = (opts: RateLimitOptions) => SetMetadata(RATE_LIMIT, opts);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
  return req.user as AuthUser;
});

export const OptionalUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser | undefined => {
  return ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>().user;
});

export interface ApiSpec {
  summary: string;
  body?: z.ZodType;
  query?: z.ZodType;
  response?: z.ZodType;
  status?: number;
}

function toJsonSchema(schema: z.ZodType, io: "input" | "output"): Record<string, unknown> {
  try {
    return z.toJSONSchema(schema, { io, unrepresentable: "any", target: "draft-7" }) as Record<string, unknown>;
  } catch {
    return { type: "object" };
  }
}

/**
 * Declara en un solo lugar la validación Zod de entrada (cuerpo y query) y la documentación OpenAPI
 * del endpoint. La validación se ejecuta en el servidor siempre, con los mismos esquemas que usa el cliente.
 */
export function Api(spec: ApiSpec) {
  const decorators: (MethodDecorator | ClassDecorator)[] = [ApiOperation({ summary: spec.summary })];
  if (spec.body || spec.query) {
    decorators.push(SetMetadata(ZOD_INPUT, { body: spec.body, query: spec.query }), UseInterceptors(ZodInputInterceptor));
  }
  if (spec.body) decorators.push(ApiBody({ schema: toJsonSchema(spec.body, "input") as never }));
  if (spec.query) {
    const js = toJsonSchema(spec.query, "input") as { properties?: Record<string, object>; required?: string[] };
    for (const [name, schema] of Object.entries(js.properties ?? {})) {
      decorators.push(ApiQuery({ name, required: js.required?.includes(name) ?? false, schema: schema as never }));
    }
  }
  decorators.push(ApiResponse({ status: spec.status ?? 200, description: "OK", ...(spec.response ? { schema: toJsonSchema(spec.response, "output") as never } : {}) }));
  return applyDecorators(...decorators);
}
