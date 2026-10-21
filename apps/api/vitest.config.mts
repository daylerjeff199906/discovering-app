import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.spec.ts", "src/**/*.spec.ts"],
    testTimeout: 30000,
    hookTimeout: 60000,
    fileParallelism: false,
    setupFiles: ["test/setup-env.ts"],
    globalSetup: ["test/global-setup.ts"],
  },
  plugins: [
    swc.vite({
      module: { type: "es6" },
      jsc: { target: "es2022", parser: { syntax: "typescript", decorators: true }, transform: { legacyDecorator: true, decoratorMetadata: true } },
    }),
  ],
});
