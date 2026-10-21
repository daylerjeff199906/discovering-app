import { Inject, Injectable } from "@nestjs/common";
import { outboxEvents, type DbExecutor } from "@por-aqui/database";
import { encryptJson } from "../common/crypto";
import { ENV, type Env } from "../config/env";

export type OutboxTopic = "EMAIL_VERIFY" | "EMAIL_RESET" | "EMAIL_ACCOUNT_EXISTS" | "MEDIA_PROCESS" | "MEDIA_DELETE" | "ACCOUNT_PURGE";

export const TOPIC_QUEUE: Record<OutboxTopic, "email" | "media" | "purge"> = {
  EMAIL_VERIFY: "email",
  EMAIL_RESET: "email",
  EMAIL_ACCOUNT_EXISTS: "email",
  MEDIA_PROCESS: "media",
  MEDIA_DELETE: "media",
  ACCOUNT_PURGE: "purge",
};

/**
 * Outbox transaccional: el evento se escribe en la MISMA transacción que el cambio de negocio.
 * Un dispatcher lo entrega después a BullMQ con jobId estable (entrega al menos una vez; los
 * consumidores son idempotentes). Los datos sensibles (tokens) viajan cifrados con AES-GCM y se
 * borran del registro cuando el evento se procesa.
 */
@Injectable()
export class OutboxService {
  constructor(@Inject(ENV) private readonly env: Env) {}

  async add(tx: DbExecutor, topic: OutboxTopic, aggregateId: string | null, payload: Record<string, unknown>, opts: { sensitive?: boolean } = {}): Promise<string> {
    const stored = opts.sensitive ? { enc: encryptJson(this.env.APP_ENCRYPTION_KEY, payload) } : payload;
    const [row] = await tx.insert(outboxEvents).values({ topic, aggregateId, payloadJson: stored }).returning({ id: outboxEvents.id });
    return row!.id;
  }
}
