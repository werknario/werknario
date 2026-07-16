import { join } from "node:path";
import { readFile } from "node:fs/promises";
import express, { type NextFunction, type Request, type Response } from "express";
import { contentTypeFor } from "./contentType.js";
import {
  buildOurExtension,
  degradedResponse,
  injectIntoResponse,
  isRecord,
  matchesOurExtensionQuery,
  ourAssetFilename,
  type OurExtension,
} from "./gallery.js";
import { isOurs, OUR_EXTENSION_NAME, OUR_PUBLISHER, OUR_VERSION, OUR_VSIX_FILENAME } from "./identity.js";
import { loadOurManifest } from "./manifest.js";
import { readRawBody } from "./rawBody.js";
import { resolveStorePath } from "./safePath.js";

/** ~8s per SPEC.md — long enough for a slow upstream, short enough that a
 * dead open-vsx doesn't stall every Extensions view in the instance. */
const UPSTREAM_TIMEOUT_MS = 8000;

/** Client request body cap for /vscode/gallery/extensionquery — real
 * queries are tiny; anything past this is rejected without contacting
 * upstream (see SPEC.md's graceful degradation rules). */
const MAX_QUERY_BODY_BYTES = 1024 * 1024;

export interface AppConfig {
  publicBaseUrl: string;
  upstreamUrl: string;
  extStore: string;
  fetchImpl: typeof fetch;
}

type AssetParams = { publisher: string; name: string; version: string; assetType: string };
type UnpkgParams = { publisher: string; name: string; version: string; path: string };
type FileParams = { publisher: string; name: string; version: string; path: string };

