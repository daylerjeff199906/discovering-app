# Catálogo y contenidos del portal

La administración está en `/app/catalogo`, accesible desde el popover de una cuenta con rol `MODERATOR`. Los usuarios normales no pueden escribir estos datos; la API también comprueba el rol.

## Qué se puede editar

- Título, descripción y acciones del banner del inicio privado.
- Títulos, descripciones e ilustraciones de las tres formas de crear viajes.
- Ciudades: nombre, región, país/código, descripción, imagen de fondo, características, coordenadas y disponibilidad.
- Lugares: ciudad, nombre, descripción, categoría, imagen, coordenadas, intereses para propuestas y disponibilidad.

Las imágenes aceptan rutas locales `/images/...` o URLs HTTPS. La selección de ciudades parte de los registros activos; inicialmente solo está Iquitos. Para añadir una ciudad, completa sus campos, actívala y guarda los cambios. Los lugares nuevos se sincronizan con el catálogo geográfico usado por la búsqueda y las propuestas. No se eliminan recuerdos existentes al desactivar un lugar.

El guardado usa revisión optimista: si otro moderador cambió el catálogo, hay que recargar antes de volver a guardar.

## Datos y endpoints

Migración `0002_sudden_medusa.sql`: `catalog_content` guarda la configuración; `saved_places` guarda favoritos por usuario. El catálogo inicial se crea una sola vez a partir de los lugares de Iquitos existentes en la base.

- `GET /api/v1/catalog`: contenido activo.
- `GET /api/v1/catalog/admin`, `PUT /api/v1/catalog/admin`: administración protegida.
- `GET /api/v1/catalog/saved-places`, `PUT/DELETE /api/v1/catalog/saved-places/:id`: favoritos del usuario autenticado.

Los favoritos se usan tanto en Guardados como al añadir paradas. El botón de ubicación del banner calcula la ciudad disponible más cercana; no activa seguimiento GPS.

## Lugares reales de Iquitos (semilla con fuentes)

Además de los 8 lugares de demostración de `pnpm db:seed`, el catálogo puede poblarse con 15 lugares reales de Iquitos y alrededores (Plaza de Armas, Casa de Fierro, Catedral, Malecón Tarapacá, Boulevard, Museo Amazónico, Ex Hotel Palace, Casa Pinasco, Mercado de Belén, Quistococha, Centro de Rescate Amazónico, Pilpintuwasi, Lago Moronacocha, Santa Clara/río Nanay y Reserva Pacaya-Samiria).

**Fuente de verdad:** `packages/database/data/iquitos-places.json`. Cada lugar trae nombre, categoría, descripción en español (redactada para Por aquí, no copiada), localidad, coordenadas, intereses, duración típica, fuentes consultadas y la foto elegida de Wikimedia Commons. Las coordenadas se contrastaron entre Wikipedia/Wikidata, OpenStreetMap y los geoetiquetados de Commons; son aproximadas (centro del lugar) y no se incluyen horarios porque no se encontraron fuentes estables. La semilla de demostración tenía coordenadas distintas (y erróneas en varios casos); los lugares reales las sustituyen.

**Comandos** (en la raíz del repo, con `DATABASE_URL` en `.env`; `db:seed:iquitos` está deshabilitado en producción y `db:images:iquitos` no toca la base):

```bash
pnpm db:images:iquitos            # descarga y convierte las fotos; rellena autor/licencia en el JSON
pnpm db:seed:iquitos --dry-run    # muestra qué crearía/actualizaría, sin escribir
pnpm db:seed:iquitos              # aplica la semilla (idempotente)
```

- `db:images:iquitos` consulta la API de Wikimedia Commons, **rechaza** cualquier licencia que no sea CC BY, CC BY-SA, CC0 o dominio público (o con restricciones declaradas), convierte a WebP (máx. 1280 px) y guarda `apps/web/public/images/lugares/<clave>.webp` más una tabla de créditos en el `README.md` de esa carpeta. Opciones: `--dry-run`, `--force` (regenera), `--only=iq-belen,iq-malecon`. No usa R2: el catálogo solo acepta rutas `/images/...` o URLs HTTPS, así que las fotos se sirven como estáticos del web.
- `db:seed:iquitos` hace upsert de `places` por (`provider` = `iquitos-catalog`, clave del JSON) y reemplaza sus intereses; actualiza `catalog_content` («travel») con imagen, categoría y atribución (`imageCredit`), conservando `enabled` si el lugar ya estaba y subiendo la revisión solo si algo cambia. Requiere que el catálogo `travel` exista (abre `/api/v1/catalog` una vez con la API en marcha) y que se haya ejecutado `pnpm db:seed` (intereses).
- Los 8 lugares de demostración que tienen contraparte real se **ocultan** en el catálogo (no se borran; los recuerdos y rutas que los referencian siguen intactos). Usa `--keep-demo` para no ocultarlos, o vuélvelos a activar desde `/app/catalogo`.
- Si un moderador edita desde el panel un lugar de esta semilla, la siguiente ejecución sobrescribe ese texto con el del JSON; edita el JSON para cambios duraderos. Al cambiar la URL de la imagen en el panel se borra su atribución.

**Atribución.** El contrato del lugar (`catalogPlaceSchema`) tiene el campo opcional `imageCredit` (`title`, `author`, `license`, `licenseUrl`, `sourceUrl`). La interfaz muestra el crédito con autor, licencia y enlace a la fuente donde aparece la foto: lista de paradas sugeridas, Guardados y «Nueva visita». Las imágenes son versiones recortadas y comprimidas de las originales; las licencias CC exigen indicar eso, y el texto lo hace.

**Fuentes de los textos:** Wikipedia en español (artículos de cada lugar, CC BY-SA, solo como referencia de datos), Mongabay Latam, OTCA y Atlas Obscura para el Centro de Rescate Amazónico, y OpenStreetMap para contrastar ubicaciones (© colaboradores de OpenStreetMap, ODbL). La lista exacta por lugar está en el campo `sources` del JSON.

**Verificación:** `pnpm --filter @por-aqui/database test` comprueba que el JSON tenga claves únicas, intereses válidos, imágenes presentes y licencias libres.

## Fotos e historias

Nueva visita permite preparar fotos, cámara, fecha/hora y notas en el mismo formulario. Se conserva un identificador de visita en los reintentos y un estado de subida por archivo para evitar duplicados. Sin conexión, las visitas sin fotos conservan la cola existente; las fotos requieren conexión.

El diario ofrece Historia, Mapa y Trayecto. El mapa representa las visitas; Trayecto usa exclusivamente segmentos GPS almacenados, sin unir huecos ni inventar recorridos. Compartir abre una revisión de contenidos y visibilidad antes de publicar o crear enlaces.

Al finalizar se puede cambiar el título y conservar el diario privado. Si se elige público, se abre la revisión de publicación; no se publica automáticamente.
