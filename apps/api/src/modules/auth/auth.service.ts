import { Inject, Injectable } from "@nestjs/common";
import {
  ERROR_CODES,
  TERMS_VERSION,
  type ChangePasswordInput,
  type LoginInput,
  type MeDto,
  type RegisterInput,
  type ResetPasswordInput,
  type SessionDto,
} from "@por-aqui/contracts";
import { authTokens, profiles, sessions, shareLinks, publications, users, type Db } from "@por-aqui/database";
import argon2 from "argon2";
import { and, eq, gt, isNull, ne, sql } from "drizzle-orm";
import type { Request, Response } from "express";
import { randomToken, sha256 } from "../../common/crypto";
import type { AuthUser } from "../../common/decorators";
import { AppError, badRequest, conflict, unauthenticated } from "../../common/errors";
import { ENV, type Env } from "../../config/env";
import { OutboxService } from "../../infrastructure/outbox.service";
import { RateLimitService } from "../../infrastructure/rate-limit.service";
import { DB } from "../../infrastructure/tokens";

/** Argon2id con los mínimos recomendados por OWASP (19 MiB, t=2, p=1). Ver docs/ARCHITECTURE.md. */
const ARGON_OPTIONS = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
const VERIFY_TTL_MS = 24 * 3600_000;
const RESET_TTL_MS = 3600_000;

