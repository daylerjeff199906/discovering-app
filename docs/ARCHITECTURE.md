# Arquitectura

Monolito modular: **dos procesos del mismo producto** (web SSR y API/worker NestJS) que comparten contratos. No hay microservicios.

```text
Navegador ──► origen único (:5173 en dev / Caddy en prod)
                 ├─ /api/v1/*  ──► NestJS (permisos, validación, negocio)  ──► PostgreSQL+PostGIS
                 │                         ├─ outbox_events ─► dispatcher ─► BullMQ/Redis ─► worker
                 │                         └─ S3 privado (MinIO en dev)                       ├─ email (SMTP/Mailpit)
                 └─ resto      ──► React Router SSR (solo presenta)                           ├─ fotos (sharp)
                                        └─ loaders ──► API por URL interna (sin cookies de usuario)  └─ purga de cuenta
```

## Reglas de dependencia

- **web** importa `contracts`, `api-client` y `ui`; nunca `database` ni secretos. Toda variable `VITE_*` es pública.
- **api** importa `contracts` y `database`; nunca componentes de web.
- **contracts** no importa Nest, Drizzle ni APIs de Node (es *browser-safe*).
- **ui** no sabe autenticar ni consultar viajes: recibe props.
- Los loaders SSR solo obtienen datos y renderizan; **Nest conserva permisos, validación y negocio**.

## Backend (apps/api)

`src/modules/*` (auth, users, meta, places, journeys, planning, recordings, media, publications, moderation) + `src/infrastructure/*` (DB, Redis, colas, almacenamiento, correo, proveedores geográficos, outbox, límite de peticiones) + `src/common/*` (guards, filtro de errores, decoradores, zod, cripto).

- Los controladores no ejecutan SQL: delegan en servicios. Hay **puertos** solo en fronteras sustituibles: `StoragePort`, `MailerPort`, `RoutingPort`, `GeocoderPort`.
- `@Api({ body, query })` valida con Zod **antes** del controlador y documenta en OpenAPI con el mismo esquema.
- Guards globales en este orden: **CSRF → sesión (denegado por omisión) → límite de peticiones**. `@Public()`, `@RequireVerified()` y `@Roles()` son explícitos.
- El filtro global devuelve `{ code, message, fieldErrors, requestId }`; traduce violaciones de restricciones de PostgreSQL (23505/23503/23514) y nunca expone stacktraces.

### Autenticación

- Sesión **opaca** en PostgreSQL: token aleatorio de 256 bits, en BD **solo su SHA-256**; cookie `HttpOnly`, `SameSite=Lax`, `Path=/`, host-only, `Secure` en producción. Sin JWT ni credenciales en `localStorage`.
- Rotación: el login revoca la sesión previa del navegador; cambiar la contraseña revoca las demás y rota la actual; restablecer la contraseña revoca todas.
- Caducidad absoluta (30 d) e inactividad (7 d) validadas en cada petición.
- Contraseñas **Argon2id** (19 MiB, t=2, p=1 — mínimos OWASP). El login de un usuario inexistente ejecuta una verificación ficticia para igualar tiempos.
- Tokens de verificación/restablecimiento: aleatorios, hash en BD, propósito, caducidad y **consumo atómico** (`UPDATE … WHERE consumed_at IS NULL`). La verificación del correo es un **POST explícito** (un GET lo consumirían los escáneres del correo).
- Registro y recuperación **no revelan** si un correo existe (respuesta idéntica; si ya existía, se envía un aviso por correo).
- CSRF: doble envío (`pa_csrf` + `X-CSRF-Token`) y validación de `Origin`; CORS cerrado a `ALLOWED_ORIGINS`.

### Procesos asíncronos

Las tareas se escriben en `outbox_events` **en la misma transacción** que el cambio de negocio. El *dispatcher* (en el worker) las entrega a BullMQ con `jobId` estable y las marca; los consumidores son **idempotentes** (`processed_at`) y los reintentos están acotados (5, backoff exponencial). No se promete *exactly-once*.

