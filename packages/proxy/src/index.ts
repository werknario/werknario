// Public surface of the proxy package for other workspace packages (e.g. the CLI):
// the provider factory and config loader. The HTTP server stays in server.ts.
export { createProvider, type Provider } from "./providers/index.js";
export { createMockProvider } from "./providers/mock.js";
export {
  loadConfig,
  type ProxyConfig,
  type ProviderName,
} from "./config.js";
