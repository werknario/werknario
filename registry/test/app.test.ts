import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp, type AppConfig } from "../src/app.js";

const FIXTURES_DIR = fileURLToPath(new URL("./fixtures", import.meta.url));
const EXT_STORE = join(FIXTURES_DIR, "store");

const BY_ID_FIXTURE = readFileSync(join(FIXTURES_DIR, "openvsx-query-by-id.json"), "utf8");
const SEARCH_FIXTURE = readFileSync(join(FIXTURES_DIR, "openvsx-query-search.json"), "utf8");

const PUBLIC_BASE_URL = "https://vsx.xconcapps.test";
const UPSTREAM_URL = "https://open-vsx.test";
const OUR_ID = "xconcapps.werknario-webide-agent";

function jsonFetch(body: string): typeof fetch {
  return (async () =>
    new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
}

function throwingFetch(message = "network down"): typeof fetch {
  return (async () => {
    throw new Error(message);
  }) as typeof fetch;
}

/** General-purpose fake upstream: any status, any body, any Content-Type
 * (or none, via `contentType: null`). */
function fetchReturning(body: string, opts?: { status?: number; contentType?: string | null }): typeof fetch {
  const status = opts?.status ?? 200;
  const contentType = opts?.contentType === undefined ? "application/json" : opts.contentType;
  return (async () => {
    const res = new Response(body, { status });
    if (contentType === null) {
      res.headers.delete("content-type");
    } else {
      res.headers.set("content-type", contentType);
    }
    return res;
  }) as typeof fetch;
}

function buildApp(fetchImpl: typeof fetch) {
  const config: AppConfig = {
    publicBaseUrl: PUBLIC_BASE_URL,
    upstreamUrl: UPSTREAM_URL,
    extStore: EXT_STORE,
    fetchImpl,
  };
  return createApp(config);
}

function idQuery(value: string, pageNumber?: number): Record<string, unknown> {
  return {
    filters: [
      {
        criteria: [{ filterType: 7, value }],
        ...(pageNumber === undefined ? {} : { pageNumber }),
      },
    ],
  };
}

function searchQuery(value: string, pageNumber?: number): Record<string, unknown> {
  return {
    filters: [
      {
        criteria: [{ filterType: 10, value }],
        ...(pageNumber === undefined ? {} : { pageNumber }),
      },
    ],
  };
}

// 1. by-id query for our id -> our extension is present, TotalCount bumped.
describe("POST /vscode/gallery/extensionquery — matched by id", () => {
  it("injects our extension and bumps TotalCount", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).post("/vscode/gallery/extensionquery").send(idQuery(OUR_ID));

    expect(res.status).toBe(200);
    const result = res.body.results[0];
    expect(result.extensions).toHaveLength(2);
    expect(result.extensions[0].extensionName).toBe("werknario-webide-agent");
    expect(result.extensions[0].publisher.publisherName).toBe("xconcapps");
    const totalCount = result.resultMetadata[0].metadataItems.find(
      (item: { name: string }) => item.name === "TotalCount"
    );
    expect(totalCount.count).toBe(2); // fixture's own TotalCount was 1
  });

  it("matches the id case-insensitively", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app)
      .post("/vscode/gallery/extensionquery")
      .send(idQuery("XCONCAPPS.WERKNARIO-WEBIDE-AGENT"));

    expect(res.status).toBe(200);
    expect(res.body.results[0].extensions).toHaveLength(2);
  });

  it("reads displayName/description/engine from the packaged manifest, not hardcoded text", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).post("/vscode/gallery/extensionquery").send(idQuery(OUR_ID));

    const ours = res.body.results[0].extensions[0];
    expect(ours.displayName).toBe("Fleetlicht KI (werknario)");
    expect(ours.shortDescription).toContain("GitLab Web IDE");
    const engine = ours.versions[0].properties.find(
      (p: { key: string }) => p.key === "Microsoft.VisualStudio.Code.Engine"
    );
    expect(engine.value).toBe("^1.92.0");
    // Static per spec — no Date.now()/new Date().
    expect(ours.versions[0].lastUpdated).toBe("2026-07-16T00:00:00.000Z");
  });
});