Los tokens de correo viajan en el outbox **cifrados con AES-256-GCM** (`APP_ENCRYPTION_KEY`, fuera de la BD) y el payload se borra al procesarse. Re-enviar un correo crea un token nuevo sin revocar el anterior.

Además, el worker limpia reservas de subida huérfanas (cada 10 min).

### Proveedores geográficos

`RoutingPort`: `none` (por omisión), `osrm` (servidor configurable; el demo público no es apto para producción) y `fixture` (determinista, **solo pruebas/demo**, prohibido en producción por la validación de entorno). Sin proveedor, los tramos quedan «Por definir»: **la distancia en línea recta solo ordena por proximidad aproximada, nunca se presenta como trayecto**. `GeocoderPort`: `none` / `nominatim`.

### Generador de rutas (sin LLM)

`planner.ts` (puro): afinidad de intereses + cercanía (haversine solo para ordenar) → selección voraz con límite de tiempo y de paradas por ritmo → mejora 2-opt acotada → tiempos de traslado **solo** si el proveedor los entrega → comprobación de horarios conocidos (los desconocidos se marcan) → origen de datos y advertencias explícitas. La propuesta no modifica el viaje; aplicarla exige la versión vigente (409 si cambió).

## Frontend (apps/web)

- React Router **Framework Mode**: `/`, `/explorar`, `/r/:slug`, `/s/:token`, `/u/:username` se renderizan en servidor con metadatos (título, descripción, canonical, Open Graph). Las rutas privadas (`/app/*`) renderizan solo el marco y piden sus datos en el cliente: el HTML no contiene datos de usuario y se sirve `private, no-store`.
- Cabeceras por ruta en `entry.server.tsx`: `nosniff`, `X-Frame-Options`, `Permissions-Policy` (geolocalización solo del propio origen) y, para `/s/*`, `noindex` + `no-store` + `Referrer-Policy: no-referrer`.
- **TanStack Query** guarda la verdad remota (hidratación explícita `dehydrate`/`HydrationBoundary`); un `QueryClient` por petición en servidor. **Zustand** solo para estado de interfaz (selección, paneles, indicador de guardado), en un store **por montaje** (no singleton de módulo). **React Hook Form + Zod** para formularios; los filtros paginables viven en la URL.
- Las mutaciones de un viaje se ejecutan **en serie** (`scope`) y leen la versión más reciente de la caché; un 409 recarga la versión vigente y avisa.
- **Offline acotado**: cola en IndexedDB (`poraqui-<userId>`) para visitas y puntos GPS; claves por usuario, versión de esquema con migración, límite de tamaño con aviso (no se descarta en silencio) y borrado al cerrar sesión. **No** se guardan archivos ni credenciales. Las fotos requieren conexión.
- **GPS**: solo en primer plano y solo tras activar «Registrar trayecto». Filtro por precisión y distancia mínima; al pausar/reanudar o perder señal se abre un **segmento nuevo** (nunca se unen huecos). Al finalizar se concilian *watermarks* con el servidor. No se vende como seguimiento en segundo plano.
- **MapLibre** se carga de forma perezosa y solo en el navegador (no en login/registro).

## Seguridad: resumen

Denegado por omisión · autorización de dueño en cada recurso (404 si es ajeno) · restricciones y triggers en BD · CSRF + Origin · CORS cerrado · límite de peticiones en Redis · cabeceras de seguridad (helmet en API, políticas en SSR) · cookies sin Domain · tokens solo como hash · archivos privados y servidos solo como derivados, con autorización en cada lectura · sin HTML arbitrario (las notas son texto plano y React escapa al renderizar) · validación de entorno con Zod al arrancar (en producción exige `COOKIE_SECURE`, clave propia y sin contenido de demostración).
