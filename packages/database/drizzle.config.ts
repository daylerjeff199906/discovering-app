import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://poraqui:poraqui_dev_password@localhost:5440/poraqui" },
  strict: true,
  verbose: true,
});
