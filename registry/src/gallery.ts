import {
  OUR_EXTENSION_ID,
  OUR_EXTENSION_NAME,
  OUR_FULL_ID,
  OUR_LAST_UPDATED,
  OUR_PUBLISHER,
  OUR_VERSION,
  OUR_VSIX_FILENAME,
} from "./identity.js";
import type { OurManifest } from "./manifest.js";

// --- The object we inject -----------------------------------------------

export interface OurExtension {
  extensionId: string;
  extensionName: string;
  displayName: string;
  shortDescription: string;
  publisher: {
    displayName: string;
    publisherId: string;
    publisherName: string;
    domain: null;
    isDomainVerified: boolean;
  };
  versions: Array<{
    version: string;
    lastUpdated: string;
    assetUri: string;
    fallbackAssetUri: string;
    targetPlatform: string;
    files: Array<{ assetType: string; source: string }>;
    properties: Array<{ key: string; value: string }>;
  }>;
  statistics: unknown[];
  tags: unknown[];
  categories: string[];
  flags: string;
}

/** Builds the extension object we inject into gallery query results. Shape
 * mirrors test/fixtures/openvsx-query-by-id.json's results[0].extensions[0],
 * trimmed to exactly what SPEC.md's "Our extension object" section spells
 * out — real open-vsx entries carry more fields (releaseDate, a License
 * asset, ...) that the spec deliberately leaves out. */
export function buildOurExtension(publicBaseUrl: string, manifest: OurManifest): OurExtension {
  const fileUrl = (filename: string): string =>
    `${publicBaseUrl}/api/${OUR_PUBLISHER}/${OUR_EXTENSION_NAME}/${OUR_VERSION}/file/${filename}`;
  const assetBase = `${publicBaseUrl}/vscode/asset/${OUR_PUBLISHER}/${OUR_EXTENSION_NAME}/${OUR_VERSION}`;

  return {
    extensionId: OUR_EXTENSION_ID,
    extensionName: OUR_EXTENSION_NAME,
    displayName: manifest.displayName,
    shortDescription: manifest.description,
    publisher: {
      displayName: "X-Concapps",
      publisherId: "xconcapps",
      publisherName: "xconcapps",
      domain: null,
      isDomainVerified: false,
    },
    versions: [
      {
        version: OUR_VERSION,
        lastUpdated: OUR_LAST_UPDATED,
        assetUri: assetBase,
        fallbackAssetUri: assetBase,
        targetPlatform: "web",
        files: [
          { assetType: "Microsoft.VisualStudio.Code.Manifest", source: fileUrl("package.json") },
          { assetType: "Microsoft.VisualStudio.Services.Content.Details", source: fileUrl("readme.md") },
          {
            assetType: "Microsoft.VisualStudio.Services.VsixManifest",
            source: fileUrl("extension.vsixmanifest"),
          },
          {
            assetType: "Microsoft.VisualStudio.Services.VSIXPackage",
            source: fileUrl(OUR_VSIX_FILENAME),
          },
        ],
        properties: [
          { key: "Microsoft.VisualStudio.Code.Engine", value: manifest.engineVscode },
          { key: "Microsoft.VisualStudio.Code.ExtensionKind", value: "web" },
        ],
      },
    ],
    statistics: [],
    tags: [],
    categories: ["Other"],
    flags: "validated, public",
  };
}

// --- Asset filename mapping (route 2 / route 4) --------------------------

/** Maps an assetType query param to the file we serve for it. Undefined
 * means "we don't have this asset" (e.g. Icons.Default — no icon shipped). */
export function ourAssetFilename(assetType: string): string | undefined {
  switch (assetType) {
    case "Microsoft.VisualStudio.Code.Manifest":
      return "package.json";
    case "Microsoft.VisualStudio.Services.VsixManifest":
      return "extension.vsixmanifest";
    case "Microsoft.VisualStudio.Services.VSIXPackage":
      return OUR_VSIX_FILENAME;
    case "Microsoft.VisualStudio.Services.Content.Details":
      return "readme.md";
    default:
      return undefined;
  }
}

// --- Query matching --------------------------------------------------------

interface GalleryCriterion {
  filterType?: number;
  value?: string;
}

interface GalleryFilterGroup {
  criteria?: GalleryCriterion[];
  pageNumber?: number;
}

interface GalleryQueryBody {
  filters?: GalleryFilterGroup[];
}

const SEARCH_KEYWORDS = ["ki", "agent", "merge request", "substrat"];

function asFilterGroups(body: unknown): GalleryFilterGroup[] {
  if (typeof body !== "object" || body === null) return [];
  const filters = (body as GalleryQueryBody).filters;
  return Array.isArray(filters) ? filters : [];
}

