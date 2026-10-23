// Comprueba qué credenciales externas están configuradas en .env (NUNCA imprime sus valores).
//   pnpm check:env
import { existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const file = path.join(root, ".env");
if (!existsSync(file)) {
  console.error("✘ No existe .env. Ejecuta: cp .env.example .env");
  process.exit(1);
}
process.loadEnvFile(file);
const e = process.env;
const set = (k) => Boolean(e[k] && e[k].trim());

const groups = [
  ["Cloudflare R2 (fotos y avatares)", ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"], "Sin ellas NO se pueden subir fotos ni avatar."],
  ["Resend (correo)", ["RESEND_API_KEY"], "Sin ella los correos se guardan como archivo en " + (e.DEV_MAIL_DIR || ".dev-mail") + " (solo desarrollo)."],
  ["Google (acceso con Google, opcional)", ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"], "Sin ellas el botón «Continuar con Google» no aparece."],
];

let missing = 0;
for (const [name, keys, note] of groups) {
  const ok = keys.filter(set);
  const done = ok.length === keys.length;
  if (!done) missing++;
  console.log(`${done ? "✔" : "○"} ${name}: ${ok.length}/${keys.length}`);
  for (const k of keys) console.log(`    ${set(k) ? "✔" : "✘"} ${k}`);
  if (!done) console.log(`    ↳ ${note}`);
}
if (e.RESEND_API_KEY && !e.RESEND_API_KEY.startsWith("re_")) console.log("⚠ RESEND_API_KEY no empieza con «re_»: revisa que sea la clave correcta.");
if (/onboarding@resend\.dev/.test(e.MAIL_FROM ?? "") && set("RESEND_API_KEY")) console.log("ℹ MAIL_FROM usa onboarding@resend.dev: Resend solo entregará a tu propio correo hasta que verifiques un dominio.");
console.log(missing ? "\nPega lo que falte en .env y reinicia la API y el worker (pnpm preview / pnpm dev)." : "\nTodo configurado ✔");
