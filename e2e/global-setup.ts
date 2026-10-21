/** Espera a que la web y la API estén ESTABLES (varias respuestas consecutivas), no solo levantadas una vez. */
export default async function globalSetup() {
  const base = process.env.E2E_BASE_URL ?? "http://localhost:5173";
  let ok = 0;
  const deadline = Date.now() + 120_000;
  while (ok < 6 && Date.now() < deadline) {
    try {
      const [api, web] = await Promise.all([fetch(`${base}/api/v1/health/ready`), fetch(`${base}/`)]);
      ok = api.ok && web.ok ? ok + 1 : 0;
    } catch {
      ok = 0;
    }
    await new Promise((r) => setTimeout(r, 700));
  }
  if (ok < 6) throw new Error("El stack no está estable. Ejecuta `pnpm infra:up` y `pnpm dev` antes de los E2E.");
}
