import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "docs/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Sandboxed Electron preloads are CommonJS by design: `require("electron")` is the API.
    files: ["**/*.cts"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
