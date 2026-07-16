import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface OurManifest {
  displayName: string;
  description: string;
  engineVscode: string;
}

interface PackageJsonShape {
  displayName?: string;
  description?: string;
  engines?: { vscode?: string };
}

/**
 * Reads our extension's packaged manifest from `EXT_STORE/unpacked/extension/package.json`.
 *
 * This is the only source of truth for displayName/description/engine — the
 * spec is explicit that these must never be hardcoded, so they can't drift
 * from what we actually ship. Only the routing identity (publisher/name/
 * version) is fixed in code, see identity.ts.
 */
export function loadOurManifest(extStore: string): OurManifest {
  const manifestPath = join(extStore, "unpacked", "extension", "package.json");
  const raw = readFileSync(manifestPath, "utf8");
  const pkg = JSON.parse(raw) as PackageJsonShape;
  return {
    displayName: pkg.displayName ?? "",
    description: pkg.description ?? "",
    engineVscode: pkg.engines?.vscode ?? "*",
  };
}
