import { extname } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".json": "application/json",
  ".js": "text/javascript; charset=utf-8",
  ".vsix": "application/octet-stream",
  ".vsixmanifest": "text/xml",
  ".md": "text/markdown",
};

/** Maps a file's extension to the Content-Type we serve it with. Anything
 * unrecognized falls back to application/octet-stream. */
export function contentTypeFor(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}
