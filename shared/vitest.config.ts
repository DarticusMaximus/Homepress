import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/build/**"],
  },
  resolve: {
    alias: {
      "server-only": path.resolve(__dirname, "../vitest-stubs/server-only.ts"),
    },
  },
});
