import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const alias = (p: string) =>
  fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@werknario/shared": alias("../shared/src/index.ts"),
      "@werknario/gitlab-client": alias("../gitlab-client/src/index.ts"),
      "@werknario/github-client": alias("../github-client/src/index.ts"),
      "@werknario/proxy": alias("../proxy/src/index.ts"),
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
