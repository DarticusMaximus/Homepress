import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    include: [
      "web/**/*.test.ts",
      "web/**/*.test.tsx",
      "worker/**/*.test.ts",
      "shared/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/build/**", "**/.next/**"],
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./web"),
    },
  },
});
