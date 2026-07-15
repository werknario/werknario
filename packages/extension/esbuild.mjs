import esbuild from "esbuild";
import { fileURLToPath } from "node:url";

// Bundle the extension as a browser Web Worker extension (no Node APIs).
// The workspace packages are pulled in from source via aliases, so there is no
// build-order dependency on their dist output.
const alias = {
  "@werknario/shared": fileURLToPath(
    new URL("../shared/src/index.ts", import.meta.url),
  ),
  "@werknario/gitlab-client": fileURLToPath(
    new URL("../gitlab-client/src/index.ts", import.meta.url),
  ),
};

const watch = process.argv.includes("--watch");

const options = {
  entryPoints: ["src/extension.ts"],
  bundle: true,
  format: "cjs",
  platform: "browser",
  target: "es2022",
  outfile: "dist/web/extension.js",
  external: ["vscode"],
  alias,
  sourcemap: true,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("esbuild watching…");
} else {
  await esbuild.build(options);
  console.log("built dist/web/extension.js");
}
