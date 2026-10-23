# Entorno, producción y operación

## Desarrollo

Ver el [README](../README.md#puesta-en-marcha-desde-cero). Variables en `.env` (copiado de `.env.example`):

| Grupo | Variables |
|---|---|
| Compartidas | `NODE_ENV`, `APP_ENV` (`development`/`demo`/`production`) |
| API | `API_PORT`, `DATABASE_URL`, `REDIS_URL`, `WEB_ORIGIN`, `ALLOWED_ORIGINS`, `PUBLIC_SITE_URL`, `TRUST_PROXY`, `COOKIE_SECURE`, `SESSION_*`, `APP_ENCRYPTION_KEY`, `RATE_LIMIT_ENABLED` |
| Archivos (Cloudflare R2) | `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT` (opcional), `UPLOAD_URL_TTL_SECONDS`, `MEDIA_*` |
| Correo (Resend) | `RESEND_API_KEY`, `MAIL_FROM`, `MAIL_REPLY_TO` (opcional), `DEV_MAIL_DIR` |
| Geo | `ROUTING_PROVIDER` (`none`/`osrm`/`fixture`), `OSRM_BASE_URL`, `GEOCODER_PROVIDER`, `NOMINATIM_BASE_URL`, `GEO_USER_AGENT` |
| Web | `WEB_PORT`, `API_INTERNAL_URL` (SSR→API), `PUBLIC_SITE_URL`, `VITE_MAP_TILES_URL`, `VITE_MAP_ATTRIBUTION`, `VITE_DEMO_BANNER` |

El entorno se valida con Zod al arrancar y falla con un mensaje claro. **Genera tu propia `APP_ENCRYPTION_KEY`** (`openssl rand -base64 32`).

### Cloudflare R2 (archivos)

1. En Cloudflare → **R2** → *Create bucket* (privado; **no** actives el acceso público ni el dominio `r2.dev`). Ese nombre es `R2_BUCKET`.
2. `R2_ACCOUNT_ID`: en la página de R2, barra lateral derecha (*Account ID*).
3. **Manage R2 API Tokens → Create API token** con permiso *Object Read & Write* limitado a ese bucket. Copia `R2_ACCESS_KEY_ID` y `R2_SECRET_ACCESS_KEY` (solo se muestran una vez). Con *Admin Read & Write* también valdría, pero no hace falta.
4. **CORS del bucket** (Settings → CORS Policy). El navegador sube directo a R2 con una URL PUT firmada, así que R2 debe aceptar tu origen:

```json
[
  {
    "AllowedOrigins": ["http://localhost:5173", "https://tu.dominio"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "MaxAgeSeconds": 3600
  }
]
```

Sin las cuatro variables `R2_*` la app arranca, pero subir o ver fotos responde 503 (`STORAGE_NOT_CONFIGURED`). En producción son obligatorias.

**Estructura dentro del bucket** (una carpeta por perfil):

```text
users/{userId}/avatar/{assetId}/original            foto de perfil subida (nunca se sirve)
users/{userId}/avatar/{assetId}/v1/{thumb,display}.webp
users/{userId}/places/{placeId}/{assetId}/original  fotos de visitas, agrupadas por lugar
users/{userId}/places/{placeId}/{assetId}/v1/{thumb,display}.webp
```

El código está en `apps/api/src/infrastructure/storage/keys.ts`; para otro tipo de contenido (banner de perfil, portadas…) se añade una carpeta allí.

**Borrado coherente con la base de datos.** Cuando una fila de `media_assets` se elimina (foto, visita, viaje, avatar reemplazado, cuenta), la misma transacción registra un evento del *outbox* y el worker borra de R2 la carpeta completa del archivo (original y todas sus versiones). Al borrar la cuenta se borra `users/{userId}/`. Como red de seguridad, cada 6 h el worker compara R2 con la base de datos y elimina los objetos de `users/…` sin fila (ignora lo de la última hora). Los archivos de una publicación no se borran hasta retirarla (409 `MEDIA_IN_PUBLICATION`).

### Resend (correo)

1. <https://resend.com> → **API Keys** → crea una clave → `RESEND_API_KEY`.
2. Para enviar a cualquier destinatario, verifica tu dominio (**Domains**) y usa un remitente de ese dominio en `MAIL_FROM` (p. ej. `"Por aquí <no-reply@tu.dominio>"`). Mientras tanto `onboarding@resend.dev` solo envía a la dirección de tu propia cuenta de Resend.
3. Sin `RESEND_API_KEY` (solo fuera de producción) el worker guarda cada correo como `.txt` en `.dev-mail/` (con el enlace) y lo escribe en su log. En producción la clave es obligatoria.

### Google (iniciar sesión, crear cuenta y foto de perfil)

Opcional: sin `GOOGLE_CLIENT_ID` y `GOOGLE_CLIENT_SECRET` el botón «Continuar con Google» no se muestra.

1. <https://console.cloud.google.com> → crea o elige un proyecto → **APIs y servicios → Pantalla de consentimiento de OAuth** (tipo *Externo*; scopes básicos `openid`, `email`, `profile`; mientras esté en «Pruebas», añade tu correo como usuario de prueba).
2. **Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web**.
3. **URI de redireccionamiento autorizado**: `<PUBLIC_SITE_URL>/api/v1/auth/google/callback` (en desarrollo: `http://localhost:5173/api/v1/auth/google/callback`; en producción, tu dominio con https).
4. Copia el ID y el secreto a `.env` (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) y reinicia API y worker.

Cómo se comporta (OpenID Connect con código + PKCE, `state` y `nonce`; el secreto nunca llega al navegador):
- **Cuenta nueva**: se crea con el correo ya verificado por Google, el nombre de Google y un usuario generado; hay que aceptar los términos (la casilla de «Crear cuenta»). La foto de perfil se descarga y pasa por el mismo procesamiento que cualquier foto (sin EXIF, derivados en R2).
- **Correo ya registrado**: se vincula a esa cuenta. Si esa cuenta no había verificado su correo, su contraseña anterior se invalida y se cierran sus sesiones (evita que alguien «reserve» tu correo antes que tú).
- **Cuentas creadas con Google** no tienen contraseña conocida: para usar el formulario de correo o para eliminar la cuenta, primero usa «¿Olvidaste tu contraseña?».
- Esto no sincroniza Google Maps: Google no ofrece una API para leer tu Timeline ni tus listas guardadas (el Timeline ahora vive solo en el dispositivo). La vía realista es importar archivos (GPX/KML o la exportación de Google Takeout).

### Importar recorridos (GPX, KML, Takeout)

No requiere claves ni proveedores: la persona sube un archivo desde **Nuevo viaje → Importar un recorrido**. Variables opcionales: `IMPORT_MAX_BYTES` (10 MB), `IMPORT_MAX_POINTS` (50 000) e `IMPORT_MAX_WAYPOINTS` (1 000); el filtrado por precisión y distancia reutiliza `TRACK_MAX_ACCURACY_M` y `TRACK_MIN_DISTANCE_M`. Cómo obtener los archivos de Google (descargar en [takeout.google.com](https://takeout.google.com) y descomprimir el ZIP):

- **Timeline**: «Cronología» / «Location History» → JSON (`Semantic Location History/2026/2026_MARCH.json`, `Records.json` o `Timeline.json`). Desde 2024 el Timeline vive en el dispositivo, no en Takeout: expórtalo desde la app de Google Maps del teléfono («Exportar datos de la cronología» en los ajustes de la cronología).
- **Lugares guardados**: «Maps (tus lugares)» → `Saved Places.json` (trae coordenadas) o los CSV de cada lista (suelen traer solo el enlace; se importan los que incluyen coordenadas).
- **GPX / KML**: Strava, Komoot, Garmin, Google Earth o «Mis mapas» (Exportar a KML).

Detalles de formatos, reglas y errores: [API.md](API.md#importar-recorridos-gpx-kml-google-takeout).

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
4. **Servicios**: PostgreSQL con PostGIS gestionado, Redis, archivos en **Cloudflare R2** (bucket privado, sin acceso público) y correo con **Resend**.
5. **Observabilidad**: `GET /api/v1/health/live` y `/health/ready`; logs JSON con `requestId` (el patrón de ruta se registra, no la URL, para no guardar tokens).
6. **Respaldos**: ver [DATABASE.md](DATABASE.md#backups-y-restauración).

> Las imágenes de producción y el Caddyfile están escritos pero **no se construyeron ni ejecutaron** en esta beta (ver [STATUS.md](STATUS.md)).

### Dokploy

Referencia: [dominios de Docker Compose en Dokploy](https://docs.dokploy.com/docs/core/docker-compose/domains).

1. Crea un servicio **Docker Compose** desde este repositorio y selecciona
   `compose.yaml` en la raíz como archivo Compose.
2. Copia las variables de tu archivo local `.env.production.example` (excluido de Git por contener credenciales)
   a **Environment** de Dokploy. Configura tu dominio HTTPS en `PUBLIC_SITE_URL`,
   una contraseña propia para PostgreSQL, `DATABASE_URL` con esa misma contraseña,
   `APP_ENCRYPTION_KEY`, las credenciales de R2 y Resend y un remitente verificado.
   Las variables adicionales de `.env.example` también pueden configurarse ahí.
3. En **Domains**, asigna tu dominio al servicio **`proxy`**, puerto de contenedor
   **`80`**, ruta `/`, con HTTPS. Traefik gestiona el certificado; Caddy recibe HTTP
   y enruta `/api/*` a la API y el resto a la web.
4. Despliega. El servicio `migrate` debe terminar con código 0 antes de que arranquen
   la API y el worker. Las migraciones se aplican en un servicio separado por despliegue.

Solo `proxy` se conecta a la red externa `dokploy-network` y a la red del stack.
PostgreSQL, Redis, API y web se comunican por la red del stack sin publicar puertos
en el host. Los datos de PostgreSQL y Redis persisten en volúmenes; no ejecutes
`docker compose down -v` si quieres conservarlos.

Las variables `VITE_MAP_*` son públicas y se incorporan durante el build: después
de cambiarlas, reconstruye la web. La aplicación valida las credenciales obligatorias
de producción al arrancar y no carga contenido de demostración.

Para ejecutar el mismo Compose fuera de Dokploy (con un proxy conectado a esa red):

```bash
cp .env.production.example .env
# Completa .env antes de continuar.
docker network create dokploy-network # solo si todavía no existe
docker compose up -d --build
docker compose logs migrate api worker
```

La infraestructura local sigue disponible con `pnpm infra:up` y
`infra/compose.yaml`.

### Límite de la revocación de medios

Las lecturas de fotos se autorizan en cada petición, así que retirar/ocultar una publicación corta el acceso de inmediato. Los tickets de historias por enlace viven 15 min (`MEDIA_TICKET_TTL_SECONDS`) y las respuestas públicas pueden permanecer en cachés intermedias hasta 5 min (`Cache-Control: public, max-age=300`). No se puede retirar lo que alguien ya descargó.

## Moderadores

`pnpm --filter @por-aqui/database db:promote correo@ejemplo.com [MODERATOR|USER]`.
