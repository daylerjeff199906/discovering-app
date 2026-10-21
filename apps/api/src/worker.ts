import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { loadDotenv } from "./config/env";

async function bootstrap() {
  loadDotenv();
  const { WorkerModule } = await import("./worker/worker.module");
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ["error", "warn"] });
  app.enableShutdownHooks();
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
