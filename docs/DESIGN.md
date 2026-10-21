# Diseño

Identidad editorial, cercana y tranquila, centrada en el recorrido. Las capturas aprobadas definen estilo y composición, **no datos**; los tokens son propuestos para reproducir su apariencia (no extraídos de un archivo Figma).

## Tokens (`packages/ui/src/tokens.css`)

Fondo crema `#F8F5EE`, superficie `#FFFCF6`, verde bosque `#194B35` (primario), salvia `#DCE6CF`, texto `#18372A`, secundario `#596359`, borde de controles `#7B877C`, acento `#A24F36`; éxito `#246443`, aviso `#855500`, peligro `#B13732`, foco `#2C6B48`. Radios 12 px (controles) y 18 px (tarjetas). Tailwind 4 los expone mediante `@theme inline`.

- Títulos: **Lora** (serif); cuerpo y controles: **Inter**. Ambas **locales** (`@fontsource-variable`, `font-display: swap`) con alternativas explícitas.
- Cuerpo 16 px, auxiliares 14 px. Espaciado base 4/8 px; contenedores 16/24/32 px (móvil/tablet/desktop), ancho máximo 1440 px.
- Objetivos táctiles ≥ 44 px; iconos lineales (lucide); sombras discretas, sin gradientes decorativos.
- Sin sidebar ni KPIs: es una herramienta de recorridos, no un panel corporativo.

## Navegación y layouts

- Escritorio: **Explorar · Mis viajes · Perfil** en la cabecera. Móvil: barra inferior equivalente con *safe area*.
- Editor ≥ 1200 px: preferencias 280 px · recorrido `minmax(0,1fr)` · mapa/resumen 320 px (gap 24). Por debajo se apila y el mapa es plegable.
- Recorrido en vivo e historia pública: 60–65 % recorrido / 35–40 % mapa; en móvil, pestañas «Recorrido / Mapa».
- Las mismas acciones existen en todos los tamaños.

## `JourneyTrail` (componente distintivo)

Lista semántica `<ol>` con línea curva SVG decorativa (`aria-hidden`, no captura clics) calculada con las **posiciones reales** de los nodos mediante `ResizeObserver` (sin alturas fijas: notas y fotos cambian el alto). Nodos numerados; **pendiente** = punteado + etiqueta «Pendiente»; **actual** = anillo verde + «Aquí ahora»; **visitado** = tramo sólido + check + «Visitado» (nunca solo por color). Las fotos van al lado y se alternan solo en la historia pública. Representa **secuencia**, no geografía: el mapa representa el territorio.

Reordenar: arrastre (mouse/touch/teclado con dnd-kit) **y** botones Subir/Bajar siempre disponibles, con anuncios por región viva.

## Accesibilidad

Contraste AA en texto y controles (el borde de los campos usa `#7B877C`, no el borde decorativo tenue) · foco visible de 3 px · «Saltar al contenido» · diálogos sobre `<dialog>` nativo (foco atrapado, Esc) · pestañas con roles ARIA y flechas · errores enlazados con `aria-describedby` y `role="alert"` · estados de carga/vacío/error/éxito/sin conexión · `prefers-reduced-motion` respetado · movimiento de 150–220 ms, sin animación permanente.
