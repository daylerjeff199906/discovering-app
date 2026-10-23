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

  Códigos estables: `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `VERSION_CONFLICT` (409, con `details.currentVersion`), `EMAIL_NOT_VERIFIED`, `INVALID_CREDENTIALS`, `RATE_LIMITED` (429 + `Retry-After`), `CSRF_INVALID`, `TOKEN_INVALID`/`TOKEN_EXPIRED`, `RECORDING_CLOSED`, `PENDING_TRACK_DATA`, `MEDIA_IN_PUBLICATION`, `MEDIA_LIMIT`, `UNSUPPORTED_MEDIA`, `NOT_AVAILABLE`.
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

`register` 10/h por IP · `login` 20/5 min por IP y por correo · `forgot-password` 10/h · `resend-verification` 10/h + cooldown 60 s por correo · `verify`/`reset` 20/10 min y 10/h · `uploads` 120/10 min · `reports` 10/h · `shared/:token` 120/min. Falla abierto (y registra) si Redis no responde.

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

