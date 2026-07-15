import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlock, LlmRequest, LlmResponse } from "@werknario/shared";
import type { ProxyConfig } from "../config.js";
import type { Provider } from "./index.js";

/**
 * Anthropic API directly. Only for environments explicitly allowed to bypass
 * the werknario default (production must go through bedrock — see bedrock.ts).
 */
export function createAnthropicProvider(config: ProxyConfig): Provider {
  const client = new Anthropic({ apiKey: config.anthropic.apiKey });

  return {
    async createMessage(req: LlmRequest): Promise<LlmResponse> {
      // claude-sonnet-5 rejects temperature/top_p/top_k and budget_tokens on
      // this call shape — do not add them here.
      const response = await client.messages.create({
        model: req.model || config.model,
        max_tokens: req.max_tokens || 8192,
        system: req.system,
        messages: req.messages as Anthropic.MessageParam[],
        tools: req.tools as Anthropic.Tool[] | undefined,
        thinking: { type: "disabled" },
      });

      return {
        id: response.id,
        role: "assistant",
        content: response.content as unknown as ContentBlock[],
        stop_reason: response.stop_reason ?? "end_turn",
        model: response.model,
      };
    },
  };
}
