import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, signUpVerifyLogin } from "./helpers";

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="e2e" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Paseo importado (e2e)</name></metadata>
  <wpt lat="-3.7437" lon="-73.2455"><time>2026-03-14T14:10:00Z</time><name>Plaza de Armas</name></wpt>
  <trk><trkseg>
    <trkpt lat="-3.74370" lon="-73.24550"><time>2026-03-14T14:00:00Z</time></trkpt>
    <trkpt lat="-3.74330" lon="-73.24500"><time>2026-03-14T14:01:00Z</time></trkpt>
    <trkpt lat="-3.74290" lon="-73.24450"><time>2026-03-14T14:02:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

test("importar un recorrido GPX: vista previa, confirmación y diario", async ({ page }) => {
  await signUpVerifyLogin(page, "import");

  /* ── Enlace desde «Nueva aventura» ── */
  await page.getByRole("link", { name: "Nueva aventura" }).first().click();
  await page.getByRole("link", { name: "Importar un recorrido" }).click();
  await expect(page.getByRole("heading", { name: "Importar recorrido" })).toBeVisible();
  const submit = page.getByRole("button", { name: "Importar recorrido" });
  await expect(submit).toBeDisabled();
  await expectNoHorizontalOverflow(page);

  /* ── Un archivo que no es válido: mensaje claro y no se puede confirmar ── */
  await page.getByLabel("Archivo").setInputFiles({ name: "notas.txt", mimeType: "text/plain", buffer: Buffer.from("esto no es un recorrido") });
  await expect(page.getByRole("alert").filter({ hasText: "No pudimos importar este archivo" })).toContainText(/No reconocemos este archivo/);
  await expect(submit).toBeDisabled();

  /* ── GPX válido: la vista previa cuenta puntos, distancia, fechas y lugares ── */
  await page.getByLabel("Archivo").setInputFiles({ name: "paseo.gpx", mimeType: "application/gpx+xml", buffer: Buffer.from(GPX) });
  const preview = page.getByLabel("Vista previa de la importación");
  await expect(preview.getByRole("heading", { name: "Paseo importado (e2e)" })).toBeVisible();
  await expect(preview.getByText("Puntos GPS").locator("xpath=following-sibling::dd")).toHaveText("3");
  await expect(preview.getByText("Lugares", { exact: true }).first().locator("xpath=following-sibling::dd")).toHaveText("1");
  await expect(preview.getByText("Plaza de Armas")).toBeVisible();
  await expect(preview.getByText(/mar/i).first()).toBeVisible(); // fechas del archivo (14 mar)
  await expect(submit).toBeEnabled();

  /* ── Confirmar: lleva al diario de la aventura finalizado ── */
  await page.getByLabel("Nombre de la aventura").fill("Mi paseo importado");
  await submit.click();
  await page.waitForURL(/\/app\/viajes\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Mi paseo importado").first()).toBeVisible();
  await expect(page.getByText("Finalizado").first()).toBeVisible();
  await expect(page.getByText("Plaza de Armas").first()).toBeVisible();

  /* ── Aparece en «Mis aventuras» como finalizada ── */
  await page.goto("/app/viajes");
  await expect(page.getByText("Mi paseo importado").first()).toBeVisible();
});
