import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@werknario/shared": fileURLToPath(
        new URL("../shared/src/index.ts", import.meta.url),
      ),
      "@werknario/gitlab-client": fileURLToPath(
        new URL("../gitlab-client/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