function applyCors(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

function corsMiddleware() {
  return (req: Request, res: Response, next: NextFunction): void => {
    applyCors(res);
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    next();
  };
}

async function serveFile(res: Response, absolutePath: string): Promise<void> {
  try {
    const data = await readFile(absolutePath);
    res.setHeader("Content-Type", contentTypeFor(absolutePath));
    res.status(200).send(data);
  } catch {
    res.status(404).end();
  }
}

function headerValue(value: string | string[] | undefined, fallback: string): string {
  return typeof value === "string" && value.length > 0 ? value : fallback;
}

/** Builds the Express app. Split from server.ts so tests can inject a fake
 * fetch and a fixture EXT_STORE without network or the real deploy files. */
export function createApp(config: AppConfig): express.Express {
  // Read once at startup — never hardcode text that duplicates the manifest.
  const manifest = loadOurManifest(config.extStore);
  const ourExtension: OurExtension = buildOurExtension(config.publicBaseUrl, manifest);

  const unpackedRoot = join(config.extStore, "unpacked");
  const unpackedExtensionRoot = join(config.extStore, "unpacked", "extension");

  const app = express();
  app.use(corsMiddleware());

  // 1. POST /vscode/gallery/extensionquery
  //
  // This route must NEVER throw out of the handler and must NEVER answer
  // with a 5xx — a crash here (or a bad upstream response relayed as-is)
  // blanks the Extensions view for every user on the instance. Every step
  // below degrades to a valid 200 instead of propagating an error; the
  // outer try/catch is a last-resort backstop in case a step we didn't
  // anticipate throws anyway.
  app.post("/vscode/gallery/extensionquery", async (req: Request, res: Response) => {
    let matched = false;
    try {
      let rawRequestBody: string;
      try {
        rawRequestBody = await readRawBody(req, MAX_QUERY_BODY_BYTES);
      } catch {
        // Oversized or unreadable body — don't bother upstream with it.
        res.status(200).json(degradedResponse(undefined));
        return;
      }

      let requestBody: unknown;
      try {
        requestBody = rawRequestBody.trim() === "" ? {} : JSON.parse(rawRequestBody);
      } catch {
        // Malformed JSON — same treatment, no upstream call.
        res.status(200).json(degradedResponse(undefined));
        return;
      }

      matched = matchesOurExtensionQuery(requestBody, manifest.displayName);

      let upstreamOk = false;
      let upstreamContentType = "application/json";
      let rawResponseText: string | undefined;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
        try {
          const upstreamRes = await config.fetchImpl(`${config.upstreamUrl}/vscode/gallery/extensionquery`, {
            method: "POST",
            headers: {
              "content-type": headerValue(req.headers["content-type"], "application/json"),
              accept: headerValue(req.headers["accept"], "application/json;api-version=3.0-preview.1"),
            },
            // Forward the exact bytes the client sent — byte-faithful in
            // both directions, not just on the way back.
            body: rawRequestBody,
            signal: controller.signal,
          });
          upstreamOk = upstreamRes.ok;
          upstreamContentType = upstreamRes.headers.get("content-type") ?? "application/json";
          rawResponseText = await upstreamRes.text();
        } finally {
          clearTimeout(timer);
        }
      } catch {
        upstreamOk = false;
        rawResponseText = undefined;
      }

      // Network failure, timeout, or a non-2xx upstream status (e.g. a 503
      // maintenance page) — never relay that as if it were a real gallery
      // response.
      if (!upstreamOk || rawResponseText === undefined) {
        res.status(200).json(degradedResponse(matched ? ourExtension : undefined));
        return;
      }

      if (!matched) {
        // Faithful pass-through: relay upstream's exact bytes and its own
        // Content-Type, no re-serialization. Sent as a Buffer, not a
        // string — Express's res.send(string) rewrites the Content-Type it
        // was just given to append "; charset=utf-8", which would mean we
        // aren't actually relaying upstream's header byte-for-byte anymore.
        res.status(200).setHeader("Content-Type", upstreamContentType);
        res.send(Buffer.from(rawResponseText, "utf8"));
        return;
      }

      let parsedResponse: unknown;
      try {
        parsedResponse = JSON.parse(rawResponseText);
      } catch {
        res.status(200).json(degradedResponse(ourExtension));
        return;
      }

      // A syntactically valid JSON document that isn't an object (e.g. the
      // literal `null`) has no `.results` to inject into — degrade instead
      // of dereferencing it. injectIntoResponse() guards against this too
      // (defense in depth), but failing fast here keeps the intent obvious.
      if (!isRecord(parsedResponse)) {
        res.status(200).json(degradedResponse(ourExtension));
        return;
      }

      res.status(200).json(injectIntoResponse(parsedResponse, ourExtension));
    } catch {
      if (!res.headersSent) {
        res.status(200).json(degradedResponse(matched ? ourExtension : undefined));
      }
    }
  });

  // 2. GET /vscode/asset/:publisher/:name/:version/:assetType(.*)
  app.get(
    "/vscode/asset/:publisher/:name/:version/:assetType(.*)",
    (req: Request<AssetParams>, res: Response) => {
      const { publisher, name, version, assetType } = req.params;
      if (isOurs(publisher, name)) {
        const filename = ourAssetFilename(assetType);
        if (!filename) {
          res.status(404).end();
          return;
        }
        res.redirect(
          302,
          `${config.publicBaseUrl}/api/${OUR_PUBLISHER}/${OUR_EXTENSION_NAME}/${OUR_VERSION}/file/${filename}`
        );
        return;
      }
      res.redirect(302, `${config.upstreamUrl}/vscode/asset/${publisher}/${name}/${version}/${assetType}`);
    }
  );

  // 3. GET /vscode/unpkg/:publisher/:name/:version/:path(.*)
  app.get(
    "/vscode/unpkg/:publisher/:name/:version/:path(.*)",
    async (req: Request<UnpkgParams>, res: Response) => {
      const { publisher, name, version, path: relPath } = req.params;
      if (isOurs(publisher, name)) {
        const resolved = resolveStorePath(unpackedRoot, relPath);
        if (!resolved) {
          res.status(404).end();
          return;
        }
        await serveFile(res, resolved);
        return;
      }
      res.redirect(302, `${config.upstreamUrl}/vscode/unpkg/${publisher}/${name}/${version}/${relPath}`);
    }
  );

  // 4. GET /api/:publisher/:name/:version/file/:path(.*)
  app.get(
    "/api/:publisher/:name/:version/file/:path(.*)",
    async (req: Request<FileParams>, res: Response) => {
      const { publisher, name, version, path: relPath } = req.params;
      if (isOurs(publisher, name)) {
        // extension.vsixmanifest lives at unpacked/, the .vsix at the store
        // root — everything else resolves under unpacked/extension/.
        const resolved =
          relPath === OUR_VSIX_FILENAME
            ? resolveStorePath(config.extStore, OUR_VSIX_FILENAME)
            : relPath === "extension.vsixmanifest"
              ? resolveStorePath(unpackedRoot, "extension.vsixmanifest")
              : resolveStorePath(unpackedExtensionRoot, relPath);
        if (!resolved) {
          res.status(404).end();
          return;
        }
        await serveFile(res, resolved);
        return;
      }
      res.redirect(302, `${config.upstreamUrl}/api/${publisher}/${name}/${version}/file/${relPath}`);
    }
  );

  // 5. GET /vscode/item -> upstream, same query string
  app.get("/vscode/item", (req: Request, res: Response) => {
    res.redirect(302, `${config.upstreamUrl}${req.originalUrl}`);
  });

  // 6. GET /healthz
  app.get("/healthz", (_req: Request, res: Response) => {
    res.status(200).json({ ok: true });
  });

  // Fallback: anything we didn't enumerate stays transparent.
  app.use((req: Request, res: Response) => {
    res.redirect(302, `${config.upstreamUrl}${req.originalUrl}`);
  });

  // Last-resort error handler — CORS headers were already set above, so
  // even an unexpected throw doesn't blank the Extensions view.
  app.use((_err: unknown, _req: Request, res: Response, next: NextFunction) => {
    if (res.headersSent) {
      next(_err);
      return;
    }
    res.status(502).json({ error: "Registry error" });
  });

  return app;
}
