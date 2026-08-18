import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@uwbench/protocol": fileURLToPath(
        new URL("./packages/protocol/src/index.ts", import.meta.url),
      ),
      "@uwbench/tool-runtime": fileURLToPath(
        new URL("./packages/tool-runtime/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: [
      "packages/*/src/**/*.test.ts",
      "apps/*/src/**/*.test.ts",
      "examples/securelend-adapter/src/**/*.test.ts",
    ],
    exclude: [
      "node_modules/**",
      "**/node_modules/**",
      "dist/**",
      "build/**",
      "examples/**",
      "benchmark/**",
      "docs/**",
      ".agent-workflow/**",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: ["packages/**/src/**", "apps/**/src/**"],
      exclude: [
        "node_modules/**",
        "**/node_modules/**",
        "dist/**",
        "build/**",
        "examples/**",
        "benchmark/**",
        "docs/**",
        "scripts/**",
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/__tests__/**",
        "**/*.config.*",
        "**/*.d.ts",
      ],
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
    passWithNoTests: true,
  },
});