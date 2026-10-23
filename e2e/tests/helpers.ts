import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page } from "@playwright/test";
import sharp from "sharp";

/** Sin RESEND_API_KEY el worker deja cada correo como archivo en esta carpeta (raíz del repo). */
export const DEV_MAIL_DIR = path.resolve(process.cwd(), "..", process.env.DEV_MAIL_DIR ?? ".dev-mail");
export const PASSWORD = "claveSegura123";

export const uniq = (p: string) => `${p}${Math.random().toString(16).slice(2, 8)}`;

/** JPEG de prueba (con EXIF/GPS para comprobar que se elimina). */
export async function makeJpeg(width = 640, height = 480): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 25, g: 90, b: 60 } } })
    .jpeg()
    .withExif({ IFD0: { Copyright: "e2e" }, IFD3: { GPSLatitudeRef: "S", GPSLatitude: "3/1 44/1 56/1", GPSLongitudeRef: "W", GPSLongitude: "73/1 15/1 13/1" } })
    .toBuffer();
}

export async function latestMail(email: string): Promise<string> {
  const safe = email.replace(/[^a-z0-9@._-]/gi, "_");
  for (let i = 0; i < 40; i++) {
    const files = (await readdir(DEV_MAIL_DIR).catch(() => [] as string[])).filter((f) => f.endsWith(`-${safe}.txt`)).sort();
    const last = files.at(-1);
    if (last) return readFile(path.join(DEV_MAIL_DIR, last), "utf8");
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No llegó correo a ${email} (¿hay RESEND_API_KEY? con clave real el correo sale por Resend y no se puede leer aquí)`);
}

export interface Account {
  name: string;
  username: string;
  email: string;
}

/** Registro por la UI + verificación con el enlace del correo (archivo de DEV_MAIL_DIR) + inicio de sesión + onboarding omitido. */
export async function signUpVerifyLogin(page: Page, prefix = "e2e"): Promise<Account> {
  const username = uniq(`${prefix}_`);
  const email = `${username}@example.com`;
  const name = `Persona ${username}`;

  await page.goto("/registro");
  await page.getByLabel("Tu nombre").fill(name);
  await page.getByLabel("Nombre de usuario", { exact: true }).fill(username);
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel(/^Contraseña/).fill(PASSWORD);
  await page.getByLabel("Confirmar contraseña").fill(PASSWORD);
  await page.getByRole("checkbox", { name: /Acepto los/ }).check();
  await page.getByRole("button", { name: "Crear mi cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Un mensaje para empezar el viaje." })).toBeVisible();

  const text = await latestMail(email);
  const link = /(https?:\/\/\S+\/verificar-correo\?token=[A-Za-z0-9_%-]+)/.exec(text)?.[1];
  expect(link, "enlace de verificación en el correo").toBeTruthy();
  await page.goto(link!);
  await page.getByRole("button", { name: "Confirmar mi correo" }).click();
  await expect(page.getByRole("heading", { name: "¡Correo confirmado!" })).toBeVisible();

  await page.goto("/ingresar");
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel(/^Contraseña/).fill(PASSWORD);
  await page.getByRole("button", { name: "Ingresar" }).click();
  await page.waitForURL(/\/bienvenida/);
  await page.getByRole("button", { name: "Lo haré después" }).click();
  await page.waitForURL(/\/app\/viajes/);
  return { name, username, email };
}

export async function expectNoHorizontalOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, `scrollWidth ${scroll} > clientWidth ${client}`).toBeLessThanOrEqual(client);
}
