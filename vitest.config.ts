import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Scope Vitest to the frontend tree. The scripts/ tree uses node:test directly
// (npm run test) and would error if Vitest tried to load it.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["src/test-setup.ts"],
  },
});