// 2. by-id query for someone else's id -> byte-identical passthrough.
describe("POST /vscode/gallery/extensionquery — non-matching id", () => {
  it("returns upstream's response byte-identical, no mutation", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app)
      .post("/vscode/gallery/extensionquery")
      .send(idQuery("GitLab.gitlab-workflow"));

    expect(res.status).toBe(200);
    expect(res.text).toBe(BY_ID_FIXTURE);
  });
});

// 3. search query matching us -> injected on page 1 only.
describe("POST /vscode/gallery/extensionquery — matched by search, first page only", () => {
  it("injects ours for a 'werknario' search with no pageNumber (implicit page 1)", async () => {
    const app = buildApp(jsonFetch(SEARCH_FIXTURE));
    const res = await request(app).post("/vscode/gallery/extensionquery").send(searchQuery("werknario"));

    expect(res.status).toBe(200);
    const result = res.body.results[0];
    expect(result.extensions[0].extensionName).toBe("werknario-webide-agent");
    expect(result.extensions).toHaveLength(6); // 5 upstream + ours
    const totalCount = result.resultMetadata[0].metadataItems.find(
      (item: { name: string }) => item.name === "TotalCount"
    );
    expect(totalCount.count).toBe(345); // fixture's own TotalCount was 344
  });

  it("injects ours for a 'fleetlicht' search on explicit pageNumber 1", async () => {
    const app = buildApp(jsonFetch(SEARCH_FIXTURE));
    const res = await request(app)
      .post("/vscode/gallery/extensionquery")
      .send(searchQuery("fleetlicht", 1));

    expect(res.status).toBe(200);
    expect(res.body.results[0].extensions[0].extensionName).toBe("werknario-webide-agent");
  });

  it("matches a keyword from the small keyword set (e.g. 'agent')", async () => {
    const app = buildApp(jsonFetch(SEARCH_FIXTURE));
    const res = await request(app).post("/vscode/gallery/extensionquery").send(searchQuery("agent"));

    expect(res.status).toBe(200);
    expect(res.body.results[0].extensions[0].extensionName).toBe("werknario-webide-agent");
  });

  it("does NOT inject on page 2, even for a matching search term", async () => {
    const app = buildApp(jsonFetch(SEARCH_FIXTURE));
    const res = await request(app)
      .post("/vscode/gallery/extensionquery")
      .send(searchQuery("werknario", 2));

    expect(res.status).toBe(200);
    expect(res.text).toBe(SEARCH_FIXTURE);
  });
});

// 4. search query NOT matching us -> untouched passthrough.
describe("POST /vscode/gallery/extensionquery — non-matching search", () => {
  it("returns upstream's response byte-identical for an unrelated search term", async () => {
    const app = buildApp(jsonFetch(SEARCH_FIXTURE));
    const res = await request(app)
      .post("/vscode/gallery/extensionquery")
      .send(searchQuery("python-linting"));

    expect(res.status).toBe(200);
    expect(res.text).toBe(SEARCH_FIXTURE);
  });
});

// 5. upstream throws -> still a valid 200 gallery response (degradation).
describe("POST /vscode/gallery/extensionquery — graceful degradation", () => {
  it("returns 200 with ours present when upstream throws and the query matched by id", async () => {
    const app = buildApp(throwingFetch());
    const res = await request(app).post("/vscode/gallery/extensionquery").send(idQuery(OUR_ID));

    expect(res.status).toBe(200);
    expect(res.body.results[0].extensions).toHaveLength(1);
    expect(res.body.results[0].extensions[0].extensionName).toBe("werknario-webide-agent");
    expect(res.body.results[0].resultMetadata[0].metadataItems[0].count).toBe(1);
  });

  it("returns 200 with an empty result when upstream throws and the query did not match", async () => {
    const app = buildApp(throwingFetch());
    const res = await request(app)
      .post("/vscode/gallery/extensionquery")
      .send(idQuery("GitLab.gitlab-workflow"));

    expect(res.status).toBe(200);
    expect(res.body.results[0].extensions).toHaveLength(0);
    expect(res.body.results[0].resultMetadata[0].metadataItems[0].count).toBe(0);
  });

  it("returns 200 even when upstream returns bytes that aren't valid JSON", async () => {
    const app = buildApp(jsonFetch("this is not json"));
    const res = await request(app).post("/vscode/gallery/extensionquery").send(idQuery(OUR_ID));

    expect(res.status).toBe(200);
    expect(res.body.results[0].extensions[0].extensionName).toBe("werknario-webide-agent");
  });
});

