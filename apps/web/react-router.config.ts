import type { Config } from "@react-router/dev/config";

// SSR activado: las páginas públicas (/explorar, /r/:slug, /u/:username, /s/:token) se renderizan en servidor.
// Las rutas privadas (/app/*) renderizan solo un shell: los datos se piden en el cliente con la cookie de sesión.
export default { ssr: true } satisfies Config;
