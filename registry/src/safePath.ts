import { resolve, sep } from "node:path";

/**
 * Resolves `relativePath` under `root`, refusing to leave it.
 *
 * Rejects a null byte, any "." or ".." path segment, and — as defense in
 * depth — anything that resolves outside `root` even after that segment
 * check (e.g. an absolute path smuggled in as `relativePath`). Returns the
 * resolved absolute path, or null if the request is unsafe.
 */
export function resolveStorePath(root: string, relativePath: string): string | null {
  if (relativePath.includes("\0")) return null;

  const segments = relativePath.split(/[\\/]/);
  if (segments.some((segment) => segment === "." || segment === "..")) return null;

  const resolvedRoot = resolve(root);
  const resolvedTarget = resolve(resolvedRoot, relativePath);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(resolvedRoot + sep)) {
    return null;
  }
  return resolvedTarget;
}
