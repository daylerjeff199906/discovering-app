import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { makeJpeg, signUpVerifyLogin } from "./helpers";

/**
 * Comprobación AUTOMATIZADA con axe-core (WCAG 2.0/2.1 A y AA, incluido el contraste de color).
 * No sustituye una revisión manual con lector de pantalla; solo detecta lo que una herramienta puede detectar.
 */
async function audit(page: Page, label: string) {
  await page.waitForTimeout(600);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const lines = results.violations.map((v) => `${v.id} [${v.impact}] ×${v.nodes.length}: ${v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" | ")}`);
  expect.soft(lines, `${label}\n${lines.join("\n")}`).toEqual([]);
}

test("accesibilidad (axe) en pantallas públicas y de cuenta", async ({ page }) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/explorar", "/r/iquitos-en-un-dia-demo", "/ingresar", "/registro", "/recuperar-cuenta", "/terminos"]) {
      await page.goto(path);
      await audit(page, `${path} @${width}`);
    }
  }
});

test("accesibilidad (axe) en el editor, el recorrido, la visita y compartir", async ({ page }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 900 });
  await signUpVerifyLogin(page, "a11y");
  await audit(page, "/app/viajes (vacío)");

  await page.getByRole("link", { name: "Nuevo viaje" }).first().click();
  await audit(page, "/app/viajes/nuevo");
  await page.getByText("Armar automáticamente").click();
  await page.getByRole("textbox", { name: "Destino" }).fill("Iquitos");
  await page.getByRole("button", { name: "Crear viaje" }).click();
  await page.waitForURL(/\/editar/);
  await page.getByRole("button", { name: "Armar propuesta automática" }).click();
  const dialog = page.getByRole("dialog", { name: "Armar una propuesta" });
  await audit(page, "diálogo de propuesta (formulario)");
  await dialog.getByRole("button", { name: "Generar propuesta" }).click();
  await expect(dialog.getByText("Origen de los datos:")).toBeVisible();
  await audit(page, "diálogo de propuesta (resultado)");
  await dialog.getByRole("button", { name: "Aplicar propuesta" }).click();
  await expect(dialog).toBeHidden();
  await audit(page, "editor");

  await page.getByRole("button", { name: "Añadir parada" }).first().click();
  await audit(page, "diálogo añadir parada");
  await page.getByRole("dialog", { name: "Añadir una parada" }).getByRole("button", { name: "Cerrar" }).click();

  await page.getByRole("button", { name: "Iniciar recorrido" }).click();
  await page.waitForURL(/\/recorrido/);
  await page.getByRole("button", { name: "Confirmar visita" }).first().click();
  await expect(page.getByText(/registrada\./)).toBeVisible();
  await audit(page, "recorrido en vivo");
  await page.getByRole("link", { name: "Fotos y nota" }).first().click();
  await page.locator("#photo-input").setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: await makeJpeg() });
  await expect(page.getByText("Lista ✓")).toBeVisible({ timeout: 60_000 });
  await audit(page, "visita con foto");

  await page.goto(page.url().replace(/\/visitas\/.*/, "/recorrido"));
  await page.getByRole("button", { name: "Finalizar", exact: true }).click();
  await audit(page, "diálogo finalizar");
  await page.getByRole("button", { name: "Finalizar y guardar" }).click();
  await expect(page.getByText("¡Recorrido finalizado!")).toBeVisible();
  await audit(page, "diario");
  await page.getByRole("link", { name: /Compartir \/ publicar/ }).click();
  await expect(page.getByRole("heading", { name: "Compartir tu historia" })).toBeVisible();
  await audit(page, "compartir");
  await page.goto("/app/perfil");
  await audit(page, "perfil");
  await page.goto("/app/cuenta");
  await audit(page, "cuenta");
});
