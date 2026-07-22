import { checkRunResidency } from "@werknario/shared";
import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createProvider } from "./providers/index.js";

const config = loadConfig();

// Enforce EU data residency at the proxy too, not only in the CLI. The proxy
// forwards to whatever provider it was started with, so a non-EU route is
// refused at boot unless WERKNARIO_ALLOW_NON_EU is set (logged, not silent).
const allowNonEu = /^(1|true|yes)$/i.test(process.env.WERKNARIO_ALLOW_NON_EU ?? "");
const residency = checkRunResidency(config.provider, config.model, {
  region: config.bedrock.region,
  allowNonEu,
});
if (!residency.ok) {
  console.error(`[proxy] blocked: ${residency.reason}`);
  process.exit(1);
}
if (residency.overridden) {
  console.warn(`[proxy] WARNING: ${residency.reason}`);
}

const provider = createProvider(config);

const app = createApp({
  provider,
  providerName: config.provider,
  model: config.model,
  bearerToken: config.bearerToken,
  allowedOrigins: config.allowedOrigins,
});

app.listen(config.port, () => {
  // Never log the bearer token or any API key.
  console.log(`[proxy] listening on :${config.port} (provider=${config.provider}, model=${config.model})`);
});
