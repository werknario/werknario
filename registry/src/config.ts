import "dotenv/config";

export interface RegistryConfig {
  port: number;
  /** This service's own public origin, no trailing slash — used to build the
   * asset/file URLs we inject into gallery results. */
  publicBaseUrl: string;
  /** open-vsx base, no trailing slash. */
  upstreamUrl: string;
  /** Dir holding our extension's packaged files, see SPEC.md's EXT_STORE layout. */
  extStore: string;
}

function requireEnv(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required env var: ${key}`);
  }
  return value.trim();
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** Reads registry configuration from process.env. Throws if PUBLIC_BASE_URL
 * or EXT_STORE is missing — both are load-bearing for every route. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): RegistryConfig {
  const upstreamRaw = env.UPSTREAM_URL?.trim();
  return {
    port: env.PORT ? Number(env.PORT) : 8080,
    publicBaseUrl: stripTrailingSlash(requireEnv(env, "PUBLIC_BASE_URL")),
    upstreamUrl: stripTrailingSlash(upstreamRaw && upstreamRaw !== "" ? upstreamRaw : "https://open-vsx.org"),
    extStore: requireEnv(env, "EXT_STORE"),
  };
}
