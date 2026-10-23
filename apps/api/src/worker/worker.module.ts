import { Inject, Injectable, Module, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { type Db, outboxEvents } from "@por-aqui/database";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { ConfigModule } from "../config/config.module";
import { ENV, type Env } from "../config/env";
import { InfrastructureModule } from "../infrastructure/infrastructure.module";
import { StoragePort } from "../infrastructure/storage/storage";
import { DB, QUEUE_NAMES, redisConnectionOptions } from "../infrastructure/tokens";
import { MediaModule } from "../modules/media/media.module";
import { MediaService } from "../modules/media/media.service";
import { OutboxHandlers } from "./outbox.handlers";

/** Proceso worker: dispatcher del outbox + consumidores BullMQ (email, medios, purga). */
@Injectable()
class WorkerRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private workers: Worker[] = [];
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(
    @Inject(ENV) private readonly env: Env,
    @Inject(DB) private readonly db: Db,
    private readonly handlers: OutboxHandlers,
    private readonly storage: StoragePort,
    private readonly media: MediaService,
  ) {}
  private lastCleanup = 0;
  private lastReconcile = 0;

  async onApplicationBootstrap() {
    await this.storage.checkBucket().catch((err) => console.error(JSON.stringify({ level: "error", msg: "R2 no responde", err: String(err) })));
    const connection = redisConnectionOptions(this.env.REDIS_URL);
    const specs: [keyof typeof QUEUE_NAMES, number][] = [["email", 4], ["media", 3], ["purge", 1]];
    for (const [name, concurrency] of specs) {
      const w = new Worker(QUEUE_NAMES[name], (job) => this.handlers.handle((job.data as { outboxId: string }).outboxId), { connection, concurrency });
      w.on("failed", (job, err) => {
        const exhausted = job && job.attemptsMade >= (job.opts.attempts ?? 1);
        console.error(JSON.stringify({ level: "error", msg: "job failed", queue: name, outboxId: job?.data?.outboxId, exhausted, err: err.message }));
        if (exhausted && job?.data?.outboxId) {
          // Reintentos agotados: queda registrado y visible para operación (no se pierde en silencio).
          void this.db.update(outboxEvents).set({ lastErrorCode: `EXHAUSTED:${err.name}`.slice(0, 60) }).where(eq(outboxEvents.id, job.data.outboxId));
        }
      });
      this.workers.push(w);
    }
    this.timer = setInterval(() => void this.tick(), 1000);
    console.log(JSON.stringify({ level: "info", msg: "worker listo", queues: Object.values(QUEUE_NAMES) }));
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.handlers.dispatchOnce();
      if (Date.now() - this.lastCleanup > 10 * 60_000) {
        this.lastCleanup = Date.now();
        await this.media.cleanupOrphans();
      }
      if (Date.now() - this.lastReconcile > 6 * 3_600_000) {
        this.lastReconcile = Date.now();
        const removed = await this.media.reconcileStorage();
        if (removed > 0) console.log(JSON.stringify({ level: "info", msg: "R2: objetos huérfanos eliminados", removed }));
      }
    } catch (err) {
      console.error(JSON.stringify({ level: "error", msg: "dispatcher", err: String(err) }));
    } finally {
      this.busy = false;
    }
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    await Promise.allSettled(this.workers.map((w) => w.close()));
  }
}

@Module({
  imports: [ConfigModule.forRoot(), InfrastructureModule, MediaModule],
  providers: [OutboxHandlers, WorkerRunner],
  exports: [OutboxHandlers],
})
export class WorkerModule {}
