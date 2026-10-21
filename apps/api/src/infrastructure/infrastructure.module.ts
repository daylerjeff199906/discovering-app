import { Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { createDb, createPool, type Db } from "@por-aqui/database";
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import type { Pool } from "pg";
import { ENV, type Env } from "../config/env";
import { MailerPort, SmtpMailer } from "./mail/mailer";
import { OutboxService } from "./outbox.service";
import { RateLimitService } from "./rate-limit.service";
import { GeocoderPort, RoutingPort, createGeocoder, createRouting } from "./geo/providers";
import { S3Storage, StoragePort } from "./storage/storage";
import { DB, POOL, QUEUES, QUEUE_NAMES, REDIS, redisConnectionOptions, type QueueMap } from "./tokens";

@Injectable()
class Lifecycle implements OnApplicationShutdown {
  constructor(
    @Inject(POOL) private readonly pool: Pool,
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(QUEUES) private readonly queues: QueueMap,
  ) {}
  async onApplicationShutdown() {
    await Promise.allSettled(Object.values(this.queues).map((q) => q.close()));
    await Promise.allSettled([this.pool.end(), this.redis.quit()]);
  }
}

@Global()
@Module({
  providers: [
    { provide: POOL, inject: [ENV], useFactory: (env: Env): Pool => createPool(env.DATABASE_URL) },
    { provide: DB, inject: [POOL], useFactory: (pool: Pool): Db => createDb(pool) },
    { provide: REDIS, inject: [ENV], useFactory: (env: Env) => new Redis(env.REDIS_URL, { maxRetriesPerRequest: 2, lazyConnect: false }) },
    {
      provide: QUEUES,
      inject: [ENV],
      useFactory: (env: Env): QueueMap => {
        const connection = redisConnectionOptions(env.REDIS_URL);
        return {
          email: new Queue(QUEUE_NAMES.email, { connection }),
          media: new Queue(QUEUE_NAMES.media, { connection }),
          purge: new Queue(QUEUE_NAMES.purge, { connection }),
        };
      },
    },
    { provide: StoragePort, inject: [ENV], useFactory: (env: Env) => new S3Storage(env) },
    { provide: MailerPort, inject: [ENV], useFactory: (env: Env) => new SmtpMailer(env) },
    { provide: RoutingPort, inject: [ENV], useFactory: (env: Env) => createRouting(env) },
    { provide: GeocoderPort, inject: [ENV], useFactory: (env: Env) => createGeocoder(env) },
    OutboxService,
    RateLimitService,
    Lifecycle,
  ],
  exports: [DB, POOL, REDIS, QUEUES, StoragePort, MailerPort, RoutingPort, GeocoderPort, OutboxService, RateLimitService],
})
export class InfrastructureModule {}
