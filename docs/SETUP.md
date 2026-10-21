# Entorno, producción y operación

## Desarrollo

Ver el [README](../README.md#puesta-en-marcha-desde-cero). Variables en `.env` (copiado de `.env.example`):

| Grupo | Variables |
|---|---|
| Compartidas | `NODE_ENV`, `APP_ENV` (`development`/`demo`/`production`) |
| API | `API_PORT`, `DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN`, `ALLOWED_ORIGINS`, `PUBLIC_SITE_URL`, `TRUST_PROXY`, `COOKIE_SECURE`, `SESSION_*`, `APP_ENCRYPTION_KEY`, `RATE_LIMIT_ENABLED` |
| Almacenamiento | `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `UPLOAD_URL_TTL_SECONDS`, `MEDIA_*` |
| Correo | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` |
| Geo | `ROUTING_PROVIDER` (`none`/`osrm`/`fixture`), `OSRM_BASE_URL`, `GEOCODER_PROVIDER`, `NOMINATIM_BASE_URL`, `GEO_USER_AGENT` |
| Web | `WEB_PORT`, `API_INTERNAL_URL` (SSR→API), `PUBLIC_SITE_URL`, `VITE_MAP_TILES_URL`, `VITE_MAP_ATTRIBUTION`, `VITE_DEMO_BANNER` |

El entorno se valida con Zod al arrancar y falla con un mensaje claro. **Genera tu propia `APP_ENCRYPTION_KEY`** (`openssl rand -base64 32`).

### Mapas

Por omisión se usan tiles raster de OpenStreetMap solo para desarrollo (su política de uso no admite tráfico de producción). Configura `VITE_MAP_TILES_URL` con un proveedor propio o autohospedado.

### Estados honestos de proveedores

Sin `ROUTING_PROVIDER` los traslados quedan «Por definir»; sin `GEOCODER_PROVIDER` el buscador de direcciones no se muestra. `ROUTING_PROVIDER=osrm` requiere `OSRM_BASE_URL`. En producción **no** se permite `fixture` ni el contenido de demostración.

### Procesos

`pnpm dev` arranca la API (compila con `tsc --watch` y reinicia con `node --watch`), el worker y la web. Los paquetes `contracts` y `database` se compilan antes (`^build`); si los editas, ejecuta `pnpm --filter @por-aqui/contracts build` (o `pnpm dev:packages` en otra terminal).

## Producción

1. **Imágenes**: `infra/Dockerfile.api` (API y worker, mismo código con otro comando) y `infra/Dockerfile.web`. Construye con la raíz del repo como contexto: `docker build -f infra/Dockerfile.api -t poraqui-api .`
2. **Origen único**: `infra/Caddyfile` enruta `/api/*` → `api:4000` y el resto → `web:3000`; Caddy gestiona TLS. Configura `COOKIE_SECURE=true`, `WEB_ORIGIN`/`ALLOWED_ORIGINS`/`PUBLIC_SITE_URL` con tu dominio y `TRUST_PROXY=true` detrás del proxy.
3. **Migraciones**: ejecútalas **una vez por release** (`node` o `pnpm db:migrate` desde el job de despliegue), nunca desde cada réplica.
4. **Servicios**: PostgreSQL con PostGIS gestionado, Redis, almacenamiento S3 **privado** (sin política pública), SMTP transaccional.
5. **Observabilidad**: `GET /api/v1/health/live` y `/health/ready`; logs JSON con `requestId` (el patrón de ruta se registra, no la URL, para no guardar tokens).
6. **Respaldos**: ver [DATABASE.md](DATABASE.md#backups-y-restauración).

> Las imágenes de producción y el Caddyfile están escritos pero **no se construyeron ni ejecutaron** en esta beta (ver [STATUS.md](STATUS.md)).

### Límite de la revocación de medios

Las lecturas de fotos se autorizan en cada petición, así que retirar/ocultar una publicación corta el acceso de inmediato. Los tickets de historias por enlace viven 15 min (`MEDIA_TICKET_TTL_SECONDS`) y las respuestas públicas pueden permanecer en cachés intermedias hasta 5 min (`Cache-Control: public, max-age=300`). No se puede retirar lo que alguien ya descargó.

## Moderadores

`pnpm --filter @por-aqui/database db:promote correo@ejemplo.com [MODERATOR|USER]`.
