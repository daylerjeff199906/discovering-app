import { Inject, Injectable } from "@nestjs/common";
import { mediaAssets, outboxEvents, users, type Db } from "@por-aqui/database";
import { and, eq, isNull, sql } from "drizzle-orm";
import { decryptJson } from "../common/crypto";
import { ENV, type Env } from "../config/env";
import { MailerPort, accountExistsMessage, resetPasswordMessage, verifyEmailMessage } from "../infrastructure/mail/mailer";
import { TOPIC_QUEUE, type OutboxTopic } from "../infrastructure/outbox.service";
import { StoragePort } from "../infrastructure/storage/storage";
import { DB, QUEUES, type QueueMap } from "../infrastructure/tokens";
import { MediaService } from "../modules/media/media.service";

const SENSITIVE: OutboxTopic[] = ["EMAIL_VERIFY", "EMAIL_RESET"];

/** Consumidores idempotentes del outbox: ejecutar dos veces el mismo evento no duplica efectos. */
@Injectable()
export class OutboxHandlers {
  constructor(
    @Inject(DB) private readonly db: Db,
    @Inject(ENV) private readonly env: Env,
    @Inject(QUEUES) private readonly queues: QueueMap,
    private readonly mailer: MailerPort,
    private readonly storage: StoragePort,
    private readonly media: MediaService,
  ) {}

  /** Entrega a BullMQ con jobId estable (= id del evento). Si se cae entre el envío y la marca, repetir es seguro. */
  async dispatchOnce(limit = 50): Promise<number> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: string; topic: OutboxTopic }>(sql`
        SELECT id, topic FROM outbox_events
        WHERE delivered_at IS NULL AND next_attempt_at <= now()
        ORDER BY created_at LIMIT ${limit} FOR UPDATE SKIP LOCKED`);
      for (const row of rows.rows) {
        await this.queues[TOPIC_QUEUE[row.topic]].add(row.topic, { outboxId: row.id }, { jobId: row.id, attempts: 5, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: { age: 3600 }, removeOnFail: { age: 86_400 } });
        await tx.update(outboxEvents).set({ deliveredAt: new Date() }).where(eq(outboxEvents.id, row.id));
      }
      return rows.rows.length;
    });
  }

  /** Procesa un evento. Lo usan los workers de BullMQ y (en pruebas) la ejecución en línea. */
  async handle(outboxId: string): Promise<void> {
    const [ev] = await this.db.select().from(outboxEvents).where(eq(outboxEvents.id, outboxId));
    if (!ev || ev.processedAt) return;
    try {
      const raw = ev.payloadJson as Record<string, unknown>;
      const payload = typeof raw.enc === "string" ? decryptJson<Record<string, unknown>>(this.env.APP_ENCRYPTION_KEY, raw.enc) : raw;
      const topic = ev.topic as OutboxTopic;

      switch (topic) {
        case "EMAIL_VERIFY":
          await this.mailer.send(verifyEmailMessage(String(payload.to), String(payload.displayName), `${this.env.PUBLIC_SITE_URL}/verificar-correo?token=${encodeURIComponent(String(payload.token))}`));
          break;
        case "EMAIL_RESET":
          await this.mailer.send(resetPasswordMessage(String(payload.to), String(payload.displayName), `${this.env.PUBLIC_SITE_URL}/restablecer-clave?token=${encodeURIComponent(String(payload.token))}`));
          break;
        case "EMAIL_ACCOUNT_EXISTS":
          await this.mailer.send(accountExistsMessage(String(payload.to), `${this.env.PUBLIC_SITE_URL}/ingresar`, `${this.env.PUBLIC_SITE_URL}/recuperar-cuenta`));
          break;
        case "MEDIA_PROCESS":
          await this.media.process(String(payload.assetId));
          break;
        case "MEDIA_DELETE":
          await this.storage.deleteMany((payload.keys as string[]) ?? []);
          break;
        case "ACCOUNT_PURGE":
          await this.purgeAccount(String(payload.userId));
          break;
      }
      // Los payloads sensibles (tokens) se borran en cuanto se procesan.
      await this.db
        .update(outboxEvents)
        .set({ processedAt: new Date(), lastErrorCode: null, ...(SENSITIVE.includes(topic) || topic === "EMAIL_ACCOUNT_EXISTS" ? { payloadJson: {} } : {}) })
        .where(eq(outboxEvents.id, outboxId));
    } catch (err) {
      await this.db
        .update(outboxEvents)
        .set({ attempts: sql`${outboxEvents.attempts} + 1`, lastErrorCode: err instanceof Error ? err.name.slice(0, 60) : "ERROR" })
        .where(eq(outboxEvents.id, outboxId));
      throw err;
    }
  }

  /** Procesa en línea todo lo pendiente (pruebas y modo sin Redis de trabajo). */
  async runPendingInline(): Promise<number> {
    const rows = await this.db.select({ id: outboxEvents.id }).from(outboxEvents).where(and(isNull(outboxEvents.processedAt), sql`${outboxEvents.nextAttemptAt} <= now()`)).orderBy(outboxEvents.createdAt);
    let n = 0;
    for (const r of rows) {
      await this.handle(r.id);
      n++;
    }
    return n;
  }

  /** Purga de cuenta: objetos del almacenamiento y luego datos propios (las FK en cascada hacen el resto). */
  private async purgeAccount(userId: string): Promise<void> {
    const assets = await this.db.select({ o: mediaAssets.originalKey, t: mediaAssets.thumbnailKey, d: mediaAssets.displayKey }).from(mediaAssets).where(eq(mediaAssets.ownerId, userId));
    await this.storage.deleteMany(assets.flatMap((a) => [a.o, a.t, a.d]).filter((k): k is string => Boolean(k)));
    await this.db.delete(users).where(and(eq(users.id, userId), eq(users.accountStatus, "DELETION_PENDING")));
  }
}
