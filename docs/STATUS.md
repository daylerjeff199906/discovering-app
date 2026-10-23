# Estado de la beta (21 de octubre de 2026)

Este documento distingue **lo que se ejecutó y probó** de lo que está implementado pero **no se pudo validar**, y de lo que queda **fuera de la beta**. No presenta la especificación como algo desplegado.

## Actualización del 22 de octubre de 2026

- Catálogo administrable en `/app/catalogo`, protegido por rol también en la API: ciudades, lugares, imágenes/URLs, textos del banner y tarjetas de creación. La migración `0002_sudden_medusa.sql` añade el contenido persistente y los lugares guardados.
- Inicio privado con fotografía de fondo, selector de ciudad y ubicación opcional; inicialmente Iquitos y ocho lugares. El selector usa solo ciudades activas del catálogo.
- Registro de visita con fotos preparadas antes de guardar, cámara, miniaturas, fecha/hora y notas. Conserva los identificadores de visita/subida en reintentos. Las visitas sin fotos mantienen el soporte sin conexión existente.
- Añadir parada presenta miniaturas, Cercanos/Guardados y creación personal en el mapa. Las acciones de tarjetas usan iconos con nombres accesibles.
- Diario con Historia/Mapa/Trayecto, fotos en la secuencia, edición de recuerdos y hoja para compartir. El trayecto muestra exclusivamente segmentos GPS almacenados. Finalizar permite cambiar el título y elegir privado o pasar a revisión de publicación.
- Revisiones actuales: migración aplicada, compilación de paquetes, comprobaciones estáticas y presentación en navegador móvil. No se han vuelto a ejecutar las suites funcionales históricas enumeradas debajo. Las capturas de esta actualización usan una cuenta de presentación temporal.

Guía de administración y límites: [CATALOG.md](CATALOG.md).

Actualización de alcance: la presentación y el catálogo demo se centran en Iquitos (8 lugares). Se retiraron las fotografías y capturas antiguas de otros destinos. Las nuevas capturas `inicio-iquitos.png` e `ingreso-iquitos.png` corresponden a la revisión visual de esta actualización; no implican una nueva ejecución de toda la suite E2E.

## 1. Ejecutado y probado

### Actualización de navegación, eliminación e ilustraciones

Portada privada añadida en `/app/inicio` (también accesible desde `/app`), con saludo personal, accesos de creación y viajes recientes del usuario. Inicio aparece en la navegación privada y el popover; el logo privado vuelve a esa portada. Nuevo viaje se presenta en una columna centrada con tarjetas ilustradas y formulario compacto. Se conservan los modos automático, manual y libre. El ingreso sin una acción pendiente abre el inicio privado.

Implementados: `DELETE /journeys/:id` con control de propietario, retirada de publicación, limpieza de fotos por outbox y cascadas; confirmación en Mis viajes; navegación pública/privada separada, popover del avatar y banner al portal; selección de aventura con dos ilustraciones generadas de Iquitos y modo libre persistente. Comprobaciones estáticas de web/API y cliente tipado. Esta actualización no vuelve a ejecutar las suites funcionales enumeradas abajo.

Entorno: Windows 10, Node 24.11, Docker Desktop (PostGIS 17-3.5, Redis 7.4; archivos en Cloudflare R2 y correo con Resend, aún sin probar contra los servicios reales), Chrome estable.

