# API REST `/api/v1`

Documentación interactiva: `http://localhost:4000/api/docs` (OpenAPI generado a partir de los esquemas Zod de `@por-aqui/contracts`; JSON en `/api/v1/openapi.json`).

## Convenciones

- **Autenticación**: cookie de sesión opaca `pa_session` (HttpOnly, SameSite=Lax, Path=/, host-only; `Secure` en producción). **Denegado por omisión**: todo endpoint exige sesión salvo los marcados `@Public()`.
- **CSRF** en toda mutación (POST/PUT/PATCH/DELETE): cabecera `X-CSRF-Token` igual a la cookie `pa_csrf` (doble envío; obtén el token con `GET /auth/csrf`) **y** `Origin` dentro de `ALLOWED_ORIGINS`.
- **Validación**: cada entrada se vuelve a validar en el servidor con los mismos esquemas Zod que usa el cliente (`@Api({ body, query })`).
- **Errores** (siempre este formato; nunca stacktrace):

```json
{ "code": "VALIDATION_ERROR", "message": "Revisa los campos marcados.", "fieldErrors": { "email": ["Correo inválido"] }, "requestId": "…" }
```

  Códigos estables: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VERSION_CONFLICT` (409, con `details.currentVersion`), `EMAIL_NOT_VERIFIED`, `INVALID_CREDENTIALS`, `RATE_LIMITED` (429 + `Retry-After`), `CSRF_INVALID`, `TOKEN_INVALID`/`TOKEN_EXPIRED`, `RECORDING_CLOSED`, `PENDING_TRACK_DATA`, `IMPORT_*` (ver «Importar recorridos»), `MEDIA_IN_PUBLICATION`, `MEDIA_LIMIT`, `UNSUPPORTED_MEDIA`, `NOT_AVAILABLE`.
- **Recursos ajenos**: 404 (no se revela su existencia). Un UUID nunca sustituye la autorización.
- **Paginación** por cursor opaco (`cursor`, `limit` ≤ 50) con orden estable `(first_published_at desc, id desc)`.
- Todas las respuestas llevan `Cache-Control: private, no-store` y `X-Request-Id`, salvo el contenido de medios.

## Grupos

| Grupo | Endpoints |
|---|---|
| Meta | `GET /meta/capabilities`, `GET /meta/interests`, `GET /health/live`, `GET /health/ready` |
| Auth | `GET /auth/csrf`, `POST /auth/register · login · logout · verify-email · resend-verification · forgot-password · reset-password`, `GET /auth/me`, `GET·DELETE /auth/sessions`, `DELETE /auth/sessions/:id` |
| Cuenta | `GET·PATCH /me/profile`, `PUT /me/password`, `DELETE /me/account`, `POST /me/avatar/uploads` |
| Lugares | `GET /places/search · destinations · geocode · :id`, `POST /places` (lugar personal, privado) |
| Viajes | `GET·POST /journeys`, `GET·PATCH /journeys/:id`, `POST …/duplicate · archive · unarchive`, `POST·PATCH·DELETE …/days`, `POST·PATCH·DELETE …/stops`, `POST …/reorder`, `PUT …/legs`, `POST …/legs/recalculate` |
| Planificación | `POST /journeys/:id/proposals` (no modifica), `POST …/proposals/apply` |
| Ejecución | `GET /journeys/:id/recording`, `POST …/recording/start · pause · resume · finish` |
| Visitas | `GET /journeys/:id/visits`, `GET·POST /recordings/:id/visits`, `GET·PATCH·DELETE /visits/:id` |
| Trayecto | `POST /recordings/:id/track-batches`, `GET /recordings/:id/track` |
| Importación | `POST /journeys/import/preview`, `POST /journeys/import` (multipart; ver «Importar recorridos») |
| Medios | `POST /visits/:id/media/uploads`, `POST /media/:id/complete · retry`, `GET·PATCH·DELETE /media/:id`, `GET /media/:id/content` |
| Publicación | `GET·PUT·DELETE /journeys/:id/publication`, `PUT /publications/:id/visibility`, `GET·POST·DELETE /publications/:id/share-links`, `POST /publications/:id/copy` |
| Público | `GET /public/explore · routes/:slug · profiles/:username`, `GET /shared/:token` |
| Comunidad | `GET·POST /bookmarks`, `GET·DELETE /bookmarks/:publicationId`, `POST /reports` |
| Moderación | `GET /moderation/reports`, `GET /moderation/publications/:id/preview`, `POST …/actions` (solo `MODERATOR`) |

## Idempotencia y conflictos

| Operación | Garantía |
|---|---|
| `recording/start` | Idempotente (devuelve la ejecución existente; 409 si ya finalizó) |
| `recording/pause`, `resume`, `finish` | Idempotentes por estado; `finish` concilia *watermarks* de GPS (409 `PENDING_TRACK_DATA` o `discardPending`) |
| `POST /recordings/:id/visits` | Idempotente por `clientMutationId` (201 nueva, 200 repetida) |
| `POST /recordings/:id/track-batches` | Idempotente por `(segmento, secuencia)`; tras finalizar solo acepta reintentos ≤ watermark |
| `POST /media/:id/complete` | Idempotente |
| `POST /publications/:id/copy` | Idempotente por `clientMutationId` |
| Ediciones del plan | `expectedVersion` → 409 `VERSION_CONFLICT` si otro cliente editó |
| Publicar | `expectedRevision` → 409 si la publicación cambió |

## Límites de peticiones (Redis, ventana fija)

`register` 10/h por IP · `login` 20/5 min por IP y por correo · `forgot-password` 10/h · `resend-verification` 10/h + cooldown 60 s por correo · `verify`/`reset` 20/10 min y 10/h · `uploads` 120/10 min · `import` 60/10 min · `reports` 10/h · `shared/:token` 120/min. Falla abierto (y registra) si Redis no responde.

## Medios

1. `POST /visits/:id/media/uploads` → autoriza la visita, comprueba cuota y límites y devuelve un **POST prefirmado** (TTL 5 min, `content-length-range` impuesto por el almacenamiento).
2. El navegador sube directo al almacenamiento.
3. `POST /media/:id/complete` → comprueba que el objeto existe y su tamaño y encola el procesado (outbox).
4. El worker lee los bytes reales (no confía en el MIME del cliente), limita píxeles, aplica la orientación, **elimina EXIF/GPS**, genera miniatura y lectura WebP con clave versionada y deja la foto `READY`.
5. `GET /media/:id/content?variant=thumb|display` autoriza **en cada petición**: dueño · avatar de perfil · publicación PUBLIC+VISIBLE · ticket HMAC de vida corta (historias por enlace; TTL 15 min) · moderador con reporte abierto/oculta. **El original nunca se sirve.**

## Seguridad de lectura pública

La API pública devuelve DTO explícitos (`PublicRouteDto`, `PublicRouteCard`, `PublicProfileDto`) leídos **solo** de las tablas de publicación (`publication_*`): jamás serializa un `Journey` ni sus relaciones privadas. Las historias por enlace no repiten el token en el DTO y sus fotos usan tickets de vida corta; la capa web las sirve con `noindex`, `no-store` y `Referrer-Policy: no-referrer`.

### Campos opcionales de visita
`POST /recordings/:id/visits` y `PATCH /visits/:id` aceptan `expenseMinor` + `expenseCurrency` (ambos o ninguno), `transportMode` y `recommendation`. `PUT /journeys/:id/publication` acepta por entrada `includeRecommendation` (por defecto `false`). El DTO público **nunca** incluye gasto ni transporte.

## Importar recorridos (GPX, KML, Google Takeout)

Google **no ofrece una API** para leer el Timeline ni las listas de Maps, así que "sincronizar" es **importar archivos** que la persona descarga. Dos endpoints, ambos `multipart/form-data` con el archivo en el campo `file` y requieren sesión + CSRF:

| Endpoint | Efecto |
|---|---|
| `POST /journeys/import/preview` → 200 `ImportPreview` | Lee y filtra el archivo **sin guardar nada**: formato, puntos tras el filtrado, descartados, tramos, distancia, fechas, lugares (primeros 20), `bounds` y `warnings`. |
| `POST /journeys/import` → 201 `ImportResult` | Crea un viaje libre (`FREE`) con ejecución `COMPLETED`, segmentos y puntos GPS (`track_segments`/`track_points`) y una visita por lugar, ligada a un lugar personal. Todo en una transacción: si algo falla no queda nada. |

Campos de texto opcionales (mismos esquemas en `importOptionsSchema`): `title`, `timezone` (IANA; por defecto la del perfil), `importWaypoints` (`true`/`false`, por defecto `true`), `from` / `to` (instantes ISO que limitan lo importado; útil con Takeout) y `startAt` (inicio para archivos **sin fechas**).

**Formatos** (se detectan por el contenido, no por la extensión ni el MIME):

| Formato | Qué se importa |
|---|---|
| GPX | `<trk>/<trkseg>/<trkpt>` (un segmento por `trkseg`), `<rte>/<rtept>` (sin fechas) y `<wpt>` (lugares) |
| KML | `LineString` y `gx:Track` (con `<when>`) como segmentos, `Point` como lugares; los polígonos se omiten con aviso |
| Takeout · Timeline (JSON) | `timelineObjects` (Semantic Location History: `placeVisit`, `activitySegment`), `Records.json` (`locations`, se parte en segmentos con pausas > 30 min) y el Timeline del dispositivo (`semanticSegments` o arreglo con `visit`/`activity`/`timelinePath`) |
| Takeout · Lugares guardados | GeoJSON (`Saved Places.json`) y CSV (`Title,Note,URL,…`). Las coordenadas salen de la geometría, de `Geo Coordinates` o del enlace de Maps; los lugares sin ubicación se omiten con aviso |

**Reglas**

- **Filtrado igual que la grabación**: se descartan puntos con precisión > `TRACK_MAX_ACCURACY_M`, con fecha futura (> 5 min) y los que distan menos de `TRACK_MIN_DISTANCE_M` del punto anterior del mismo segmento.
- **Sin fechas** (p. ej. `LineString` de KML): se generan a razón de 1 s por punto desde `startAt` o, si falta, terminando en el momento de la importación; la vista previa avisa (`hasTimestamps: false`). Un segmento solo se considera con fechas si todos sus puntos las traen.
- **Lugares**: cada waypoint se liga a un lugar personal del usuario con el mismo nombre (sin distinguir mayúsculas ni tildes) a menos de 75 m; si no existe se crea uno nuevo, privado. Los waypoints sin fecha se ordenan al inicio del recorrido respetando el orden del archivo. Las visitas llevan `clientMutationId = import-N`.
- **Seguridad**: archivo en memoria (nunca a disco) con tope `IMPORT_MAX_BYTES`; el XML se lee con un lector propio que **rechaza `<!DOCTYPE>` y `<!ENTITY>`** (sin XXE ni expansión de entidades), limita profundidad (64) y nodos (1 M) y no carga recursos externos. Los ZIP y binarios se rechazan con un mensaje que pide descomprimir.
- Límites configurables (`/meta/capabilities → import`): `IMPORT_MAX_BYTES` (10 MB), `IMPORT_MAX_POINTS` (50 000 puntos tras filtrar) e `IMPORT_MAX_WAYPOINTS` (1 000).

**Errores** (`code`): `IMPORT_NO_FILE` (400), `IMPORT_TOO_LARGE` (413), `IMPORT_UNSUPPORTED_FORMAT`, `IMPORT_INVALID_FILE`, `IMPORT_EMPTY`, `IMPORT_TOO_MANY_POINTS`, `IMPORT_TOO_MANY_WAYPOINTS` (422) y `VALIDATION_ERROR` (400) para opciones inválidas. La web: **Nuevo viaje → Importar un recorrido** (`/app/viajes/importar`).
