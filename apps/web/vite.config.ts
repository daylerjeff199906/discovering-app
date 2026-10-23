import path from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

const root = path.resolve(import.meta.dirname, "../..");

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, root, "");
  return {
    // Las variables VITE_* se leen del .env de la raíz y son PÚBLICAS (viajan al navegador).
    envDir: root,
    plugins: [tailwindcss(), reactRouter()],
    server: {
      port: Number(env.WEB_PORT || 5173),
      strictPort: true,
      // Origen único en desarrollo: /api/* → Nest; el resto lo sirve el SSR de React Router.
      proxy: { "/api": { target: `http://localhost:${env.API_PORT || 4000}` } },
    },
    ssr: { noExternal: ["@por-aqui/ui", "@por-aqui/api-client", "@por-aqui/contracts"] },
    resolve: {
      alias: { "@por-aqui/contracts": path.join(root, "packages/contracts/src/index.ts") },
      dedupe: ["react", "react-dom"],
    },
  };
});
