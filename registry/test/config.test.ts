import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("throws when PUBLIC_BASE_URL is missing", () => {
    expect(() => loadConfig({ EXT_STORE: "/opt/store" } as NodeJS.ProcessEnv)).toThrow(/PUBLIC_BASE_URL/);
  });

  it("throws when EXT_STORE is missing", () => {
    expect(() =>
      loadConfig({ PUBLIC_BASE_URL: "https://vsx.example.test" } as NodeJS.ProcessEnv)
    ).toThrow(/EXT_STORE/);
  });

  it("strips trailing slashes and defaults UPSTREAM_URL to open-vsx.org", () => {
    const config = loadConfig({
      PUBLIC_BASE_URL: "https://vsx.example.test/",
      EXT_STORE: "/opt/store",
    } as NodeJS.ProcessEnv);

    expect(config.publicBaseUrl).toBe("https://vsx.example.test");
    expect(config.upstreamUrl).toBe("https://open-vsx.org");
    expect(config.port).toBe(8080);
  });

  it("reads PORT and UPSTREAM_URL when provided", () => {
    const config = loadConfig({
      PUBLIC_BASE_URL: "https://vsx.example.test",
      EXT_STORE: "/opt/store",
      PORT: "9200",
      UPSTREAM_URL: "https://open-vsx.example.test/",
    } as NodeJS.ProcessEnv);

    expect(config.port).toBe(9200);
    expect(config.upstreamUrl).toBe("https://open-vsx.example.test");
  });
});
