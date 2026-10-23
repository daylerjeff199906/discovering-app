import { expect, test } from "@playwright/test";
import { expectNoHorizontalOverflow, makeJpeg, signUpVerifyLogin } from "./helpers";

test.describe.configure({ mode: "serial" });

test("flujo completo: cuenta → ruta manual → recorrido con foto → publicar → explorar → copiar", async ({ page, browser }) => {
  const author = await signUpVerifyLogin(page, "autor");

  /* ── Crear ruta manual y añadir paradas ── */
  await page.getByRole("link", { name: "Nueva aventura" }).first().click();
  await page.getByText("Armar manualmente").click();
  await page.getByLabel("Nombre de tu aventura").fill("Mi día en Iquitos (e2e)");
  await page.getByRole("button", { name: "Crear aventura" }).click();
  await page.waitForURL(/\/editar/);
  await expect(page.getByLabel("Título de la aventura")).toHaveValue("Mi día en Iquitos (e2e)");

  for (const name of ["Plaza de Armas de Iquitos", "Casa de Fierro", "Malecón Tarapacá"]) {
    await page.getByRole("button", { name: "Añadir parada" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Añadir una parada" });
    await dialog.getByLabel("Buscar un lugar para añadir").fill(name);
    await dialog.getByLabel("Buscar un lugar para añadir").press("Enter");
    await dialog.getByRole("button", { name: `Añadir ${name}` }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("list", { name: "Paradas del día 1" }).getByRole("button", { name, exact: true })).toBeVisible();
  }

  const stopTitles = () => page.getByRole("list", { name: "Paradas del día 1" }).locator("> li").evaluateAll((lis) => lis.map((li) => li.querySelector("button[aria-pressed], h3")?.textContent?.trim()));
  expect(await stopTitles()).toEqual(["Plaza de Armas de Iquitos", "Casa de Fierro", "Malecón Tarapacá"]);

  /* ── Reordenar por botones (alternativa accesible al arrastre) y persistir tras recargar ── */
  await page.getByRole("button", { name: "Subir Malecón Tarapacá" }).click();
  await expect.poll(stopTitles).toEqual(["Plaza de Armas de Iquitos", "Malecón Tarapacá", "Casa de Fierro"]);
  await page.reload();
  await expect(page.getByLabel("Título de la aventura")).toHaveValue("Mi día en Iquitos (e2e)");
  await expect.poll(stopTitles).toEqual(["Plaza de Armas de Iquitos", "Malecón Tarapacá", "Casa de Fierro"]);

  // Sin proveedor de rutas: los traslados quedan «Por definir» (nunca inventados)
  await expect(page.getByText("Por definir").first()).toBeVisible();
  await page.getByRole("button", { name: "Guardar plan" }).click();
  await expect(page.getByRole("button", { name: "Plan guardado ✓" })).toBeVisible();

  /* ── Recorrido: confirmar visita, foto, finalizar ── */
  await page.getByRole("button", { name: "Iniciar recorrido" }).click();
  await page.waitForURL(/\/recorrido/);
  await page.getByRole("button", { name: "Iniciar recorrido" }).click(); // pantalla «Comenzar aventura»
  await expect(page.getByText("Registrar trayecto (GPS)")).toBeVisible();
  await page.getByRole("button", { name: "Confirmar visita" }).first().click();
  await expect(page.getByText(/Visita en «Plaza de Armas de Iquitos» registrada/)).toBeVisible();

  await page.getByRole("link", { name: "Fotos y nota" }).first().click();
  await page.waitForURL(/\/visitas\//);
  await page.getByLabel("Nota").fill("Nota privada de la plaza");
  await page.getByLabel(/¿Cuánto gastaste aquí\?/).fill("23.50");
  await page.getByRole("radio", { name: "A pie" }).click();
  await expect(page.getByRole("radio", { name: "A pie" })).toHaveAttribute("aria-checked", "true");
  await page.getByLabel("Tu recomendación").fill("Ve temprano, hay menos gente");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("Guardado ✓")).toBeVisible();
  await page.getByLabel("Elegir fotos de la visita").setInputFiles({ name: "foto.jpg", mimeType: "image/jpeg", buffer: await makeJpeg() });
  await expect(page.getByText("Lista ✓")).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("button", { name: "Ver foto 1", exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Volver a la aventura" }).click();
  /* Diario: foto como polaroid + gasto y recomendación visibles solo para su autor */
  await expect(page.locator(".polaroid-stack").first()).toBeVisible();
  await expect(page.getByText(/23[.,]50/).first()).toBeVisible();
  await expect(page.getByText("Ve temprano, hay menos gente").first()).toBeVisible();
  /* Ruta planeada: las paradas pendientes se pueden marcar con «Estoy aquí» desde el resumen */
  await expect(page.getByRole("heading", { name: "Próximas paradas" })).toBeVisible();
  await page.getByRole("button", { name: "Estoy aquí" }).first().click();
  await expect(page.getByText(/Marcaste que estás en/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Diario de la aventura" })).toBeVisible();
  await page.goto(page.url().replace(/\/app\/viajes\/([^/?]+).*/, "/app/viajes/$1/recorrido"));
  await page.getByRole("button", { name: "Finalizar", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Finalizar recorrido" })).toBeVisible();
  await page.getByRole("button", { name: "Guardar recorrido" }).click();
  await expect(page.getByText("¡Recorrido finalizado!")).toBeVisible();

  /* ── Publicar ── */
  await page.goto(page.url().replace(/(\/app\/viajes\/[^/?]+).*/, "$1/compartir")); // el diario ahora comparte desde una hoja; la página de publicación sigue en /compartir
  await expect(page.getByRole("heading", { name: "Compartir tu historia" })).toBeVisible();
  await expect(page.getByLabel(/^Título/)).toHaveValue("Mi día en Iquitos (e2e)");
  await page.getByRole("radio", { name: /Comunidad/ }).check();
  await page.getByRole("button", { name: "Publicar…" }).click();
  await page.getByRole("button", { name: "Publicar en la comunidad" }).click();
  await expect(page.getByText("Estado actual")).toBeVisible();
  await expect(page.getByText("Comunidad", { exact: true }).first()).toBeVisible();
  const slugHref = await page.getByRole("link", { name: /Ver publicada/ }).getAttribute("href");
  expect(slugHref).toMatch(/\/r\/mi-dia-en-iquitos-e2e-/);

  /* ── Anónimo: Explorar y la historia (HTML renderizado en servidor) ── */
  const anonCtx = await browser.newContext({ locale: "es-PE" });
  const anon = await anonCtx.newPage();
  await anon.goto(`/explorar?q=${encodeURIComponent("Mi día en Iquitos (e2e)")}`);
  await expect(anon.getByRole("heading", { name: "Mi día en Iquitos (e2e)" }).first()).toBeVisible();
  await anon.getByRole("link", { name: "Mi día en Iquitos (e2e)" }).first().click();
  await expect(anon.getByRole("heading", { level: 1, name: "Mi día en Iquitos (e2e)" })).toBeVisible();
  const trail = anon.getByRole("list", { name: /Paradas de/ });
  await expect(trail.locator("> li")).toHaveCount(2); // solo las visitas confirmadas (2 de 3 paradas)
  await expect(anon.getByText("Ve temprano, hay menos gente")).toHaveCount(0); // la recomendación solo se publica si el autor lo elige
  await expect(anon.getByText(/23[.,]50/)).toHaveCount(0); // el gasto nunca se publica
  await expect(anon.getByText("Nota privada de la plaza")).toHaveCount(0); // las notas no se publican salvo que el autor las elija
  await expect(anon.getByRole("img", { name: /Foto en Plaza de Armas/ }).first()).toBeVisible(); // la foto derivada se sirve públicamente
  const html = await (await anonCtx.request.get(slugHref!)).text();
  expect(html).toContain("<title>Mi día en Iquitos (e2e) — Por aquí</title>");
  expect(html).toContain('property="og:title"');
  expect(html).toContain("Plaza de Armas de Iquitos"); // contenido presente sin ejecutar JS
  expect(html).not.toContain("Nota privada de la plaza");
  expect(html).not.toContain(author.email);

  /* ── Otra cuenta: guardar y usar como base (sin fotos ni notas) ── */
  const readerCtx = await browser.newContext({ locale: "es-PE" });
  const reader = await readerCtx.newPage();
  await signUpVerifyLogin(reader, "lector");
  await reader.goto(slugHref!);
  await reader.getByRole("button", { name: "Guardar inspiración" }).click();
  await expect(reader.getByRole("button", { name: "Guardada" })).toBeVisible();
  await reader.getByRole("button", { name: "Usar como base" }).click();
  await reader.waitForURL(/\/editar/);
  await expect(reader.getByText("Copiamos las paradas a tu borrador")).toBeVisible();
  await expect(reader.getByRole("list", { name: "Paradas del día 1" }).getByText("Plaza de Armas de Iquitos")).toBeVisible();
  await expect(reader.getByText("Nota privada de la plaza")).toHaveCount(0);
  await reader.goto("/app/guardados");
  await reader.getByRole("tab", { name: "Historias" }).click();
  await expect(reader.getByRole("heading", { name: "Mi día en Iquitos (e2e)" })).toBeVisible();

  /* ── El autor retira la publicación: el acceso se corta ── */
  await page.getByRole("button", { name: "Retirar (volver a privado)" }).click();
  await expect(page.getByText("Privado", { exact: true }).first()).toBeVisible();
  await expect.poll(async () => (await anonCtx.request.get(slugHref!)).status()).toBe(410);
  await reader.goto("/app/guardados");
  await reader.getByRole("tab", { name: "Historias" }).click();
  await expect(reader.getByText("Historia no disponible")).toBeVisible();

  await anonCtx.close();
  await readerCtx.close();
});

test("ruta automática: propuesta explicable, aplicación y persistencia", async ({ page }) => {
  await signUpVerifyLogin(page, "auto");
  await page.getByRole("link", { name: "Nueva aventura" }).first().click();
  await page.getByText("Armar automáticamente").click();
  await page.getByRole("button", { name: "Crear aventura" }).click();
  await page.waitForURL(/\/editar/);
  await page.getByRole("button", { name: "Armar propuesta automática" }).click();
  const dialog = page.getByRole("dialog", { name: "Armar una propuesta" });
  await dialog.getByRole("button", { name: "Generar propuesta" }).click();
  await expect(dialog.getByText("Origen de los datos:")).toBeVisible();
  await expect(dialog.getByText(/Sin proveedor de rutas/).first()).toBeVisible();
  await expect(dialog.getByText("Por definir").first()).toBeVisible();
  await dialog.getByRole("button", { name: "Aplicar propuesta" }).click();
  await expect(dialog).toBeHidden();
  const list = page.getByRole("list", { name: "Paradas del día 1" });
  await expect(list.locator("> li").first()).toBeVisible();
  const n = await list.locator("> li").count();
  expect(n).toBeGreaterThanOrEqual(2);
  await page.reload();
  await expect(page.getByRole("list", { name: "Paradas del día 1" }).locator("> li")).toHaveCount(n);
});

test("sin desbordamiento horizontal a 360, 390, 768, 1024 y 1440 px", async ({ page }) => {
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of ["/", "/explorar", "/r/iquitos-en-un-dia-demo", "/ingresar", "/registro"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      await expectNoHorizontalOverflow(page);
    }
  }
});

test("teclado: foco visible y salto al contenido", async ({ page }) => {
  await page.goto("/explorar");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Saltar al contenido" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#contenido")).toBeFocused();
});

test("rutas privadas redirigen a ingresar conservando la intención", async ({ page }) => {
  await page.goto("/app/viajes/nuevo");
  await page.waitForURL(/\/ingresar\?returnTo=%2Fapp%2Fviajes%2Fnuevo/);
  await page.goto("/ingresar?returnTo=https%3A%2F%2Fevil.example");
  await expect(page.getByRole("heading", { name: "Qué bueno verte por aquí." })).toBeVisible();
});
