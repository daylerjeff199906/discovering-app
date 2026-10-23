# Base de datos

PostgreSQL 17 + PostGIS 3.5. Esquema en `packages/database/src/schema.ts` (Drizzle); migraciones SQL en `packages/database/migrations/`:

| Migración | Contenido |
|---|---|
| `0000_init.sql` | Generada por drizzle-kit: 26 tablas, FKs (incluidas **compuestas**), checks, índices parciales y GiST. Empieza con `CREATE EXTENSION postgis, unaccent`. |
| `0001_postgis_constraints.sql` | A mano: índices `geography`, restricciones **DEFERRABLE**, `ON DELETE SET NULL (stop_id)`, triggers de `updated_at`, propiedad/acceso y versiones inmutables. |

`pnpm db:migrate` es el **paso único de release** (no se ejecuta al arrancar cada réplica). `pnpm db:generate` crea una migración nueva desde el esquema; las reglas que Drizzle no expresa van en una migración `--custom`.

## Convenciones

- PK `uuid` (`gen_random_uuid()`); `created_at`/`updated_at` `timestamptz` (trigger `set_updated_at`).
- `timestamptz` para instantes, `date` para días planificados, y la zona IANA guardada aparte (`journey_days.timezone`, `visits.timezone`).
- Coordenadas **WGS84, `geometry(Point,4326)`**, siempre *longitud, latitud*. Las consultas por radio usan `ST_DWithin(location::geography, punto::geography, metros)` con el índice funcional `places_location_geography_gist` (metros, no grados).
- Desconocido = `NULL` (nunca `0` inventado). Duraciones en segundos, distancias en metros.
- Control optimista: `journeys.version` (todas las ediciones del plan) y `recordings.version`/`visits.version`; la API recibe `expectedVersion` y responde **409** si cambió.

## Tablas

| Grupo | Tablas |
|---|---|
| Identidad | `users`, `profiles`, `sessions` (solo `token_hash`), `auth_tokens` (hash, propósito, caducidad, consumo atómico) |
| Catálogo | `places` (CATALOG/PERSONAL), `interests`, `place_interests` |
| Planificación | `journeys`, `journey_days`, `journey_stops`, `journey_legs` |
| Ejecución | `recordings` (una por viaje), `visits`, `track_segments`, `track_points` |
| Medios | `media_assets`, `visit_media` |
| Publicación | `publications`, `publication_versions`, `publication_entries`, `publication_media`, `share_links`, `bookmarks`, `reports`, `moderation_actions` |
| Asíncrono | `outbox_events` |

## Integridad que la BD hace cumplir (no solo la API)

| Regla | Mecanismo |
|---|---|
| Una parada pertenece a un día **del mismo viaje** | FK compuesta `(day_id, journey_id) → journey_days(id, journey_id)` |
| Una visita solo referencia una parada del mismo viaje | FK compuesta `(stop_id, journey_id) → journey_stops` |
| Quitar una parada conserva sus visitas | `ON DELETE SET NULL (stop_id)` (solo la columna, PG ≥ 15) |
| Posiciones únicas por día, reordenables en una transacción | `UNIQUE (day_id, position) DEFERRABLE INITIALLY DEFERRED` |
| Una publicación solo activa **su** versión | FK compuesta `(active_version_id, id) → publication_versions(id, publication_id)` |
| Versiones publicadas inmutables | trigger `forbid_version_update` |
| La visita pertenece al dueño del viaje y usa un lugar accesible | trigger `check_visit_ownership` |
| Una parada solo usa lugares del catálogo o propios | trigger `check_stop_place_access` |
| Solo el dueño asocia archivos a sus visitas | FKs compuestas `(visit_id, owner_id)` y `(asset_id, owner_id)` |
| El avatar es un archivo propio con propósito AVATAR | trigger `check_avatar_owner` |
| Un lugar PERSONAL exige dueño; CATALOG no lo tiene | `places_owner_chk` |
| Estado de la ejecución coherente | `recordings_ended_chk`: COMPLETED ⇔ `ended_at` presente |
| Visita idempotente | `UNIQUE (recording_id, client_mutation_id)` |
| Puntos GPS idempotentes | `UNIQUE (segment_id, client_sequence)` |
| Reporte abierto único por persona y publicación | índice único parcial |

## Estado visible del viaje

No es una columna: se **deriva** de `plan_status` + `recordings.status` + `archived_at` (`journey.mapper.ts › deriveStatus`).

| Condición | Estado |
|---|---|
| `archived_at` | Archivado |
| recording COMPLETED | Finalizado |
| recording PAUSED | Pausado |
| recording ACTIVE | En curso |
| sin recording, plan READY | Planeado |
| sin recording, plan DRAFT | Borrador |

## Publicación

`publication_versions` es una **instantánea sanitizada** (título, autor visible, entradas elegidas, fotos elegidas, precisión de ubicación, trayecto simplificado opcional). Solo se conserva la versión activa: al actualizar se crea la nueva, se activa y se eliminan las anteriores, de modo que las fotos eliminadas no quedan referenciadas. Las referencias `publication_media → media_assets` son `NO ACTION`: **no se puede borrar una foto publicada** (la API devuelve 409 `MEDIA_IN_PUBLICATION`; hay que actualizar o retirar la publicación).

## Reloj

Los valores por defecto `now()` usan el reloj de PostgreSQL. En Docker Desktop el reloj del contenedor puede desviarse unos minutos del host; el código compara contra `now()` de la base de datos donde importa (outbox) y usa instantes del proceso para sesiones y tokens, de modo que no se mezclan fuentes dentro de una misma comparación.

## Backups y restauración

```bash
# Respaldo lógico (cada noche en producción; conserva ≥ 14 días y prueba la restauración)
docker compose -f infra/compose.yaml exec -T postgres pg_dump -U poraqui -Fc poraqui > backup-$(date +%F).dump
# Restauración en una base vacía con PostGIS
docker compose -f infra/compose.yaml exec -T postgres pg_restore -U poraqui -d poraqui --clean --if-exists < backup-YYYY-MM-DD.dump
```

Los archivos (bucket S3) se respaldan aparte (versionado del bucket o `mc mirror`). Las copias de la base de datos contienen datos personales: cífralas y limita el acceso. **Nota:** este procedimiento está documentado, no ejecutado automáticamente en la beta.

## Datos opcionales de una visita (migración `0003_visit_expense_transport_tip`)

| Columna | Tipo | Notas |
|---|---|---|
| `visits.expense_minor` / `visits.expense_currency` | `integer` / `text` | Gasto en unidad menor + moneda ISO 4217. Van juntos (`visits_expense_chk`). **Siempre privado.** |
| `visits.transport_mode` | `text` | Mismo catálogo que los modos de transporte (`visits_transport_chk`). **Siempre privado.** |
| `visits.recommendation` | `text` (≤1000) | Consejo del autor. |
| `publication_entries.recommendation` | `text` | Copia congelada en la publicación; solo se llena si el autor marca «Incluir mi recomendación» (`includeRecommendation`). |

