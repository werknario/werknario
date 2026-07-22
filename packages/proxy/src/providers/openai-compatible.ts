import type { LlmRequest, LlmResponse } from "@werknario/shared";
import type { ProxyConfig } from "../config.js";
import type { Provider } from "./index.js";
import {
  fromOpenAiResponse,
  toOpenAiMessages,
  toOpenAiTools,
  type OpenAiResponseJson,
} from "./openai-translate.js";

/**
 * Ein generischer Provider für jeden OpenAI-kompatiblen Chat-Completions-Endpunkt:
 * Mistral (La Plateforme, EU), DeepSeek/Kimi/Qwen über einen EU-Hoster oder
 * Eigenbetrieb, oder ein lokaler vLLM/SGLang-Server. Base-URL, API-Key und Modell
 * kommen aus der Konfiguration. Datenresidenz ist eine Frage des base_url — die
 * Registry (models.ts) hält fest, welche Route EU-konform ist.
 */
export function createOpenAiCompatibleProvider(config: ProxyConfig): Provider {
  const { baseUrl, apiKey } = config.openaiCompatible;
  if (!baseUrl) {
    throw new Error(
      "LLM_PROVIDER=openai-compatible braucht LLM_OPENAI_COMPAT_BASE_URL (z. B. https://api.mistral.ai/v1).",
    );
  }
  const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

  return {
    async createMessage(req: LlmRequest): Promise<LlmResponse> {
      const body: Record<string, unknown> = {
        model: req.model || config.model,
        max_tokens: req.max_tokens || 8192,
        messages: toOpenAiMessages(req.system, req.messages),
      };
      if (req.tools && req.tools.length > 0) {
        body.tools = toOpenAiTools(req.tools);
        body.tool_choice = "auto";
      }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(
          `openai-compatible ${res.status} ${res.statusText}: ${detail.slice(0, 500)}`,
        );
      }

      return fromOpenAiResponse((await res.json()) as OpenAiResponseJson);
    },
  };
}
