import "reflect-metadata";
import { loadDotenv } from "./config/env";

async function bootstrap() {
  loadDotenv();
  const { createApp } = await import("./bootstrap");
  const app = await createApp();
  const port = Number(process.env.API_PORT ?? 4000);
  await app.listen(port);
  console.log(JSON.stringify({ level: "info", msg: "api lista", port, docs: `http://localhost:${port}/api/docs` }));
}

bootstrap().catch((err) => {
  console.error(err);
  process.exit(1);
});