// 6. unpkg/asset/file for a non-xconcapps publisher -> 302 to upstream, same path.
describe("Pass-through routes for someone else's publisher", () => {
  it("redirects /vscode/unpkg/... to upstream with the same path", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get("/vscode/unpkg/GitLab/gitlab-workflow/6.85.3/extension/package.json");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      `${UPSTREAM_URL}/vscode/unpkg/GitLab/gitlab-workflow/6.85.3/extension/package.json`
    );
  });

  it("redirects /api/.../file/... to upstream with the same path", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get("/api/GitLab/gitlab-workflow/6.85.3/file/package.json");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${UPSTREAM_URL}/api/GitLab/gitlab-workflow/6.85.3/file/package.json`);
  });

  it("redirects /vscode/asset/... to upstream with the same path", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get(
      "/vscode/asset/GitLab/gitlab-workflow/6.85.3/Microsoft.VisualStudio.Services.VSIXPackage"
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      `${UPSTREAM_URL}/vscode/asset/GitLab/gitlab-workflow/6.85.3/Microsoft.VisualStudio.Services.VSIXPackage`
    );
  });
});

// 7. unpkg/api/file for ours -> serves fixture bytes; ".." rejected.
describe("File-serving routes for our extension", () => {
  it("serves the manifest via /vscode/unpkg (path already includes extension/)", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get(
      `/vscode/unpkg/xconcapps/werknario-webide-agent/0.1.0/extension/package.json`
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json");
    const expected = readFileSync(join(EXT_STORE, "unpacked", "extension", "package.json"));
    expect(Buffer.from(res.text)).toEqual(expected);
  });

  it("serves the web entry JS via /vscode/unpkg", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get(
      `/vscode/unpkg/xconcapps/werknario-webide-agent/0.1.0/extension/dist/web/extension.js`
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/javascript; charset=utf-8");
  });

  it("serves the readme via /api/.../file", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get(`/api/xconcapps/werknario-webide-agent/0.1.0/file/readme.md`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/markdown");
    const expected = readFileSync(join(EXT_STORE, "unpacked", "extension", "readme.md"), "utf8");
    expect(res.text).toBe(expected);
  });

  it("serves the vsixmanifest via /api/.../file (special-cased: lives at unpacked/, not unpacked/extension/)", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get(
      `/api/xconcapps/werknario-webide-agent/0.1.0/file/extension.vsixmanifest`
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("text/xml");
    const expected = readFileSync(join(EXT_STORE, "unpacked", "extension.vsixmanifest"), "utf8");
    expect(res.text).toBe(expected);
  });

  it("serves the .vsix via /api/.../file (special-cased: lives at the store root)", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get(
      `/api/xconcapps/werknario-webide-agent/0.1.0/file/werknario-webide-agent-web-0.1.0.vsix`
    );

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/octet-stream");
    const expected = readFileSync(join(EXT_STORE, "werknario-webide-agent-web-0.1.0.vsix"));
    expect(res.body).toEqual(expected);
  });

  it("rejects a .. path-traversal attempt on /vscode/unpkg with 404", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get(
      "/vscode/unpkg/xconcapps/werknario-webide-agent/0.1.0/..%2f..%2f..%2fetc%2fpasswd"
    );

    expect(res.status).toBe(404);
  });

  it("rejects a .. path-traversal attempt on /api/.../file with 404", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get(
      "/api/xconcapps/werknario-webide-agent/0.1.0/file/..%2f..%2fpackage.json"
    );

    expect(res.status).toBe(404);
  });

  it("404s for an unmapped assetType on /vscode/asset (e.g. Icons.Default — no icon shipped)", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get(
      "/vscode/asset/xconcapps/werknario-webide-agent/0.1.0/Microsoft.VisualStudio.Services.Icons.Default"
    );

    expect(res.status).toBe(404);
  });

  it("redirects /vscode/asset to our own file route for a known assetType", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get(
      "/vscode/asset/xconcapps/werknario-webide-agent/0.1.0/Microsoft.VisualStudio.Code.Manifest"
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(
      `${PUBLIC_BASE_URL}/api/xconcapps/werknario-webide-agent/0.1.0/file/package.json`
    );
  });
});

// 8. OPTIONS preflight -> 204 with CORS headers; every response carries ACAO *.
describe("CORS", () => {
  it("answers OPTIONS preflight with 204 and the required CORS headers", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).options("/vscode/gallery/extensionquery");

    expect(res.status).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe("*");
    expect(res.headers["access-control-allow-headers"]).toBe("*");
    expect(res.headers["access-control-allow-methods"]).toBe("GET, POST, OPTIONS");
  });

  it("carries Access-Control-Allow-Origin: * on a 200 response", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get("/healthz");

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("carries Access-Control-Allow-Origin: * on a 302 redirect", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get("/vscode/unpkg/GitLab/gitlab-workflow/6.85.3/x");

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });

  it("carries Access-Control-Allow-Origin: * on a 404", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get(
      "/vscode/unpkg/xconcapps/werknario-webide-agent/0.1.0/..%2f..%2fpackage.json"
    );

    expect(res.headers["access-control-allow-origin"]).toBe("*");
  });
});

// 9. /healthz -> 200.
describe("GET /healthz", () => {
  it("returns 200 {ok:true}", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get("/healthz");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});

// Bonus coverage beyond the 9 enumerated cases: the remaining routes the
// spec enumerates (vscode/item, and the generic fallback).
describe("GET /vscode/item", () => {
  it("redirects to upstream with the same query string", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get("/vscode/item?itemName=xconcapps.werknario-webide-agent");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${UPSTREAM_URL}/vscode/item?itemName=xconcapps.werknario-webide-agent`);
  });
});

