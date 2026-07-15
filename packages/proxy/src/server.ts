import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createProvider } from "./providers/index.js";

const config = loadConfig();
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
