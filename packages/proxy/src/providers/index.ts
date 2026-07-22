import type { LlmRequest, LlmResponse } from "@werknario/shared";
import type { ProxyConfig } from "../config.js";
import { createAnthropicProvider } from "./anthropic.js";
import { createBedrockProvider } from "./bedrock.js";
import { createMockProvider } from "./mock.js";
import { createOpenAiCompatibleProvider } from "./openai-compatible.js";

/** One model turn in, one model turn out. No agent-loop state lives here. */
export interface Provider {
  createMessage(req: LlmRequest): Promise<LlmResponse>;
}

/**
 * Builds the provider named by config.provider. Only the anthropic/bedrock SDK
 * that is actually needed gets touched — picking "mock" or "anthropic" never
 * requires the bedrock SDK to be installed.
 */
export function createProvider(config: ProxyConfig): Provider {
  switch (config.provider) {
    case "mock":
      return createMockProvider();
    case "anthropic":
      return createAnthropicProvider(config);
    case "bedrock":
      return createBedrockProvider(config);
    case "openai-compatible":
      return createOpenAiCompatibleProvider(config);
    default: {
      const exhaustive: never = config.provider;
      throw new Error(`Unknown LLM_PROVIDER: ${String(exhaustive)}`);
    }
  }
}
