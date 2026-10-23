# Diseño

Identidad editorial, cercana y tranquila, centrada en el recorrido. Las capturas aprobadas definen estilo y composición, **no datos**; los tokens son propuestos para reproducir su apariencia (no extraídos de un archivo Figma).

Alcance actual: **Iquitos**. Fotografías, lugares sugeridos, ejemplos y catálogo de demostración se centran en la ciudad. Las ilustraciones usan ríos, embarcaciones y vegetación amazónica.

## Tokens (`packages/ui/src/tokens.css`)

Fondo crema `#F8F5EF`, superficie `#FFFDF8`, verde bosque `#214735` (primario), salvia `#E1E5D4`, texto `#1E3026`, secundario `#696D63`, borde de controles `#858F80`, acento `#A24F36`; éxito `#246443`, aviso `#855500`, peligro `#B13732`, foco `#2C6B48`. Radios 14 px (controles) y 22 px (tarjetas). Tailwind 4 los expone mediante `@theme inline`.

- Títulos: **Lora** (serif); cuerpo y controles: **Inter**. Ambas **locales** (`@fontsource-variable`, `font-display: swap`) con alternativas explícitas.
- Cuerpo 16 px, auxiliares 14 px. Espaciado base 4/8 px; contenedores 16/24/32 px (móvil/tablet/desktop), ancho máximo 1440 px.
- Objetivos táctiles ≥ 44 px; iconos lineales (lucide); sombras discretas, sin gradientes decorativos.
- Sin sidebar ni KPIs: es una herramienta de recorridos, no un panel corporativo.

## Composición editorial

- Portada: título serif de gran formato, fotografía de Iquitos con recorte de arco, búsqueda y dos entradas claras: planear un viaje o registrar una aventura. Lugares de Iquitos con fotografía editorial y un bloque que explica descubrir, explorar y guardar recuerdos.
- Cuenta: fotografía y relato de marca a la izquierda en escritorio; formulario con etiquetas persistentes a la derecha. En móvil, una cabecera fotográfica compacta precede el formulario. Ingreso, registro, recuperación y confirmación usan el mismo marco.
- Onboarding: tres pasos opcionales (intereses, idioma/zona horaria y foto). Conserva las elecciones al volver atrás, mueve el foco al título al avanzar y guarda las preferencias al completar. La foto mantiene la subida y el procesamiento existentes.
- Mis viajes: pestañas de estado subrayadas, tarjetas con ilustración cuando no hay fotografía propia y un estado vacío editorial. Las fotografías de inspiración nunca se presentan como fotos de las visitas del usuario.
- Los recursos fotográficos se sirven desde `apps/web/public/images/`; las fuentes se documentan en su `README.md`. Los ríos y la vegetación amazónica se dibujan en SVG y los estados de recorrido conservan sus etiquetas accesibles.

## Navegación y layouts

Actualización 22/10: el inicio privado usa fotografía de fondo y buscador de ciudad con hoja de selección. Su contenido viene del catálogo persistente administrable. Registrar visita concentra fecha/hora, miniaturas, cámara/subida y nota en una columna. El diario privado ofrece pestañas Historia, Mapa y Trayecto; el modo diario del caminito mantiene números en las visitas completadas y coloca las fotos antes de las notas. Ver `CATALOG.md`.

- Portal público: **Inicio · Ideas en Iquitos**, ingreso/registro o acceso a Mis viajes para quien ya tiene sesión.
- Área privada: **Inicio · Guardados · Nuevo viaje**, también en la barra móvil. Inicio abre `/app/inicio`, una portada personal con saludo, accesos de creación y viajes recientes reales. El logo privado y el acceso sin destino pendiente llevan a esta portada. Mis viajes, perfil, configuración y cierre de sesión están en el popover del avatar. El disparador muestra el primer nombre y el correo debajo. Mis viajes incluye un banner para visitar las ideas del portal.
- Nuevo viaje usa el mismo ancho centrado de 830 px, radio visible, borde verde y tarjetas ilustradas de Comenzar aventura. Automático y manual se presentan en dos columnas; el registro libre ocupa una tarjeta inferior. En móvil se apilan todas. Los detalles y la acción principal siguen debajo, sin columna lateral.
- Comenzar aventura: dos tarjetas ilustradas de Iquitos, **Seguir mi ruta / Explorar libremente**, con radio nativo y GPS opcional apagado inicialmente. La elección se conserva en las preferencias del viaje; el modo libre muestra las visitas registradas y mantiene el plan guardado. Recursos y prompts: `ILLUSTRATIONS.md`.
- Eliminar viaje: acción explícita y confirmación modal que explica la eliminación de recuerdos y publicación. API protegida por propietario; transacción con limpieza de archivos por outbox y borrado en cascada del recorrido.
- Editor ≥ 1200 px: preferencias 280 px · recorrido `minmax(0,1fr)` · mapa/resumen 320 px (gap 24). Por debajo se apila y el mapa es plegable.
- Recorrido en vivo e historia pública: 60–65 % recorrido / 35–40 % mapa; en móvil, pestañas «Recorrido / Mapa».
- Las mismas acciones existen en todos los tamaños.

## `JourneyTrail` (componente distintivo)

Lista semántica `<ol>` con línea curva SVG decorativa (`aria-hidden`, no captura clics) calculada con las **posiciones reales** de los nodos mediante `ResizeObserver` (sin alturas fijas: notas y fotos cambian el alto). Nodos numerados; **pendiente** = punteado + etiqueta «Pendiente»; **actual** = anillo verde + «Aquí ahora»; **visitado** = tramo sólido + check + «Visitado» (nunca solo por color). Las fotos van al lado y se alternan solo en la historia pública. Representa **secuencia**, no geografía: el mapa representa el territorio.

Reordenar: arrastre (mouse/touch/teclado con dnd-kit) **y** botones Subir/Bajar siempre disponibles, con anuncios por región viva.

## Accesibilidad

Contraste AA en texto y controles (el borde de los campos usa `#7B877C`, no el borde decorativo tenue) · foco visible de 3 px · «Saltar al contenido» · diálogos sobre `<dialog>` nativo (foco atrapado, Esc) · pestañas con roles ARIA y flechas · errores enlazados con `aria-describedby` y `role="alert"` · estados de carga/vacío/error/éxito/sin conexión · `prefers-reduced-motion` respetado · movimiento de 150–220 ms, sin animación permanente.
