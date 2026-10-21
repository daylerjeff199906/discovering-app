import { Inject, Injectable } from "@nestjs/common";
import { ERROR_CODES } from "@por-aqui/contracts";
import type { Redis } from "ioredis";
import { AppError } from "../common/errors";
import { ENV, type Env } from "../config/env";
import { REDIS } from "./tokens";

/** Ventana fija en Redis. Falla abierto si Redis no responde (registrado en logs). */
@Injectable()
export class RateLimitService {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async hit(key: string, limit: number, windowSec: number): Promise<void> {
    if (!this.env.RATE_LIMIT_ENABLED) return;
    try {
      const k = `rl:${key}`;
      const n = await this.redis.incr(k);
      if (n === 1) await this.redis.expire(k, windowSec);
      if (n > limit) {
        const ttl = await this.redis.ttl(k);
        throw new AppError(429, ERROR_CODES.RATE_LIMITED, "Demasiados intentos. Espera un momento e inténtalo de nuevo.", undefined, { retryAfterSec: Math.max(ttl, 1) });
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      console.error(JSON.stringify({ level: "error", msg: "rate-limit redis failure", err: String(err) }));
    }
  }

  /** Cooldown simple: devuelve false si todavía está activo. */
  async cooldown(key: string, seconds: number): Promise<boolean> {
    if (!this.env.RATE_LIMIT_ENABLED) return true;
    const ok = await this.redis.set(`cd:${key}`, "1", "EX", seconds, "NX");
    return ok === "OK";
  }
}