| Qué | Resultado |
|---|---|
| `pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm lint` | Pasan en los 9 workspaces |
| Migraciones SQL (`0000_init`, `0001_postgis_constraints`) | Aplicadas a PostgreSQL/PostGIS **reales** (26 tablas, triggers, restricciones diferibles, FKs compuestas) |
| Seeds | Intereses, 8 lugares de demostración en Iquitos y una ruta pública de ejemplo |
| Pruebas de la API (Vitest + Supertest, PostgreSQL/PostGIS y Redis reales; R2 y Resend en memoria) | **69 pruebas en 7 archivos** |
| Pruebas del frontend (jsdom, IndexedDB simulada) | 21 (reordenamiento, GPS, cola offline, sincronización, formato/zonas) |
| Pruebas de UI (`JourneyTrail`) | 5 |
| Pruebas de contratos | 8 |
| E2E (Playwright + Chrome, stack real compilado) | **9 pruebas**: flujo completo, ruta automática, ausencia de desbordamiento (públicas y 10 pantallas privadas × 360/390/768/1024/1440 px), teclado, redirecciones privadas, auditoría axe (2) y capturas (2) |
| SSR | Verificado con `curl`: título, Open Graph, canonical y contenido en el HTML sin JavaScript; 410 para historias no disponibles; shell privado `private, no-store` |
| Capturas | `docs/screenshots/` (móvil 390 y escritorio 1440), generadas por Playwright |

### Cobertura funcional de las pruebas de la API (mapa a los criterios de aceptación)

1. **Cuenta → correo enviado → verificar → login → logout → reset**; reset revoca sesiones; no revela si un correo existe; CSRF; sesión solo como hash.
2. **Aislamiento (IDOR)**: otro usuario recibe 404 en viajes, paradas, visitas, ejecución, medios, publicación y lugares personales.
3. **Ruta manual persistente** (días, orden, preferencias) tras recargar.
4. **Reordenamiento concurrente**: dos peticiones con la misma versión → una gana (200) y la otra 409 sin pérdida de datos.
5. **Propuesta automática**: sin proveedor devuelve traslados `null`/«Por definir» y advertencias; con el proveedor de pruebas calcula por modo; modos sin proveedor quedan sin tiempos.
6. **Registro manual sin GPS** y visitas pasadas; reintento idempotente (`clientMutationId`).
7. **GPS**: pausar/reanudar → segmentos distintos; lotes duplicados no duplican puntos; finalizar concilia *watermarks* (409 o descarte explícito) y luego solo acepta reintentos reconocidos.
8. **Fotos**: bytes reales (no el MIME declarado), límites de tamaño/píxeles/por visita, EXIF/GPS eliminado de los derivados, bucket privado, el original nunca se sirve.
9. **Publicar** entrega solo lo seleccionado; cambiar visibilidad o moderar corta texto, fotos y enlaces; tokens no aparecen en feed ni en el DTO.
10. **Instantánea inmutable** frente a ediciones del diario; borrar una foto publicada devuelve 409 hasta actualizar/retirar.
11. **Copiar una ruta** no trae fotos, notas ni GPS; es atómico e idempotente.
12. SSR público (E2E + `curl`) y shell privado sin datos de usuario.
13. Teclado, alternativa Subir/Bajar y sin desbordamiento (E2E).

Además: límite de peticiones real (429 + `Retry-After`), cabeceras, CORS, OpenAPI generado y validación de entorno (producción exige `COOKIE_SECURE`, clave propia, sin demo/fixture).

### Problemas reales hallados y corregidos durante las pruebas

- Reloj del contenedor PostgreSQL desviado ~3 min respecto al host (Docker Desktop): el procesado en línea del outbox comparaba con la hora equivocada.
- `tsup --watch` y los vigilantes de archivos reiniciaban la API en cadena (eventos espurios en Windows) → `pnpm dev` usa sondeo con *debounce*; los paquetes se compilan antes con `^build`.
- MapLibre 6 pide su worker a `/assets/…` (404 solo en producción) y su CSS pisaba el contenedor (mapa de altura 0); marcadores esperaban a que cargaran los *tiles*.
- `JourneyTrail` leía puntos medidos obsoletos al cambiar el número de ítems.
- La caché del viaje quedaba obsoleta tras «Iniciar recorrido».
- Accesibilidad (axe): enlaces sin nombre, `aria-controls` huérfanos, enlaces en texto sin subrayado, contraste de una insignia, `input[file]` sin etiqueta.

## 2. Implementado pero NO validado

