# Por aquí

Beta web para **descubrir recorridos compartidos, preparar viajes y registrar visitas con fotos y notas**. Cada viaje termina en un diario con un caminito vertical (`JourneyTrail`); la persona decide si queda privado, se comparte por enlace o se publica en la comunidad.

Monorepo **pnpm + Turborepo**: React Router (Framework Mode, SSR) + Vite · NestJS · PostgreSQL/PostGIS + Drizzle · Redis/BullMQ · archivos en Cloudflare R2 (bucket privado) · correo con Resend · MapLibre.

> Estado, límites y qué se probó realmente: ver [docs/STATUS.md](docs/STATUS.md).

## Requisitos

Administración de contenidos: `/app/catalogo` (rol `MODERATOR`). Permite editar el banner, las tarjetas de creación, ciudades y lugares con sus imágenes. Guía: [docs/CATALOG.md](docs/CATALOG.md).

| Herramienta | Versión |
|---|---|
| Node.js | 24 LTS (mínimo 22.22; ver `.nvmrc`) |
| pnpm | 11 (`corepack enable` o `npm i -g pnpm@11.12.0`) |
| Docker | Docker Desktop / Engine con Compose v2 |

## Puesta en marcha desde cero

```bash
pnpm install
cp .env.example .env          # valores de desarrollo; sin secretos reales
pnpm infra:up                 # PostGIS 17 y Redis (espera a que estén sanos)
pnpm db:migrate               # migraciones SQL (paso único; no se ejecutan al arrancar)
pnpm db:seed                  # intereses, catálogo de DEMOSTRACIÓN y una ruta pública de ejemplo
pnpm dev                      # contratos + API :4000 + worker + web :5173
```

Abre <http://localhost:5173>. Utilidades locales:

| Servicio | URL |
|---|---|
| Web (SSR) | <http://localhost:5173> |
| API REST + OpenAPI | <http://localhost:4000/api/docs> · JSON en `/api/v1/openapi.json` |
| Correos de verificación/recuperación (sin `RESEND_API_KEY`) | carpeta `.dev-mail/` en la raíz y log del worker |
| Panel de Cloudflare R2 / Resend | claves en `.env` (ver [docs/SETUP.md](docs/SETUP.md#cloudflare-r2-archivos)) |

El navegador usa **un solo origen** (`:5173`): Vite proxea `/api/*` hacia Nest, igual que lo haría el proxy inverso en producción (ver `infra/Caddyfile`).

### Probar el flujo completo a mano

1. `/registro` → crea una cuenta. Con `RESEND_API_KEY` el correo llega a tu bandeja; sin ella queda en `.dev-mail/` (abre el `.txt`). Abre el enlace y pulsa «Confirmar mi correo».
2. `/ingresar` → onboarding opcional → **Nuevo viaje**:
   - *Armar automáticamente*: destino «Iquitos» (catálogo de demostración) → propuesta explicable → aplicar.
   - *Armar manualmente*: busca lugares o marca un punto en el mapa; reordena arrastrando o con *Subir/Bajar*.
   - *Registrar mientras exploro*: sin itinerario; confirma visitas, añade fotos y notas; GPS opcional.
3. Finaliza el recorrido → **Compartir** → elige visitas/fotos/notas y visibilidad → publica.
4. `/explorar` muestra la historia; con otra cuenta puedes **guardarla**, **usarla como base** o **reportarla**.
5. Moderación: `pnpm --filter @por-aqui/database db:promote tu@correo.com` y entra a `/moderacion`.

## Scripts

| Comando | Qué hace |
|---|---|
| `pnpm dev` | Todo en desarrollo (vigilantes; la API puede reiniciarse unos segundos al arrancar) |
| `pnpm build && pnpm preview` | Stack **compilado y estable** (API + worker + SSR + proxy de origen único en :5173) |
| `pnpm dev:packages` | Reconstruye `contracts`/`database` en caliente (opcional) |
| `pnpm build` | Compila paquetes, API y web |
| `pnpm lint` · `pnpm typecheck` | ESLint · TypeScript estricto |
| `pnpm test` | Unitarias y de integración (Vitest; la API usa PostgreSQL/PostGIS y Redis **reales**; R2 y Resend se sustituyen por versiones en memoria) |
| `pnpm test:e2e` | Playwright + Chrome instalado (necesita `pnpm infra:up` y el stack en :5173; recomendado `pnpm build` y `RATE_LIMIT_ENABLED=false pnpm preview`) |
| `pnpm db:generate` | Genera una migración de Drizzle a partir de `schema.ts` |
| `pnpm db:migrate` · `db:seed` · `db:reset` | Migrar · sembrar demostración · reiniciar la BD (solo desarrollo) |
| `pnpm check:env` | Muestra qué credenciales (Cloudflare R2, Resend) faltan en `.env`, sin imprimir sus valores |
| `pnpm infra:up` · `infra:down` | Levantar/bajar Docker Compose |

## Estructura

```text
apps/web      React Router (SSR) · rutas delgadas + features
apps/api      NestJS monolito modular (API REST /api/v1) y worker (src/worker.ts)
packages/contracts   Zod compartido (browser-safe): entradas, salidas, errores
packages/api-client  Cliente fetch tipado, CSRF, errores normalizados, subida con progreso
packages/database    Drizzle: esquema, migraciones SQL, seeds (solo servidor)
packages/ui          Tokens, primitivas accesibles y JourneyTrail
infra/               Docker Compose, Dockerfiles, Caddyfile
docs/                ARCHITECTURE · DATABASE · API · DEPENDENCIES · SETUP · DESIGN · STATUS
e2e/                 Playwright
```

## Documentación

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) – decisiones, flujo HTTP, seguridad, tareas asíncronas
- [docs/DATABASE.md](docs/DATABASE.md) – modelo, restricciones, migraciones
- [docs/API.md](docs/API.md) – grupos de endpoints, errores, idempotencia
- [docs/DEPENDENCIES.md](docs/DEPENDENCIES.md) – versiones exactas y por qué
- [docs/SETUP.md](docs/SETUP.md) – entorno, producción, backups
- [docs/DESIGN.md](docs/DESIGN.md) – identidad visual y accesibilidad
- [docs/STATUS.md](docs/STATUS.md) – **qué está probado, qué no, y límites de la beta**
