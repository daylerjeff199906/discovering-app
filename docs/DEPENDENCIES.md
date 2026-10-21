# Dependencias y compatibilidad

Verificado el **21 de octubre de 2026** contra el registro de npm y la documentación instalada. Todas las versiones están **fijadas** (sin `^`/`~`), con `pnpm-lock.yaml` versionado. No se usan tags flotantes (`latest`) en Docker ni en `package.json`.

## Runtime y herramientas

| Pieza | Versión | Motivo |
|---|---|---|
| Node.js | 24 LTS (probado con 24.11.0) | React Router 8 exige ≥ 22.22; Vitest 5 y Nest 11 funcionan en 24. Fijado en `.nvmrc` y `engines`. |
| pnpm | 11.12.0 (`packageManager`) | Workspaces. pnpm 11 bloquea scripts de instalación por defecto → `allowBuilds` explícito en `pnpm-workspace.yaml` (argon2, sharp, esbuild, swc, msgpackr). |
| Turborepo | 2.11.7 | Tareas por dependencia (`^build`). |
| TypeScript | **5.9.3** | Ver nota. |
| ESLint | 10.13.0 + typescript-eslint 8.72.0 | typescript-eslint 8.72 admite TS `<6.1`. |

## Aplicación

| Paquete | Versión | Notas de compatibilidad |
|---|---|---|
| react / react-dom | 19.3.1 | React Router 8.5 exige ≥ 19.2.7. |
| react-router, @react-router/* | 8.5.0 | Framework Mode (SSR). v8 cambia `meta({ loaderData })`; mismo modelo que v7. |
| vite | **8.3.4** (override global) | Compatible con @react-router/dev 8.5 (`^7 \|\| ^8`), @tailwindcss/vite y Vitest 5. |
| tailwindcss + @tailwindcss/vite | 4.3.3 | Tokens como variables CSS + `@theme inline`. |
| @tanstack/react-query | 5.104.5 | Verdad remota; hidratación explícita con `dehydrate`/`HydrationBoundary`. |
| zustand | 5.0.15 | Estado de interfaz (store por montaje, no singleton de módulo). |
| react-hook-form + @hookform/resolvers | 7.90.0 + 6.0.0 | El resolver 6 acepta Zod 3.25 o 4. |
| zod | 4.6.7 | Fuente de contratos compartidos (línea estable actual). |
| maplibre-gl | 6.15.0 | Se importa como espacio de nombres (sin export por defecto). Carga perezosa solo en cliente. |
| @dnd-kit/core · sortable · utilities | 6.3.1 · 10.0.0 · 3.2.2 | Compatible con React 19; siempre hay alternativa Subir/Bajar. |
| idb | 8.0.4 | Cola local en IndexedDB. |
| @fontsource-variable/inter · lora | 5.3.0 | Fuentes **locales** (sin CDN), `font-display: swap`. |
| lucide-react | 1.55.0 | Iconos lineales. |
| @nestjs/common · core · platform-express | **11.2.7** | Ver nota. |
| @nestjs/swagger | 11.4.7 | OpenAPI; los esquemas de entrada se generan con `z.toJSONSchema` de Zod 4. |
| drizzle-orm / drizzle-kit | 0.45.4 / 0.31.11 | Esquema + migraciones SQL (más migración manual para PostGIS/triggers). |
| pg | 8.23.1 | |
| bullmq | 6.3.12 | Colas; ioredis 5.11.1 para el límite de peticiones. |
| @aws-sdk/client-s3 · s3-presigned-post | 3.1149.0 | POST prefirmado con `content-length-range`. |
| sharp | 0.35.5 | Procesado de imágenes (límite de píxeles, orientación, sin EXIF). |
| argon2 | 0.45.1 | Argon2id (19 MiB, t=2, p=1). |
| nodemailer | 10.1.7 | Trae sus propios tipos. |
| vitest | 5.0.5 (+ unplugin-swc 2.0.0 en la API) | Metadatos de decoradores de Nest vía SWC. |
| @playwright/test | 1.64.1 | Usa el Chrome instalado (`channel: chrome`). |

### Notas de decisión

- **NestJS 11 en lugar de 12.** Nest 12 (12.2.0 es la última) es ESM‑only y su ecosistema (swagger, etc.) aún no está alineado; Nest 11 es CommonJS y estable. El monolito está escrito para migrarse sin cambios de dominio.
- **TypeScript 5.9 en lugar de 7.** TS 7 (compilador nativo) rompe herramientas del ecosistema que importan aquí (typescript-eslint admite `<6.1`, @nestjs/swagger `^5.5 \|\| ^6`).
- **Versiones recientes evitadas.** pnpm 11 aplica una política de edad mínima de publicación; en lugar de excluirla, se bajó a la versión anterior con ≥ 10 días (vite 8.3.5 → 8.3.4, bullmq 6.4.0 → 6.3.12, turbo 2.11.10 → 2.11.7, lucide-react 1.61.0 → 1.55.0, AWS SDK 3.1154 → 3.1149).
- **MinIO.** MinIO dejó de publicar imágenes oficiales en Docker Hub (octubre 2025). En desarrollo se usa la build comunitaria **`coollabsio/minio:RELEASE.2025-10-15T17-29-55Z`** (incluye `mc`). Es solo para desarrollo; en producción usa S3 u otro almacenamiento compatible mantenido (la API solo necesita el SDK de S3).

## Infraestructura (Docker, versiones fijadas)

| Servicio | Imagen |
|---|---|
| PostgreSQL + PostGIS | `postgis/postgis:17-3.5` (PostGIS 3.5) |
| Redis | `redis:7.4-alpine` |
| S3 (desarrollo) | `coollabsio/minio:RELEASE.2025-10-15T17-29-55Z` |
| Correo (desarrollo) | `axllent/mailpit:v1.24.1` |
