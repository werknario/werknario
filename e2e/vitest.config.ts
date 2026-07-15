import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@werknario/shared": fileURLToPath(
        new URL("../packages/shared/src/index.ts", import.meta.url),
      ),
      "@werknario/gitlab-client": fileURLToPath(
        new URL("../packages/gitlab-client/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