@Injectable()
export class AuthService {
  private dummyHash?: Promise<string>;

  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    private readonly outbox: OutboxService,
    private readonly limiter: RateLimitService,
  ) {}

  hashPassword(password: string) {
    return argon2.hash(password, ARGON_OPTIONS);
  }

  /** Hash falso para igualar tiempos cuando el usuario no existe. */
  private async dummyVerify(password: string) {
    this.dummyHash ??= argon2.hash("dummy-password-for-timing", ARGON_OPTIONS);
    await argon2.verify(await this.dummyHash, password).catch(() => false);
  }

  /* ───────────── Registro y verificación ───────────── */

  async register(input: RegisterInput): Promise<{ ok: true; requiresVerification: true }> {
    if (input.termsVersion !== TERMS_VERSION) throw badRequest(ERROR_CODES.VALIDATION, "Los términos cambiaron. Recarga la página.", { termsVersion: ["Versión de términos inválida"] });
    const emailNormalized = input.email.trim().toLowerCase();
    const usernameNormalized = input.username.toLowerCase();

    const usernameTaken = await this.db.select({ id: profiles.userId }).from(profiles).where(eq(profiles.usernameNormalized, usernameNormalized)).limit(1);
    const existing = await this.db.select({ id: users.id }).from(users).where(eq(users.emailNormalized, emailNormalized)).limit(1);
    // Se calcula el hash siempre: el tiempo de respuesta no revela si el correo ya existe.
    const passwordHash = await this.hashPassword(input.password);

    if (existing[0]) {
      await this.db.transaction(async (tx) => {
        await this.outbox.add(tx, "EMAIL_ACCOUNT_EXISTS", existing[0]!.id, { to: emailNormalized }, { sensitive: false });
      });
      return { ok: true, requiresVerification: true };
    }
    if (usernameTaken[0]) throw conflict("USERNAME_TAKEN", "Ese nombre de usuario ya está en uso.", { field: "username" });

    try {
      await this.db.transaction(async (tx) => {
        const now = new Date();
        const [user] = await tx
          .insert(users)
          .values({ emailOriginal: input.email.trim(), emailNormalized, passwordHash, termsVersion: input.termsVersion, termsAcceptedAt: now })
          .returning({ id: users.id });
        await tx.insert(profiles).values({ userId: user!.id, username: input.username, usernameNormalized, displayName: input.displayName });
        await this.issueVerification(tx, user!.id, input.displayName, emailNormalized);
      });
    } catch (err) {
      if (isUniqueViolation(err, "profiles_username_normalized_unique")) throw conflict("USERNAME_TAKEN", "Ese nombre de usuario ya está en uso.", { field: "username" });
      if (isUniqueViolation(err, "users_email_normalized_unique")) return { ok: true, requiresVerification: true };
      throw err;
    }
    return { ok: true, requiresVerification: true };
  }

  private async issueVerification(tx: Parameters<Parameters<Db["transaction"]>[0]>[0], userId: string, displayName: string, email: string) {
    const token = randomToken();
    await tx.insert(authTokens).values({ userId, purpose: "VERIFY_EMAIL", tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) });
    await this.outbox.add(tx, "EMAIL_VERIFY", userId, { to: email, displayName, token }, { sensitive: true });
  }

  /** Acción explícita (POST): un GET podría ser consumido por el escáner del correo. */
  async verifyEmail(token: string): Promise<{ ok: true }> {
    const hash = sha256(token);
    const result = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(authTokens).where(and(eq(authTokens.tokenHash, hash), eq(authTokens.purpose, "VERIFY_EMAIL"))).limit(1);
      if (!row) return "invalid" as const;
      if (row.expiresAt.getTime() < Date.now()) return "expired" as const;
      // Consumo atómico: solo un request gana la carrera.
      const consumed = await tx
        .update(authTokens)
        .set({ consumedAt: new Date() })
        .where(and(eq(authTokens.id, row.id), isNull(authTokens.consumedAt)))
        .returning({ id: authTokens.id });
      if (consumed.length === 0) {
        // Ya consumido: es idempotente si el correo sigue verificado.
        const [u] = await tx.select({ v: users.emailVerifiedAt }).from(users).where(eq(users.id, row.userId));
        return u?.v ? ("ok" as const) : ("used" as const);
      }
      await tx.update(users).set({ emailVerifiedAt: new Date() }).where(and(eq(users.id, row.userId), isNull(users.emailVerifiedAt)));
      return "ok" as const;
    });
    if (result === "ok") return { ok: true };
    if (result === "expired") throw new AppError(400, ERROR_CODES.TOKEN_EXPIRED, "El enlace venció. Pide uno nuevo.");
    throw new AppError(400, ERROR_CODES.TOKEN_INVALID, "El enlace no es válido o ya fue usado.");
  }

  async resendVerification(user: AuthUser | undefined, email?: string): Promise<{ ok: true }> {
    const normalized = (user?.email ?? email ?? "").trim().toLowerCase();
    if (!normalized) return { ok: true };
    const okCooldown = await this.limiter.cooldown(`resend:${sha256(normalized)}`, 60);
    if (!okCooldown) throw new AppError(429, ERROR_CODES.RATE_LIMITED, "Espera un minuto antes de pedir otro correo.", undefined, { retryAfterSec: 60 });

    const [row] = await this.db
      .select({ id: users.id, verified: users.emailVerifiedAt, name: profiles.displayName })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(and(eq(users.emailNormalized, normalized), eq(users.accountStatus, "ACTIVE")))
      .limit(1);
    // Respuesta idéntica exista o no la cuenta.
    if (row && !row.verified) {
      await this.db.transaction((tx) => this.issueVerification(tx, row.id, row.name, normalized));
    }
    return { ok: true };
  }

  /* ───────────── Sesión ───────────── */

  async login(input: LoginInput, req: Request, res: Response): Promise<MeDto> {
    const [row] = await this.db.select().from(users).where(eq(users.emailNormalized, input.email)).limit(1);
    if (!row || row.accountStatus !== "ACTIVE") {
      await this.dummyVerify(input.password);
      throw new AppError(401, ERROR_CODES.INVALID_CREDENTIALS, "Correo o contraseña incorrectos.");
    }
    const valid = await argon2.verify(row.passwordHash, input.password).catch(() => false);
    if (!valid) throw new AppError(401, ERROR_CODES.INVALID_CREDENTIALS, "Correo o contraseña incorrectos.");

    // Rotación: una sesión previa del navegador se revoca antes de emitir la nueva.
    const previous = req.cookies?.[this.env.SESSION_COOKIE_NAME];
    if (typeof previous === "string") await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, sha256(previous)));
    await this.startSession(row.id, req, res);
    return this.me(row.id);
  }

  private async startSession(userId: string, req: Request, res: Response) {
    const token = randomToken();
    const now = Date.now();
    await this.db.insert(sessions).values({
      userId,
      tokenHash: sha256(token),
      expiresAt: new Date(now + this.env.SESSION_ABSOLUTE_TTL_DAYS * 86_400_000),
      userAgentLabel: labelUserAgent(req.headers["user-agent"]),
    });
    this.setSessionCookie(res, token);
    this.setCsrfCookie(res, randomToken(24));
  }

  setSessionCookie(res: Response, token: string) {
    res.cookie(this.env.SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.env.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      maxAge: this.env.SESSION_ABSOLUTE_TTL_DAYS * 86_400_000,
    });
  }

  setCsrfCookie(res: Response, token: string) {
    res.cookie(this.env.CSRF_COOKIE_NAME, token, {
      httpOnly: false,
      secure: this.env.COOKIE_SECURE,
      sameSite: "lax",
      path: "/",
      maxAge: this.env.SESSION_ABSOLUTE_TTL_DAYS * 86_400_000,
    });
  }

  /** Entrega (o reutiliza) el token CSRF; se llama antes de cualquier mutación del navegador. */
  csrf(req: Request, res: Response): { csrfToken: string } {
    const existing = req.cookies?.[this.env.CSRF_COOKIE_NAME];
    if (typeof existing === "string" && existing.length >= 16) return { csrfToken: existing };
    const token = randomToken(24);
    this.setCsrfCookie(res, token);
    return { csrfToken: token };
  }

  async logout(user: AuthUser | undefined, res: Response) {
    if (user) await this.db.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.id, user.sessionId));
    res.clearCookie(this.env.SESSION_COOKIE_NAME, { path: "/" });
    return { ok: true as const };
  }

  async me(userId: string): Promise<MeDto> {
    const [row] = await this.db
      .select({ u: users, p: profiles })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.id, userId))
      .limit(1);
    if (!row) throw unauthenticated();
    const prefs = (row.p.preferencesJson ?? {}) as { interests?: string[] };
    return {
      id: row.u.id,
      email: row.u.emailOriginal,
      emailVerified: row.u.emailVerifiedAt !== null,
      role: row.u.role as MeDto["role"],
      accountStatus: row.u.accountStatus as MeDto["accountStatus"],
      profile: {
        username: row.p.username,
        displayName: row.p.displayName,
        bio: row.p.bio,
        avatarUrl: row.p.avatarAssetId ? `/api/v1/media/${row.p.avatarAssetId}/content?variant=thumb` : null,
        locale: row.p.locale,
        timezone: row.p.timezone,
        interests: prefs.interests ?? [],
        onboardingCompleted: row.p.onboardingCompletedAt !== null,
      },
    };
  }

  /* ───────────── Recuperación de contraseña ───────────── */

  async forgotPassword(email: string): Promise<{ ok: true }> {
    const [row] = await this.db
      .select({ id: users.id, name: profiles.displayName })
      .from(users)
      .innerJoin(profiles, eq(profiles.userId, users.id))
      .where(and(eq(users.emailNormalized, email), eq(users.accountStatus, "ACTIVE")))
      .limit(1);
    if (row) {
      await this.db.transaction(async (tx) => {
        const token = randomToken();
        await tx.insert(authTokens).values({ userId: row.id, purpose: "RESET_PASSWORD", tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) });
        await this.outbox.add(tx, "EMAIL_RESET", row.id, { to: email, displayName: row.name, token }, { sensitive: true });
      });
    }
    return { ok: true };
  }

  async resetPassword(input: ResetPasswordInput): Promise<{ ok: true }> {
    const hash = sha256(input.token);
    const newHash = await this.hashPassword(input.password);
    const result = await this.db.transaction(async (tx) => {
      const [row] = await tx.select().from(authTokens).where(and(eq(authTokens.tokenHash, hash), eq(authTokens.purpose, "RESET_PASSWORD"))).limit(1);
      if (!row) return "invalid" as const;
      if (row.expiresAt.getTime() < Date.now()) return "expired" as const;
      const consumed = await tx
        .update(authTokens)
        .set({ consumedAt: new Date() })
        .where(and(eq(authTokens.id, row.id), isNull(authTokens.consumedAt)))
        .returning({ id: authTokens.id });
      if (consumed.length === 0) return "invalid" as const;
      await tx.update(users).set({ passwordHash: newHash }).where(eq(users.id, row.userId));
      // Tras restablecer: se revocan todas las sesiones y los demás tokens pendientes.
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, row.userId), isNull(sessions.revokedAt)));
      await tx.update(authTokens).set({ consumedAt: new Date() }).where(and(eq(authTokens.userId, row.userId), eq(authTokens.purpose, "RESET_PASSWORD"), isNull(authTokens.consumedAt)));
      return "ok" as const;
    });
    if (result === "expired") throw new AppError(400, ERROR_CODES.TOKEN_EXPIRED, "El enlace venció. Pide uno nuevo.");
    if (result === "invalid") throw new AppError(400, ERROR_CODES.TOKEN_INVALID, "El enlace no es válido o ya fue usado.");
    return { ok: true };
  }

  async changePassword(user: AuthUser, input: ChangePasswordInput, req: Request, res: Response): Promise<{ ok: true }> {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.id));
    const valid = row && (await argon2.verify(row.passwordHash, input.currentPassword).catch(() => false));
    if (!valid) throw new AppError(400, ERROR_CODES.INVALID_CREDENTIALS, "La contraseña actual no es correcta.", { currentPassword: ["Contraseña incorrecta"] });
    const newHash = await this.hashPassword(input.newPassword);
    await this.db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: newHash }).where(eq(users.id, user.id));
      await tx.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
    });
    await this.startSession(user.id, req, res); // rotación al elevar el estado
    return { ok: true };
  }

  /* ───────────── Sesiones ───────────── */

  async listSessions(user: AuthUser): Promise<SessionDto[]> {
    const rows = await this.db
      .select()
      .from(sessions)
      .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())))
      .orderBy(sql`${sessions.lastSeenAt} desc`);
    return rows.map((s) => ({
      id: s.id,
      createdAt: s.createdAt.toISOString(),
      lastSeenAt: s.lastSeenAt.toISOString(),
      expiresAt: s.expiresAt.toISOString(),
      userAgentLabel: s.userAgentLabel,
      current: s.id === user.sessionId,
    }));
  }

  async revokeSession(user: AuthUser, sessionId: string) {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.id, sessionId), eq(sessions.userId, user.id)));
    return { ok: true as const };
  }

  async revokeOtherSessions(user: AuthUser) {
    await this.db.update(sessions).set({ revokedAt: new Date() }).where(and(eq(sessions.userId, user.id), ne(sessions.id, user.sessionId), isNull(sessions.revokedAt)));
    return { ok: true as const };
  }

  /* ───────────── Eliminación de cuenta ───────────── */

  async deleteAccount(user: AuthUser, password: string, res: Response): Promise<{ ok: true; status: "DELETION_PENDING" }> {
    const [row] = await this.db.select().from(users).where(eq(users.id, user.id));
    const valid = row && (await argon2.verify(row.passwordHash, password).catch(() => false));
    if (!valid) throw new AppError(400, ERROR_CODES.INVALID_CREDENTIALS, "La contraseña no es correcta.", { password: ["Contraseña incorrecta"] });

    await this.db.transaction(async (tx) => {
      const now = new Date();
      await tx.update(users).set({ accountStatus: "DELETION_PENDING" }).where(eq(users.id, user.id));
      await tx.update(sessions).set({ revokedAt: now }).where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
      await tx.update(authTokens).set({ consumedAt: now }).where(and(eq(authTokens.userId, user.id), isNull(authTokens.consumedAt)));
      const pubs = tx.select({ id: publications.id }).from(publications).where(eq(publications.authorId, user.id));
      await tx.update(shareLinks).set({ revokedAt: now }).where(and(sql`${shareLinks.publicationId} in (${pubs})`, isNull(shareLinks.revokedAt)));
      await tx.update(publications).set({ visibility: "PRIVATE" }).where(eq(publications.authorId, user.id));
      await this.outbox.add(tx, "ACCOUNT_PURGE", user.id, { userId: user.id });
    });
    res.clearCookie(this.env.SESSION_COOKIE_NAME, { path: "/" });
    return { ok: true, status: "DELETION_PENDING" };
  }
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  let cur = err as { code?: string; constraint?: string; cause?: unknown } | undefined;
  for (let i = 0; i < 4 && cur; i++) {
    if (cur.code === "23505" && cur.constraint === constraint) return true;
    cur = cur.cause as typeof cur;
  }
  return false;
}

function labelUserAgent(ua: string | undefined): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Navegador";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /iPhone|iPad/.test(ua) ? "iOS" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "dispositivo";
  return `${browser} en ${os}`;
}