describe("Fallback for unenumerated paths", () => {
  it("redirects to the same path on upstream", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).get("/vscode/gallery/publishers/xconcapps");

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`${UPSTREAM_URL}/vscode/gallery/publishers/xconcapps`);
  });
});

// Regression: upstream body "null" is valid JSON but not an object, so
// naively dereferencing `.results` on it crashes the process (unhandled
// rejection in an async Express 4 handler). Must degrade instead, for both
// a matched and an unmatched query.
describe("Regression: upstream responds with the literal JSON null", () => {
  it("degrades to a valid 200 with ours present for a matched query", async () => {
    const app = buildApp(fetchReturning("null"));
    const res = await request(app).post("/vscode/gallery/extensionquery").send(idQuery(OUR_ID));

    expect(res.status).toBe(200);
    expect(res.body.results[0].extensions).toHaveLength(1);
    expect(res.body.results[0].extensions[0].extensionName).toBe("werknario-webide-agent");
    expect(res.body.results[0].resultMetadata[0].metadataItems[0].count).toBe(1);
  });

  it("stays a valid 200 for an unmatched query (never reaches the inject path, so the literal null is just relayed)", async () => {
    const app = buildApp(fetchReturning("null"));
    const res = await request(app)
      .post("/vscode/gallery/extensionquery")
      .send(idQuery("GitLab.gitlab-workflow"));

    expect(res.status).toBe(200);
    expect(res.text).toBe("null");
  });
});

// Regression: a non-2xx upstream status (e.g. a maintenance page) must
// never be relayed to the client as if it were a real gallery response.
describe("Regression: upstream responds with a non-2xx status", () => {
  const maintenancePage = "<html><body>open-vsx is down for maintenance</body></html>";

  it("degrades to a valid 200 with ours present for a matched query, HTML never relayed", async () => {
    const app = buildApp(fetchReturning(maintenancePage, { status: 503, contentType: "text/html" }));
    const res = await request(app).post("/vscode/gallery/extensionquery").send(idQuery(OUR_ID));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("maintenance");
    expect(res.body.results[0].extensions[0].extensionName).toBe("werknario-webide-agent");
    expect(res.body.results[0].resultMetadata[0].metadataItems[0].count).toBe(1);
  });

  it("degrades to a valid 200 with an empty result for an unmatched query, HTML never relayed", async () => {
    const app = buildApp(fetchReturning(maintenancePage, { status: 503, contentType: "text/html" }));
    const res = await request(app)
      .post("/vscode/gallery/extensionquery")
      .send(idQuery("GitLab.gitlab-workflow"));

    expect(res.status).toBe(200);
    expect(res.text).not.toContain("maintenance");
    expect(res.body.results[0].extensions).toHaveLength(0);
    expect(res.body.results[0].resultMetadata[0].metadataItems[0].count).toBe(0);
  });

  it("also degrades on a non-2xx redirect-ish status like 404", async () => {
    const app = buildApp(fetchReturning("Not Found", { status: 404, contentType: "text/plain" }));
    const res = await request(app).post("/vscode/gallery/extensionquery").send(idQuery(OUR_ID));

    expect(res.status).toBe(200);
    expect(res.body.results[0].extensions[0].extensionName).toBe("werknario-webide-agent");
  });
});

