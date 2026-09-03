import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@uwbench/protocol": fileURLToPath(
        new URL("../../packages/protocol/src/index.ts", import.meta.url),
      ),
      "@uwbench/tool-runtime": fileURLToPath(
        new URL("../../packages/tool-runtime/src/index.ts", import.meta.url),
      ),
      "@uwbench/securelend-adapter": fileURLToPath(
        new URL("../securelend-adapter/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 60000,
  },
});
