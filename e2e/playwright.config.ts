import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra el stack REAL (`pnpm infra:up` + `pnpm dev`): PostgreSQL/PostGIS, Redis, MinIO, Mailpit, API, worker y web.
 * Usa el Chrome instalado (sin descargar navegadores). Los tiles del mapa vienen de internet; si no hay red,
 * el mapa queda vacío pero el flujo sigue funcionando.
 */
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:5173",
    channel: process.env.E2E_CHANNEL ?? "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "es-PE",
    timezoneId: "America/Lima",
  },
  projects: [{ name: "chrome", use: { ...devices["Desktop Chrome"], channel: process.env.E2E_CHANNEL ?? "chrome" } }],
  webServer: process.env.E2E_NO_SERVER
    ? undefined
    : { command: "pnpm --dir .. dev", url: "http://localhost:5173", reuseExistingServer: true, timeout: 180_000, cwd: ".." },
});
