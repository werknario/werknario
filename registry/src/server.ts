import { existsSync } from "node:fs";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";

const config = loadConfig();

if (!existsSync(config.extStore)) {
  throw new Error(`EXT_STORE directory not found: ${config.extStore}`);
}

const app = createApp({
  publicBaseUrl: config.publicBaseUrl,
  upstreamUrl: config.upstreamUrl,
  extStore: config.extStore,
  fetchImpl: fetch,
});

// Loopback + container-only: Caddy is the only ingress, so binding 0.0.0.0
// inside the container is fine. No auth here on purpose — a gallery is
// public read-only.
app.listen(config.port, "0.0.0.0", () => {
  console.log(`[registry] listening on :${config.port} (upstream=${config.upstreamUrl})`);
});
