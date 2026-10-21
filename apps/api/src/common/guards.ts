import { CanActivate, ExecutionContext, Inject, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ERROR_CODES } from "@por-aqui/contracts";
import { sessions, users, type Db } from "@por-aqui/database";
import { and, eq, gt, isNull } from "drizzle-orm";
import type { Request, Response } from "express";
import { ENV, type Env } from "../config/env";
import { DB } from "../infrastructure/tokens";
import { RateLimitService } from "../infrastructure/rate-limit.service";
import { sha256, safeEqual } from "./crypto";
import { type AuthUser, IS_PUBLIC, RATE_LIMIT, REQUIRE_VERIFIED, ROLES, type RateLimitOptions } from "./decorators";
import { AppError, forbidden, unauthenticated } from "./errors";

type Req = Request & { user?: AuthUser };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** CSRF para mutaciones basadas en cookie: validación de Origin + token doble-submit. */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Req>();
    if (SAFE_METHODS.has(req.method)) return true;

    const origin = req.headers.origin;
    if (origin && !this.env.ALLOWED_ORIGINS.includes(origin)) {
      throw new AppError(403, ERROR_CODES.CSRF, "Origen no permitido.");
    }
    const cookie = req.cookies?.[this.env.CSRF_COOKIE_NAME];
    const header = req.headers["x-csrf-token"];
    if (typeof cookie !== "string" || typeof header !== "string" || !cookie || !safeEqual(cookie, header)) {
      throw new AppError(403, ERROR_CODES.CSRF, "Falta o es inválido el token de seguridad. Recarga la página e inténtalo de nuevo.");
    }
    return true;
  }
}

/** Resuelve la sesión (cookie opaca → hash en BD). Denegado por omisión salvo `@Public()`. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Req>();
    const token = req.cookies?.[this.env.SESSION_COOKIE_NAME];
    if (typeof token === "string" && token.length > 0) {
      const user = await this.resolve(token);
      if (user) req.user = user;
    }

    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (!req.user) throw unauthenticated();

    const roles = this.reflector.getAllAndOverride<("USER" | "MODERATOR")[] | undefined>(ROLES, targets);
    if (roles && !roles.includes(req.user.role)) throw forbidden();
    if (this.reflector.getAllAndOverride<boolean>(REQUIRE_VERIFIED, targets) && !req.user.emailVerified) {
      throw new AppError(403, ERROR_CODES.EMAIL_NOT_VERIFIED, "Verifica tu correo para continuar.");
    }
    return true;
  }

  private async resolve(token: string): Promise<AuthUser | undefined> {
    const now = new Date();
    const [row] = await this.db
      .select({
        sessionId: sessions.id,
        lastSeenAt: sessions.lastSeenAt,
        id: users.id,
        email: users.emailOriginal,
        role: users.role,
        verifiedAt: users.emailVerifiedAt,
        status: users.accountStatus,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(and(eq(sessions.tokenHash, sha256(token)), isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
      .limit(1);
    if (!row || row.status !== "ACTIVE") return undefined;
    const idleMs = this.env.SESSION_IDLE_TTL_DAYS * 86_400_000;
    if (now.getTime() - row.lastSeenAt.getTime() > idleMs) return undefined;
    if (now.getTime() - row.lastSeenAt.getTime() > 60_000) {
      await this.db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, row.sessionId));
    }
    return {
      id: row.id,
      email: row.email,
      role: row.role as AuthUser["role"],
      emailVerified: row.verifiedAt !== null,
      accountStatus: row.status as AuthUser["accountStatus"],
      sessionId: row.sessionId,
    };
  }
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly limiter: RateLimitService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const opts = this.reflector.get<RateLimitOptions | undefined>(RATE_LIMIT, context.getHandler());
    if (!opts) return true;
    const http = context.switchToHttp();
    const req = http.getRequest<Req>();
    const res = http.getResponse<Response>();
    try {
      await this.limiter.hit(`${opts.key}:ip:${req.ip}`, opts.limit, opts.windowSec);
      const email = (req.body as { email?: unknown } | undefined)?.email;
      if (opts.byEmail && typeof email === "string" && email) {
        await this.limiter.hit(`${opts.key}:email:${sha256(email.trim().toLowerCase())}`, Math.max(3, Math.floor(opts.limit / 2)), opts.windowSec);
      }
    } catch (err) {
      if (err instanceof AppError && err.details && typeof (err.details as { retryAfterSec?: number }).retryAfterSec === "number") {
        res.setHeader("Retry-After", String((err.details as { retryAfterSec: number }).retryAfterSec));
      }
      throw err;
    }
    return true;
  }
}
