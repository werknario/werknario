import type { ContentBlock, LlmRequest, LlmResponse } from "@werknario/shared";
import type { ProxyConfig } from "../config.js";
import type { Provider } from "./index.js";

// Production werknario must run the bedrock provider (EU inference profile) —
// see werknario CLAUDE.md tech-stack table, "LLM" row. anthropic.ts (direct
// API) is only for environments explicitly allowed to bypass that.

// "@anthropic-ai/bedrock-sdk" is an optional dependency: it is not in this
// package's package.json, so packages/proxy must keep working with
// LLM_PROVIDER=mock|anthropic even when it is not installed. The specifier is
// read from a variable (not a string literal) so TypeScript treats the
// import() as untyped/dynamic and does not try to resolve module types for it
// at build time; resolution only happens at runtime, the first time bedrock
// is actually used.
const BEDROCK_SDK_MODULE = "@anthropic-ai/bedrock-sdk";

interface BedrockClient {
  messages: {
    create(params: Record<string, unknown>): Promise<{
      id?: string;
      content: unknown;
      stop_reason?: string | null;
      model?: string;
    }>;
  };
}

async function loadBedrockClient(config: ProxyConfig): Promise<BedrockClient> {
  let sdk: Record<string, unknown>;
  try {
    sdk = await import(BEDROCK_SDK_MODULE);
  } catch {
    throw new Error(
      `LLM_PROVIDER=bedrock requires the optional "${BEDROCK_SDK_MODULE}" package, which is not installed. ` +
        "Add it to packages/proxy/package.json and npm install to use bedrock."
    );
  }

  // The exact export name is not verifiable offline (package isn't installed
  // in this workspace); accept either the documented name or a default export
  // so this keeps working regardless.
  const ClientCtor =
    (sdk.AnthropicBedrockMantle as new (opts: Record<string, unknown>) => BedrockClient) ??
    (sdk.AnthropicBedrock as new (opts: Record<string, unknown>) => BedrockClient) ??
    (sdk.default as new (opts: Record<string, unknown>) => BedrockClient);

  if (!ClientCtor) {
    throw new Error(
      `LLM_PROVIDER=bedrock: could not find a usable client export in "${BEDROCK_SDK_MODULE}".`
    );
  }

  return new ClientCtor({ awsRegion: config.bedrock.region });
}

function toModelId(model: string): string {
  return model.startsWith("anthropic.") || model.startsWith("eu.anthropic.")
    ? model
    : `anthropic.${model}`;
}

/** Anthropic via AWS Bedrock, EU inference profile — the werknario default. */
export function createBedrockProvider(config: ProxyConfig): Provider {
  return {
    async createMessage(req: LlmRequest): Promise<LlmResponse> {
      const client = await loadBedrockClient(config);

      const response = await client.messages.create({
        model: toModelId(req.model || config.model),
        max_tokens: req.max_tokens || 8192,
        system: req.system,
        messages: req.messages,
        tools: req.tools,
        thinking: { type: "disabled" },
      });

      return {
        id: response.id,
        role: "assistant",
        content: response.content as ContentBlock[],
        stop_reason: response.stop_reason ?? "end_turn",
        model: response.model,
      };
    },
  };
}
