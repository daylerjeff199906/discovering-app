import type { Queue } from "bullmq";

export const DB = Symbol("DB");
export const POOL = Symbol("POOL");
export const REDIS = Symbol("REDIS");
export const QUEUES = Symbol("QUEUES");

export const QUEUE_NAMES = { email: "pa-email", media: "pa-media", purge: "pa-purge" } as const;
export type QueueName = keyof typeof QUEUE_NAMES;
export type QueueMap = Record<QueueName, Queue>;

export function redisConnectionOptions(url: string) {
  const u = new URL(url);
  return { host: u.hostname, port: Number(u.port || 6379), password: u.password || undefined, username: u.username || undefined, maxRetriesPerRequest: null as null };
}
