# Registry service — spec

A tiny VS Code extension gallery that the GitLab Web IDE points at (via the
instance's `vscode_extension_marketplace` → `preset=custom`). It exists to make
ONE private extension (`xconcapps.werknario-webide-agent`) installable in the
Web IDE, while leaving every other extension working exactly as before.

## Design: proxy + inject (blast radius is the whole point)

The instance marketplace flip is **instance-wide** — every user on
gitlab.xconcapps.de gets this gallery. So the guiding rule is:

> For any extension that is not ours, be a faithful pass-through to open-vsx.org.
> Only our extension is served locally. A bug in our code must not break anyone
> else's Extensions view.

This is safe because open-vsx's gallery responses carry **absolute** `source`
URLs (e.g. `https://open-vsx.org/api/...`). If we return open-vsx's JSON
untouched, the Web IDE fetches every other extension's files straight from
open-vsx — our service is never in that path. We only *add* our extension to the
results and *serve* our extension's files.

## Config (env)

| Env | Meaning | Example |
|---|---|---|
| `PORT` | listen port | `8080` |
| `PUBLIC_BASE_URL` | this service's public origin (no trailing slash) | `https://vsx.xconcapps.de` |
| `UPSTREAM_URL` | open-vsx base (no trailing slash) | `https://open-vsx.org` |
| `EXT_STORE` | dir holding our extension's files (see layout below) | `/opt/werknario-vsx/store` |

Read config once at startup; validate `PUBLIC_BASE_URL`/`EXT_STORE` exist.

## Our extension identity (fixed)

- publisher `xconcapps`, name `werknario-webide-agent`, version `0.1.0`
- displayName `Fleetlicht KI (werknario)`
- targetPlatform `web`
- The real values (displayName, description, engine) must be read from the
  packaged `extension/package.json` in `EXT_STORE/unpacked/` at startup — do not
  hardcode text that duplicates the manifest. Only the routing identity
  (publisher/name/version) is fixed in code.

## EXT_STORE layout (provided at deploy; a fixture is in test/fixtures for tests)

```
$EXT_STORE/
  werknario-webide-agent-web-0.1.0.vsix        # the packaged extension (VSIXPackage asset)
  unpacked/
    extension.vsixmanifest                     # VsixManifest asset
    [Content_Types].xml
    extension/
      package.json                             # Manifest asset  (has "browser")
      readme.md                                # Details asset
      dist/web/extension.js                    # the web entry, fetched via resource template
```

Note the `extension/` prefix inside `unpacked/` — the Web IDE requests resource
paths that include it (verified against open-vsx: `/vscode/unpkg/.../extension/package.json`
returns 200, `/vscode/unpkg/.../package.json` returns 404).

## Endpoints

### 1. `POST /vscode/gallery/extensionquery`  (the important one)

1. Forward the request faithfully to `${UPSTREAM_URL}/vscode/gallery/extensionquery`
   — same body, same `Content-Type` and `Accept` headers. Parse the JSON response.
2. Decide whether OUR extension matches this query:
   - **match by id**: any filter criterion with `filterType === 7` whose `value`
     case-insensitively equals `xconcapps.werknario-webide-agent`.
   - **match by search**: any criterion with `filterType === 10` (SearchText)
     whose `value` (lowercased) is a substring of any of:
     `xconcapps.werknario-webide-agent`, `werknario`, `fleetlicht`, our
     displayName lowercased, or appears in a small keyword set
     `["ki","agent","merge request","substrat"]`.
   - Only inject on the first page (`filters[].pageNumber` is 1 or absent).
3. If matched, prepend our extension object (schema below) to
   `results[0].extensions` and increment the `TotalCount` in
   `results[0].resultMetadata` (ResultCount → TotalCount) by 1. If
   `resultMetadata` is absent, create it.
4. Return the (possibly augmented) JSON with `200` and permissive CORS.

**Graceful degradation — never 5xx this route, and the handler must never
throw out of Express's control.** Any of the following count as "can't
safely proceed" and all degrade to the same valid response:
`{ results: [ { extensions: [<ours> if matched else nothing], resultMetadata:[{metadataType:"ResultCount", metadataItems:[{name:"TotalCount", count:<n>}]}] } ] }`.

- The upstream call fails or times out (use an AbortController, ~8s).
- Upstream answers with a non-2xx status (e.g. a 503 maintenance page).
  Never relay a non-2xx body to the client, even byte-identically — it is
  not a valid gallery response and must not be presented as one. Only a 2xx
  upstream response is eligible for pass-through or injection.
- Upstream's body isn't parseable JSON, or parses to something that isn't a
  JSON object (e.g. the literal `null`, or an array) — there's no
  `.results` to inject into.
- The client's own request body is unparseable JSON or exceeds the size cap
  (1 MB). In this case specifically, don't contact upstream at all — return
  the degraded response with an empty result (`ours` not injected, `n=0`),
  since a body we can't parse can't be matched against our query rules
  either.

A 5xx, a crash, or a relayed maintenance page would each blank the
Extensions view for every user; a degraded-but-valid 200 keeps the
marketplace usable no matter what open-vsx or the client sends. Implementations
must guard each of these cases explicitly (never assume `JSON.parse` yields
an object, never assume a fetch that resolves is a success) AND wrap the
route handler in a catch-all so an unanticipated error still produces this
same valid 200 instead of an unhandled rejection — Express 4 does not catch
a rejected promise from an async handler on its own, so an unguarded await
that throws takes the whole process down, not just the request.

### 2. `GET /vscode/asset/:publisher/:name/:version/*assetType`
- If `publisher`/`name` is ours: resolve the assetType to a file and serve it
  (or 302 to the corresponding `/api/.../file/...` URL — either is fine, match
  open-vsx which 302s). AssetType → file:
  - `Microsoft.VisualStudio.Code.Manifest` → `extension/package.json`
  - `Microsoft.VisualStudio.Services.VsixManifest` → `extension.vsixmanifest`
  - `Microsoft.VisualStudio.Services.VSIXPackage` → the `.vsix`
  - `Microsoft.VisualStudio.Services.Content.Details` → `extension/readme.md`
  - `Microsoft.VisualStudio.Services.Icons.Default` → 404/placeholder is OK (no icon shipped)
- Else: `302` to `${UPSTREAM_URL}/vscode/asset/:publisher/:name/:version/:assetType`.

### 3. `GET /vscode/unpkg/:publisher/:name/:version/*path`
- Ours: serve `EXT_STORE/unpacked/<path>` (path already includes `extension/`).
  404 if the file is outside `unpacked/` (path-traversal guard — reject `..`).
- Else: `302` to `${UPSTREAM_URL}/vscode/unpkg/:publisher/:name/:version/<path>`.

### 4. `GET /api/:publisher/:name/:version/file/*path`
- Ours: serve `EXT_STORE/unpacked/extension/<path>` for normal files, and the
  `.vsix` when `<path>` equals the vsix filename. (This is the route our
  injected `files[].source` URLs point at — see schema.) Path-traversal guarded.
- Else: `302` to `${UPSTREAM_URL}/api/:publisher/:name/:version/file/<path>`.

### 5. `GET /vscode/item`  → `302` to `${UPSTREAM_URL}/vscode/item` with the same query string.

### 6. `GET /healthz` → `200 {"ok":true}`.

### Fallback: any other path → `302` to the same path on `${UPSTREAM_URL}`.
Keeps us transparent for routes we didn't enumerate.

## Our extension object (what to inject)

Mirror the shape captured in `test/fixtures/openvsx-query-by-id.json`
(`results[0].extensions[0]`). Concretely:

```jsonc
{
  "extensionId": "00000000-0000-4000-8000-werknario0001",   // any stable uuid-ish string
  "extensionName": "werknario-webide-agent",
  "displayName": "<from manifest.displayName>",
  "shortDescription": "<from manifest.description>",
  "publisher": { "displayName": "X-Concapps", "publisherId": "xconcapps", "publisherName": "xconcapps", "domain": null, "isDomainVerified": false },
  "versions": [{
    "version": "0.1.0",
    "lastUpdated": "2026-07-16T00:00:00.000Z",             // static; no Date.now()
    "assetUri": "${PUBLIC_BASE_URL}/vscode/asset/xconcapps/werknario-webide-agent/0.1.0",
    "fallbackAssetUri": "${PUBLIC_BASE_URL}/vscode/asset/xconcapps/werknario-webide-agent/0.1.0",
    "targetPlatform": "web",
    "files": [
      { "assetType": "Microsoft.VisualStudio.Code.Manifest",           "source": "${PUBLIC_BASE_URL}/api/xconcapps/werknario-webide-agent/0.1.0/file/package.json" },
      { "assetType": "Microsoft.VisualStudio.Services.Content.Details", "source": "${PUBLIC_BASE_URL}/api/xconcapps/werknario-webide-agent/0.1.0/file/readme.md" },
      { "assetType": "Microsoft.VisualStudio.Services.VsixManifest",    "source": "${PUBLIC_BASE_URL}/api/xconcapps/werknario-webide-agent/0.1.0/file/extension.vsixmanifest" },
      { "assetType": "Microsoft.VisualStudio.Services.VSIXPackage",     "source": "${PUBLIC_BASE_URL}/api/xconcapps/werknario-webide-agent/0.1.0/file/werknario-webide-agent-web-0.1.0.vsix" }
    ],
    "properties": [
      { "key": "Microsoft.VisualStudio.Code.Engine", "value": "<from manifest.engines.vscode>" },
      { "key": "Microsoft.VisualStudio.Code.ExtensionKind", "value": "web" }
    ]
  }],
  "statistics": [],
  "tags": [],
  "categories": ["Other"],
  "flags": "validated, public"
}
```

For the `extension.vsixmanifest` / `package.json` served via `/api/.../file/...`,
note the vsixmanifest lives at `unpacked/extension.vsixmanifest` and package.json
at `unpacked/extension/package.json`. Map those two filenames specially in
route 4; everything else resolves under `unpacked/extension/`.

## CORS

Every response includes:
`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Headers: *`,
`Access-Control-Allow-Methods: GET, POST, OPTIONS`. Answer `OPTIONS` preflight
with `204`. (The Web IDE calls this cross-origin from the gitlab.xconcapps.de
origin.) No credentials, so `*` is safe.

## Content types

`.json`→`application/json`, `.js`→`text/javascript; charset=utf-8`,
`.vsix`→`application/octet-stream`, `.vsixmanifest`→`text/xml`,
`.md`→`text/markdown`. Default `application/octet-stream`.

## Tech + tests

- Node 24, TypeScript strict (match the repo's tsconfig.base). Native `fetch`.
  Prefer `express` (small, EU-hosted, no concern) OR raw `node:http` — your call,
  but keep deps minimal and pin versions.
- Structure like the `proxy` package: a `createApp(config)` factory that takes an
  injectable `fetchImpl` and an injectable file-reader/`EXT_STORE` root so tests
  need no network and no real files. A thin `server.ts` binds it to `PORT`,
  **loopback + container-only** (bind `0.0.0.0` is fine inside the container since
  Caddy is the only ingress; do NOT add any auth — a gallery is public read-only).
- Vitest tests, no network, using the two fixtures:
  1. by-id query for our id → our extension is present in results, TotalCount bumped.
  2. by-id query for someone else's id → response byte-identical to upstream (no mutation).
  3. search query matching "werknario"/"fleetlicht" → ours injected on page 1 only.
  4. search query NOT matching us → upstream passed through untouched.
  5. upstream throws → still a valid 200 gallery response (degradation), ours present iff id-match.
  6. unpkg/api/file for a non-xconcapps publisher → 302 to UPSTREAM with the same path.
  7. unpkg/api/file for ours → serves the fixture file bytes; `..` path is rejected.
  8. OPTIONS preflight → 204 with CORS headers; every response carries ACAO `*`.
  9. `/healthz` → 200.
- A `test/fixtures/store/` with a minimal fake unpacked extension (package.json
  with `browser`, a readme.md, a dummy dist/web/extension.js, an
  extension.vsixmanifest, and a dummy .vsix) so file-serving tests are hermetic.

## Out of scope
No publish/upload endpoints, no auth, no database, no search ranking of our
extension. This is a read-only shim.
