// Levanta el stack COMPILADO (sin vigilantes de archivos): API + worker + web SSR + proxy de origen único.
//   pnpm build && pnpm preview
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
if (existsSync(path.join(root, ".env"))) process.loadEnvFile(path.join(root, ".env"));
const webPort = process.env.WEB_SSR_PORT ?? "3000";

// PREVIEW_DEV_MAIL=1: correos a archivo (DEV_MAIL_DIR) en vez de Resend; lo necesitan las pruebas E2E, que leen los enlaces de ahí.
const mailEnv = process.env.PREVIEW_DEV_MAIL === "1" ? { RESEND_API_KEY: "" } : {};

const procs = [
  ["api", "node", ["apps/api/dist/main.js"], mailEnv],
  ["worker", "node", ["apps/api/dist/worker.js"], mailEnv],
  ["web", "pnpm", ["--filter", "@por-aqui/web", "start"], { PORT: webPort }],
  ["proxy", "node", ["scripts/local-proxy.mjs"], { WEB_SSR_PORT: webPort }],
];

const children = procs.map(([name, cmd, args, env]) => {
  const child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env }, shell: process.platform === "win32", stdio: ["ignore", "pipe", "pipe"] });
  const tag = (line) => process.stdout.write(`[${name}] ${line}\n`);
  child.stdout.on("data", (d) => String(d).split(/\r?\n/).filter(Boolean).forEach(tag));
  child.stderr.on("data", (d) => String(d).split(/\r?\n/).filter(Boolean).forEach(tag));
  child.on("exit", (code) => {
    tag(`terminó (${code})`);
    shutdown(code ?? 1);
  });
  return child;
});

let closing = false;
function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  for (const c of children) c.kill();
  setTimeout(() => process.exit(code), 500);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
