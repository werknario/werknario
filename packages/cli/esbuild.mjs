import esbuild from "esbuild";
import { fileURLToPath } from "node:url";

// Bundle the CLI into a single dist/cli.js. Workspace packages are pulled from
// source via aliases (no build-order dependency on their dist); node_modules
// dependencies stay external and resolve at runtime, so the bundle stays small
// and does not try to inline the model SDKs.
const alias = {
  "@werknario/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
  "@werknario/gitlab-client": fileURLToPath(new URL("../gitlab-client/src/index.ts", import.meta.url)),
  "@werknario/github-client": fileURLToPath(new URL("../github-client/src/index.ts", import.meta.url)),
  "@werknario/proxy": fileURLToPath(new URL("../proxy/src/index.ts", import.meta.url)),
};

await esbuild.build({
  entryPoints: ["src/cli.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node20",
  outfile: "dist/cli.js",
  alias,
  packages: "external",
  banner: { js: "#!/usr/bin/env node" },
  sourcemap: true,
  logLevel: "info",
});
console.log("built dist/cli.js");