function isFirstPage(group: GalleryFilterGroup): boolean {
  return group.pageNumber === undefined || group.pageNumber === 1;
}

function matchesSearchValue(rawValue: string, displayNameLower: string): boolean {
  const value = rawValue.toLowerCase().trim();
  if (value === "") return false;

  const haystacks = [OUR_FULL_ID.toLowerCase(), "werknario", "fleetlicht", displayNameLower];
  if (haystacks.some((haystack) => haystack.includes(value))) return true;

  return SEARCH_KEYWORDS.includes(value);
}

function matchesCriterion(criterion: GalleryCriterion, displayNameLower: string): boolean {
  if (typeof criterion.value !== "string") return false;

  if (criterion.filterType === 7) {
    return criterion.value.toLowerCase() === OUR_FULL_ID.toLowerCase();
  }
  if (criterion.filterType === 10) {
    return matchesSearchValue(criterion.value, displayNameLower);
  }
  return false;
}

/** Decides whether our extension belongs in this query's results — by id
 * (filterType 7) or by search text (filterType 10), first page only. */
export function matchesOurExtensionQuery(body: unknown, displayName: string): boolean {
  const displayNameLower = displayName.toLowerCase();
  const groups = asFilterGroups(body);
  return groups.some(
    (group) => isFirstPage(group) && (group.criteria ?? []).some((c) => matchesCriterion(c, displayNameLower))
  );
}

// --- Response injection / degradation --------------------------------------

interface GalleryResultMetadataItem {
  name?: string;
  count?: number;
}

interface GalleryResultMetadata {
  metadataType?: string;
  metadataItems?: GalleryResultMetadataItem[];
}

interface GalleryResult {
  extensions?: unknown[];
  resultMetadata?: GalleryResultMetadata[];
  [key: string]: unknown;
}

export interface GalleryResponseBody {
  results?: GalleryResult[];
  [key: string]: unknown;
}

/** True for a JSON object (not null, not an array) — the only shape it's
 * safe to spread/index into as a gallery response envelope. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Prepends `ourExtension` to results[0].extensions and bumps the
 * ResultCount/TotalCount metadata by one (creating it if absent). Everything
 * else on the upstream body passes through untouched.
 *
 * `body` is `unknown`, not `GalleryResponseBody`, on purpose: upstream is
 * someone else's server, and valid JSON includes `null`, arrays, and
 * primitives — none of which have a `.results` to dereference. Falling back
 * to an empty envelope for anything that isn't a plain object means this
 * function can never throw on attacker- or upstream-controlled input, even
 * if a caller forgets to pre-validate (defense in depth alongside the
 * explicit check in app.ts). */
export function injectIntoResponse(body: unknown, ourExtension: OurExtension): GalleryResponseBody {
  const safeBody: GalleryResponseBody = isRecord(body) ? body : {};
  const results = Array.isArray(safeBody.results) ? safeBody.results : [];
  const first: GalleryResult = results[0] ?? {};
  const extensions = Array.isArray(first.extensions) ? first.extensions : [];
  const resultMetadata = Array.isArray(first.resultMetadata) ? [...first.resultMetadata] : [];

  let resultCount = resultMetadata.find((m) => m.metadataType === "ResultCount");
  if (!resultCount) {
    resultCount = { metadataType: "ResultCount", metadataItems: [] };
    resultMetadata.push(resultCount);
  }
  const metadataItems = Array.isArray(resultCount.metadataItems) ? resultCount.metadataItems : [];
  let totalCount = metadataItems.find((item) => item.name === "TotalCount");
  if (!totalCount) {
    totalCount = { name: "TotalCount", count: 0 };
    metadataItems.push(totalCount);
  }
  totalCount.count = (totalCount.count ?? 0) + 1;
  resultCount.metadataItems = metadataItems;

  const newFirst: GalleryResult = {
    ...first,
    extensions: [ourExtension, ...extensions],
    resultMetadata,
  };

  return { ...safeBody, results: [newFirst, ...results.slice(1)] };
}

/** The response we return whenever we can't safely relay upstream: the call
 * failed or timed out, upstream answered with a non-2xx status, upstream's
 * body wasn't a valid JSON object, or the client's own request body was
 * unparseable/oversized. Always valid, always 200 — never blank the
 * Extensions view. */
export function degradedResponse(ourExtension: OurExtension | undefined): GalleryResponseBody {
  return {
    results: [
      {
        extensions: ourExtension ? [ourExtension] : [],
        resultMetadata: [
          {
            metadataType: "ResultCount",
            metadataItems: [{ name: "TotalCount", count: ourExtension ? 1 : 0 }],
          },
        ],
      },
    ],
  };
}