describe("2xx passthrough relays upstream's own Content-Type", () => {
  it("relays a non-default Content-Type on an unmatched, byte-identical response", async () => {
    const app = buildApp(fetchReturning(SEARCH_FIXTURE, { contentType: "application/json;api-version=3.0-preview.1" }));
    const res = await request(app)
      .post("/vscode/gallery/extensionquery")
      .send(searchQuery("python-linting"));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/json;api-version=3.0-preview.1");
    expect(res.text).toBe(SEARCH_FIXTURE);
  });

  it("falls back to application/json when upstream sends no Content-Type header", async () => {
    const app = buildApp(fetchReturning(BY_ID_FIXTURE, { contentType: null }));
    const res = await request(app)
      .post("/vscode/gallery/extensionquery")
      .send(idQuery("GitLab.gitlab-workflow"));

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.text).toBe(BY_ID_FIXTURE);
  });
});

// Regression: express.json() used to force-parse every POST body; malformed
// or oversized bodies threw inside body-parser and fell into the generic
// error handler, returning 502 (a 5xx on the one route that must never
// 5xx). The route now reads the raw body itself and degrades instead.
describe("Regression: malformed or oversized client request body", () => {
  it("returns a valid 200 degraded-empty response for malformed client JSON, without calling upstream", async () => {
    let upstreamCalled = false;
    const fetchImpl: typeof fetch = (async () => {
      upstreamCalled = true;
      return new Response(BY_ID_FIXTURE, { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const app = buildApp(fetchImpl);

    const res = await request(app)
      .post("/vscode/gallery/extensionquery")
      .set("Content-Type", "application/json")
      .send("{this is not valid json");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      results: [
        {
          extensions: [],
          resultMetadata: [{ metadataType: "ResultCount", metadataItems: [{ name: "TotalCount", count: 0 }] }],
        },
      ],
    });
    expect(upstreamCalled).toBe(false);
  });

  it("returns a valid 200 degraded-empty response for a body over the 1 MB cap, without calling upstream", async () => {
    let upstreamCalled = false;
    const fetchImpl: typeof fetch = (async () => {
      upstreamCalled = true;
      return new Response(BY_ID_FIXTURE, { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    const app = buildApp(fetchImpl);

    const oversizedBody = JSON.stringify(idQuery(OUR_ID, undefined)).slice(0, -1) + `,"padding":"${"a".repeat(2 * 1024 * 1024)}"}`;
    expect(Buffer.byteLength(oversizedBody)).toBeGreaterThan(1024 * 1024);

    const res = await request(app)
      .post("/vscode/gallery/extensionquery")
      .set("Content-Type", "application/json")
      .send(oversizedBody);

    expect(res.status).toBe(200);
    expect(res.body.results[0].extensions).toHaveLength(0);
    expect(res.body.results[0].resultMetadata[0].metadataItems[0].count).toBe(0);
    expect(upstreamCalled).toBe(false);
  });

  it("still handles a normal, well-formed body correctly (no regression on the happy path)", async () => {
    const app = buildApp(jsonFetch(BY_ID_FIXTURE));
    const res = await request(app).post("/vscode/gallery/extensionquery").send(idQuery(OUR_ID));

    expect(res.status).toBe(200);
    expect(res.body.results[0].extensions[0].extensionName).toBe("werknario-webide-agent");
  });
});
