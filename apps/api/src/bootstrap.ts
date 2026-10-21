import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import { AppModule } from "./app.module";
import { ENV, type Env } from "./config/env";
import { StoragePort } from "./infrastructure/storage/storage";

/** Construye la aplicación (la usan main.ts y las pruebas de integración). */
export async function createApp(overrides: Record<string, string> = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule.forRoot(overrides), {
    logger: process.env.NODE_ENV === "test" ? false : ["error", "warn", "log"],
  });
  const env = app.get<Env>(ENV);

  app.set("trust proxy", env.TRUST_PROXY === "true" ? 1 : env.TRUST_PROXY === "false" ? false : env.TRUST_PROXY);
  app.disable("x-powered-by");
  app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
  app.use(cookieParser());
  app.useBodyParser("json", { limit: "1mb" });
  app.enableCors({
    origin: env.ALLOWED_ORIGINS,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
    allowedHeaders: ["Content-Type", "X-CSRF-Token", "X-Request-Id"],
    exposedHeaders: ["X-Request-Id", "Retry-After"],
    maxAge: 600,
  });
  app.setGlobalPrefix("api/v1");
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle("Por aquí API")
      .setDescription("API REST versionada de la beta. Autenticación por cookie de sesión HttpOnly; las mutaciones exigen X-CSRF-Token (ver GET /auth/csrf).")
      .setVersion("0.1.0")
      .addCookieAuth(env.SESSION_COOKIE_NAME)
      .build(),
  );
  SwaggerModule.setup("api/docs", app, document, { jsonDocumentUrl: "api/v1/openapi.json" });

  await app.get(StoragePort).ensureBucket().catch((err) => console.error(JSON.stringify({ level: "warn", msg: "ensureBucket failed", err: String(err) })));
  return app;
}
