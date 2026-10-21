import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";

/** Configuración base (flat config). `react: true` añade reglas de hooks. */
export function createConfig({ react = false } = {}) {
  return tseslint.config(
    { ignores: ["dist/**", "build/**", ".react-router/**", "node_modules/**", "migrations/**", "coverage/**"] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
      languageOptions: { globals: { ...globals.node, ...(react ? globals.browser : {}) } },
      rules: {
        "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        "@typescript-eslint/no-explicit-any": "warn",
      },
    },
    react
      ? { plugins: { "react-hooks": reactHooks }, rules: { "react-hooks/rules-of-hooks": "error", "react-hooks/exhaustive-deps": "warn" } }
      : {},
  );
}
