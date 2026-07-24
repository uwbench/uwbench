import js from "@eslint/js";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier";
import pluginPrettier from "eslint-plugin-prettier";
import pluginUnusedImports from "eslint-plugin-unused-imports";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "**/dist/**",
      "**/build/**",
      "coverage/**",
      ".turbo/**",
      "*.config.*",
      ".changeset/**",
      "*.md",
      "LICENSE",
      ".github/**",
      "examples/**",
      "benchmark/**",
      "docs/**",
      "scripts/**",
      "*.sh",
      "*.md",
      "*.txt",
      "*.json",
      "*.yaml",
      "*.yml",
      "*.mjs",
      "*.cjs",
      ".gitignore",
      ".git/**",
      ".agent-workflow/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...tseslint.configs.stylistic,
  prettierConfig,
  {
    languageOptions: {
      parserOptions: {
        projectService: false,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      prettier: pluginPrettier,
      "unused-imports": pluginUnusedImports,
    },
    rules: {
      "prettier/prettier": "error",
      "unused-imports/no-unused-imports": "error",
      "unused-imports/no-unused-vars": [
        "error",
        {
          vars: "all",
          varsIgnorePattern: "^_",
          args: "after-used",
          argsIgnorePattern: "^_",
          caughtErrors: "all",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-unused-expressions": [
        "error",
        {
          allowShortCircuit: true,
          allowTernary: true,
          allowTaggedTemplates: true,
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          prefer: "type-imports",
          fixStyle: "inline-type-imports",
        },
      ],
    },
  },
  {
    files: ["**/*.test.ts", "**/*.test.tsx", "**/*.spec.ts", "**/*.spec.tsx", "**/__tests__/**"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-expressions": "off",
    },
  },
  {
    files: ["**/*.config.ts", "**/*.config.js", "**/*.config.mjs"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);