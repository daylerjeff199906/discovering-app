import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  // En modo watch no se borra dist: evita reinicios espurios de la API mientras se reconstruye.
  clean: !options.watch,
  sourcemap: true,
  target: "es2022",
  external: ["pg", "drizzle-orm", "argon2"],
}));