| Pieza | Por qué |
|---|---|
| **GPS en un dispositivo real** | La lógica de filtrado y la cola están probadas por unidad, y el servidor por API; no se ejercitó `navigator.geolocation` real (ni emulado) ni la pérdida de señal en un teléfono. |
| **Offline en el navegador** | La cola y la sincronización se prueban con IndexedDB simulada y mocks; no hay E2E que corte la red del navegador. |
| **Arrastrar y soltar con puntero/teclado (dnd-kit)** | Se probó la alternativa por botones (Subir/Bajar) y la lógica pura; el gesto de arrastre no tiene E2E. |
| **OSRM y Nominatim** | Los adaptadores existen (`providers.ts`) pero **no se ejecutaron contra ningún servidor real**. En pruebas se usa `fixture` (determinista, marcado «Estimado»). |
| **Mapas** | Los *tiles* de OpenStreetMap se cargan de internet en desarrollo; no se validó un proveedor propio. |
| **`compose.prod.yaml` y Caddy (TLS, proxy)** | Escritos, **no ejecutados**. (Las imágenes sí se construyeron y arrancaron: ver sección 4.) |
| **Navegadores** | Solo Chrome (Playwright) y el navegador integrado. No Safari/Firefox ni teléfono físico. |
| **Lector de pantalla** | Solo auditoría automática (axe, WCAG A/AA con contraste). No hubo revisión manual con NVDA/VoiceOver. |
| **Cloudflare R2 y Resend en vivo** | Integrados (subida PUT firmada, borrado por carpeta, envío con Resend) pero **no probados con claves reales**: faltan pegar las claves y crear el bucket (ver [SETUP.md](SETUP.md#cloudflare-r2-archivos)). |
| **Respaldo/restauración** | Procedimiento documentado, no automatizado ni ejecutado. |

## 3. Límites de la beta y decisiones a conocer

- **Un propietario por viaje.** Sin colaboración, pagos, reservas, comentarios, seguidores, chat ni recomendaciones sociales.
- **Sin LLM.** El generador es una heurística explicable; no promete óptimo global.
- **HEIC no se admite** (se explica cómo convertir); solo JPEG, PNG y WebP.
- **GPS web en primer plano**; no sustituye al seguimiento nativo en segundo plano.
- **Datos de demostración** (`provider = demo-seed`): coordenadas aproximadas, sin verificar, y un autor ficticio claramente marcado. Nunca se muestran como evidencia de visitas.
- **Moderación**: «Descartar reporte» queda auditado como `RESTORE` con motivo (la tabla de auditoría solo admite HIDE/RESTORE).
- **Revocación de medios**: lecturas autorizadas en cada petición; tickets de historias por enlace de 15 min y respuestas públicas cacheables hasta 5 min.
- **El límite de peticiones falla abierto** si Redis no responde (queda registrado). Los E2E registran varias cuentas: ejecútalos con `RATE_LIMIT_ENABLED=false` (el servidor solo lo permite fuera de producción) o limpia las claves `rl:*` de Redis.
- **Versiones**: NestJS 11 (no 12), TypeScript 5.9 (no 7), Cloudflare R2 en lugar de S3/MinIO. Detalle en [DEPENDENCIES.md](DEPENDENCIES.md).
- **Modos de ejecución**: `pnpm dev` (vigilantes; puede reiniciar la API unos segundos al arrancar o tras editar) y `pnpm build && pnpm preview` (compilado y estable; es el que usan los E2E).

## 4. Producción

- `infra/Dockerfile.api` e `infra/Dockerfile.web` **se construyeron y arrancaron** en esta máquina (la construcción destapó un valor inválido de `watchOptions` que ya está corregido). Prueba de humo contra la infraestructura local: la API responde `ready` ejecutándose como usuario `node` (no root) y el servidor web renderiza en servidor la historia de ejemplo consultando a la API.
- **No validado**: `infra/compose.prod.yaml` (migración como servicio único, orden de arranque), `infra/Caddyfile` (TLS automático, enrutado `/api` vs resto), cookies `Secure` tras un proxy real, y el comportamiento con `APP_ENV=production` de extremo a extremo.
- Nota: `docker run --env-file .env` no recorta los comentarios en línea del `.env.example`; con Compose o con variables explícitas funciona.
