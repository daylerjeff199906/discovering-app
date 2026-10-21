import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { expectNoHorizontalOverflow, makeJpeg, signUpVerifyLogin } from "./helpers";

const WIDTHS = [360, 390, 768, 1024, 1440];
const SHOTS = path.resolve(__dirname, "../../docs/screenshots");

async function shot(page: Page, name: string) {
  await page.waitForTimeout(1500); // deja cargar tiles del mapa y fotos
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: false });
}

test("pantallas privadas: sin desbordamiento y con capturas (móvil 390 y escritorio 1440)", async ({ page }) => {
  test.setTimeout(240_000);
  const problems: string[] = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text().slice(0, 300)}`));
  await page.setViewportSize({ width: 1440, height: 900 });
  await signUpVerifyLogin(page, "pantallas");

  // Viaje automático (Cusco) con propuesta aplicada
  await page.getByRole("link", { name: "Nuevo viaje" }).first().click();
  await page.getByText("Armar automáticamente").click();
  await page.getByRole("textbox", { name: "Destino" }).fill("Cusco");
  await page.getByRole("button", { name: "Crear viaje" }).click();
  await page.waitForURL(/\/editar/);
  await page.getByRole("button", { name: "Armar propuesta automática" }).click();
  const dialog = page.getByRole("dialog", { name: "Armar una propuesta" });
  await dialog.getByRole("button", { name: "Generar propuesta" }).click();
  await expect(dialog.getByText("Origen de los datos:")).toBeVisible();
  await dialog.getByRole("button", { name: "Aplicar propuesta" }).click();
  await expect(dialog).toBeHidden();
  const editorUrl = page.url();
  const journeyId = /\/viajes\/([^/]+)\/editar/.exec(editorUrl)![1]!;

  // Recorrido + una visita con foto
  await page.getByRole("button", { name: "Iniciar recorrido" }).click();
  await page.waitForURL(/\/recorrido/);
  await page.getByRole("button", { name: "Confirmar visita" }).first().click();
  await expect(page.getByText(/registrada\./)).toBeVisible();
  await page.getByRole("link", { name: "Fotos y nota" }).first().click();
  await page.locator("#photo-input").setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: await makeJpeg(1200, 800) });
  await expect(page.getByText("Lista ✓")).toBeVisible({ timeout: 60_000 });
  const visitUrl = page.url();

  const pages: [string, string][] = [
    ["editor", `/app/viajes/${journeyId}/editar`],
    ["recorrido", `/app/viajes/${journeyId}/recorrido`],
    ["visita", visitUrl.replace(/^https?:\/\/[^/]+/, "")],
    ["visita-nueva", `/app/viajes/${journeyId}/visitas/nueva`],
    ["resumen", `/app/viajes/${journeyId}`],
    ["mis-viajes", "/app/viajes"],
    ["perfil", "/app/perfil"],
    ["cuenta", "/app/cuenta"],
    ["nuevo-viaje", "/app/viajes/nuevo"],
    ["guardados", "/app/guardados"],
  ];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, url] of pages) {
      await page.goto(url);
      await expect(page.locator("main#contenido"), `${name} @${width}: ${problems.join(" | ")}`).toBeVisible();
      await page.waitForTimeout(400);
      await expectNoHorizontalOverflow(page);
      if (name === "editor" && width === 1024) {
        // Sin tres columnas forzadas en tablet: la columna de preferencias se apila sobre el recorrido
        const prefs = await page.getByRole("heading", { name: "Preferencias" }).boundingBox();
        const plan = await page.getByRole("region", { name: "Plan del viaje" }).or(page.getByLabel("Plan del viaje")).first().boundingBox();
        expect(prefs && plan && prefs.y < plan.y).toBeTruthy();
      }
      if ((width === 1440 || width === 390) && ["editor", "recorrido", "visita", "mis-viajes", "resumen"].includes(name)) await shot(page, `${name}-${width}`);
    }
  }

  // Finalizar, compartir y capturar la pantalla de publicación
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/app/viajes/${journeyId}/recorrido`);
  await page.getByRole("button", { name: "Finalizar", exact: true }).click();
  await page.getByRole("button", { name: "Finalizar y guardar" }).click();
  await expect(page.getByText("¡Recorrido finalizado!")).toBeVisible();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`/app/viajes/${journeyId}/compartir`);
    await expect(page.getByRole("heading", { name: "Compartir tu historia" })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await shot(page, `compartir-${width}`);
  }
});

test("capturas públicas (móvil 390 y escritorio 1440)", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const [name, url] of [["inicio", "/"], ["explorar", "/explorar"], ["historia", "/r/iquitos-en-un-dia-demo"], ["registro", "/registro"]] as const) {
      await page.goto(url);
      await shot(page, `${name}-${width}`);
    }
  }
});
