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

## Fotos e historias

Nueva visita permite preparar fotos, cámara, fecha/hora y notas en el mismo formulario. Se conserva un identificador de visita en los reintentos y un estado de subida por archivo para evitar duplicados. Sin conexión, las visitas sin fotos conservan la cola existente; las fotos requieren conexión.

El diario ofrece Historia, Mapa y Trayecto. El mapa representa las visitas; Trayecto usa exclusivamente segmentos GPS almacenados, sin unir huecos ni inventar recorridos. Compartir abre una revisión de contenidos y visibilidad antes de publicar o crear enlaces.

Al finalizar se puede cambiar el título y conservar el diario privado. Si se elige público, se abre la revisión de publicación; no se publica automáticamente.
