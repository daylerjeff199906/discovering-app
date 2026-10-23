import crypto from "node:crypto";
import argon2 from "argon2";
import { and, eq } from "drizzle-orm";
import { Pool } from "pg";
import { createDb } from "../index";
import * as s from "../schema";
import { seedCatalog } from "../seed-catalog";
import { databaseUrl } from "./env";

/**
 * Seeds deterministas SOLO para desarrollo/demostración.
 * - Catálogo de lugares de Iquitos, con ubicaciones de demostración sin verificar.
 * - Un autor de demostración (sin contraseña utilizable) con una ruta pública de texto: sin fotos.
 */
async function main() {
  const url = databaseUrl();
  if (process.env.APP_ENV === "production" || process.env.NODE_ENV === "production") {
    throw new Error("db:seed está deshabilitado en producción.");
  }
  const pool = new Pool({ connectionString: url, max: 2 });
  const db = createDb(pool);

  try {
    await seedCatalog(db);
    if (process.env.ENABLE_DEMO_CONTENT !== "false") await seedDemoAuthor(db);
  } finally {
    await pool.end();
  }
}

async function seedDemoAuthor(db: ReturnType<typeof createDb>) {
  const email = "demo-autor@poraqui.invalid";
  const existing = await db.select().from(s.users).where(eq(s.users.emailNormalized, email)).limit(1);
  let userId = existing[0]?.id;
  if (!userId) {
    // Contraseña aleatoria que nunca se muestra: esta cuenta no sirve para iniciar sesión.
    const passwordHash = await argon2.hash(crypto.randomBytes(32).toString("hex"), { type: argon2.argon2id });
    const [u] = await db
      .insert(s.users)
      .values({ emailOriginal: email, emailNormalized: email, passwordHash, emailVerifiedAt: new Date(), termsVersion: "demo", termsAcceptedAt: new Date() })
      .returning({ id: s.users.id });
    userId = u!.id;
    await db.insert(s.profiles).values({
      userId,
      username: "demo_poraqui",
      usernameNormalized: "demo_poraqui",
      displayName: "Equipo Por aquí (demostración)",
      bio: "Cuenta de demostración con contenido de ejemplo. No es una persona real.",
      isDemo: true,
      onboardingCompletedAt: new Date(),
    });
  }

  const [already] = await db.select().from(s.publications).where(eq(s.publications.slug, "iquitos-en-un-dia-demo")).limit(1);
  if (already) return console.log("✔ Autor y ruta de demostración ya existen");

  const iq = await db.select().from(s.places).where(and(eq(s.places.provider, "demo-seed"), eq(s.places.locality, "Iquitos")));
  const pick = ["iq-plaza-armas", "iq-casa-fierro", "iq-malecon", "iq-museo-amazonico"].map((k) => iq.find((p) => p.providerPlaceId === k)!);

  await db.transaction(async (tx) => {
    const [journey] = await tx
      .insert(s.journeys)
      .values({ ownerId: userId!, title: "Iquitos en un día (demostración)", creationMode: "MANUAL", planStatus: "READY", preferencesJson: { interests: ["historia"], pace: "RELAXED", transport: "WALK" } })
      .returning({ id: s.journeys.id });
    const [rec] = await tx
      .insert(s.recordings)
      .values({ journeyId: journey!.id, status: "COMPLETED", startedAt: new Date("2026-03-14T14:00:00Z"), endedAt: new Date("2026-03-14T22:00:00Z") })
      .returning({ id: s.recordings.id });
    const [pub] = await tx
      .insert(s.publications)
      .values({ journeyId: journey!.id, authorId: userId!, slug: "iquitos-en-un-dia-demo", visibility: "PUBLIC", revision: 1, firstPublishedAt: new Date("2026-03-15T12:00:00Z") })
      .returning({ id: s.publications.id });
    const [ver] = await tx
      .insert(s.publicationVersions)
      .values({
        publicationId: pub!.id,
        revision: 1,
        title: "Iquitos en un día (demostración)",
        description: "Ruta de ejemplo para mostrar cómo se ve una historia publicada. Contenido de demostración, sin fotos reales.",
        authorDisplaySnapshot: { username: "demo_poraqui", displayName: "Equipo Por aquí (demostración)", avatarAssetId: null, isDemo: true },
        locationLabel: "Iquitos, Loreto, Perú",
        transportSummary: "A pie",
        interestSlugs: ["historia", "arquitectura", "relax"],
        durationDays: 1,
      })
      .returning({ id: s.publicationVersions.id });
    const notes = ["Punto de partida del recorrido.", "Detalle arquitectónico para fotografiar.", "Paseo tranquilo junto al río.", "Cierre con una visita al museo."];
    for (const [idx, p] of pick.entries()) {
      await tx.insert(s.publicationEntries).values({
        versionId: ver!.id,
        position: idx,
        displayName: p.name,
        locationLabel: "Iquitos",
        publicLocation: p.location,
        locationPrecision: "EXACT",
        note: `${notes[idx]} (texto de demostración)`,
        visitedLocalDate: "2026-03-14",
        catalogPlaceId: p.id,
      });
    }
    await tx.update(s.publications).set({ activeVersionId: ver!.id }).where(eq(s.publications.id, pub!.id));
    void rec;
  });
  console.log("✔ Autor y ruta pública de demostración creados");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
