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
        // Prompt caching: the system prompt is large and identical across turns.
        // A cache_control breakpoint on it caches system (and the tools listed
        // before it) — a cache read costs 10% of the input base price.
        system: cachedSystem(req.system),
        messages: req.messages as Anthropic.MessageParam[],
        tools: req.tools as Anthropic.Tool[] | undefined,
        thinking: { type: "disabled" },
      });

      const u = response.usage;
      return {
        id: response.id,
        role: "assistant",
        content: response.content as unknown as ContentBlock[],
        stop_reason: response.stop_reason ?? "end_turn",
        model: response.model,
        usage: u
          ? {
              input_tokens: u.input_tokens ?? 0,
              output_tokens: u.output_tokens ?? 0,
              cache_creation_input_tokens: u.cache_creation_input_tokens ?? undefined,
              cache_read_input_tokens: u.cache_read_input_tokens ?? undefined,
            }
          : undefined,
      };
    },
  };
}

/**
 * Wrap the system prompt as a cached text block. Returns undefined for an empty
 * system so the request shape is unchanged when there is nothing to cache.
 */
function cachedSystem(
  system: string | undefined,
): Anthropic.TextBlockParam[] | undefined {
  if (!system) return undefined;
  return [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
}
