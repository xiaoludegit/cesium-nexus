import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Global ignores
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      ".worktrees/**",
      "data/**",
      "**/*.js",
      "**/*.mjs",
      "**/*.cjs",
      "eslint.config.js",
    ],
  },

  // Only lint TypeScript source files
  {
    files: ["**/*.ts"],
    rules: {
      // JSDoc type imports (import type used only in JSDoc) are invisible to ESLint;
      // ignore unused import bindings while still catching unused local variables.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
      // Progressive truncation reassigns `totalTokens` at each step as checkpoints;
      // intermediate values may appear unused to static analysis but are intentional.
      "no-useless-assignment": "off",
    },
  },

  // Indexer and parser use complex ts-morph APIs where `any` is unavoidable
  {
    files: ["packages/indexer/src/**/*.ts", "packages/parser/src/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Relax rules in test files
  {
    files: ["**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
);
