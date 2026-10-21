import { expect, type Page } from "@playwright/test";
import sharp from "sharp";

export const MAILPIT = `http://localhost:${process.env.MAILPIT_UI_PORT ?? 8030}`;
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
  for (let i = 0; i < 40; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const list = (await res.json()) as { messages: { ID: string }[] };
    if (list.messages[0]) {
      const msg = (await (await fetch(`${MAILPIT}/api/v1/message/${list.messages[0].ID}`)).json()) as { Text: string };
      return msg.Text;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`No llegó correo a ${email}`);
}

export interface Account {
  name: string;
  username: string;
  email: string;
}

/** Registro por la UI + verificación con el enlace real del correo (Mailpit) + inicio de sesión + onboarding omitido. */
export async function signUpVerifyLogin(page: Page, prefix = "e2e"): Promise<Account> {
  const username = uniq(`${prefix}_`);
  const email = `${username}@example.com`;
  const name = `Persona ${username}`;

  await page.goto("/registro");
  await page.getByLabel("Nombre visible").fill(name);
  await page.getByLabel(/^Usuario/).fill(username);
  await page.getByLabel("Correo electrónico").fill(email);
  await page.getByLabel(/^Contraseña/).fill(PASSWORD);
  await page.getByLabel("Confirmar contraseña").fill(PASSWORD);
  await page.getByRole("checkbox", { name: /Acepto los/ }).check();
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Revisa tu correo" })).toBeVisible();

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
  await page.getByRole("button", { name: "Omitir por ahora" }).click();
  await page.waitForURL(/\/app\/viajes/);
  return { name, username, email };
}

export async function expectNoHorizontalOverflow(page: Page) {
  const { scroll, client } = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
  expect(scroll, `scrollWidth ${scroll} > clientWidth ${client}`).toBeLessThanOrEqual(client);
}
