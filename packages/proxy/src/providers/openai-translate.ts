/**
 * Übersetzung zwischen dem werknario-Wire-Format (eine kleine Teilmenge der
 * Anthropic Messages API) und der OpenAI-Chat-Completions-Form. Damit deckt EIN
 * generischer Provider Mistral, Kimi, DeepSeek, Qwen und jeden selbst gehosteten
 * vLLM/SGLang-Endpunkt ab — kein SDK pro Anbieter.
 *
 * Reine Funktionen, ohne Netz, voll testbar. Belege für die Formatunterschiede:
 * werknario/docs/research/2026-07-22-mehr-modelle-kimi-und-andere.md, Abschnitt 3.
 */

import {
  isTextBlock,
  isToolResultBlock,
  isToolUseBlock,
  type ContentBlock,
  type LlmResponse,
  type LlmUsage,
  type Message,
  type StopReason,
  type ToolDefinition,
} from "@werknario/shared";

export interface OpenAiToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAiMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

function blocksOf(message: Message): ContentBlock[] {
  return typeof message.content === "string"
    ? [{ type: "text", text: message.content }]
    : message.content;
}

function textOf(blocks: ContentBlock[]): string {
  return blocks
    .filter(isTextBlock)
    .map((b) => b.text)
    .join("\n");
}

/**
 * Baut die OpenAI-Nachrichtenliste. Ein Tool-Ergebnis, das im werknario-Format
 * ein Block innerhalb einer Nachricht ist, wird zu einer eigenen `role:"tool"`-
 * Nachricht — die OpenAI-Form kennt keinen Inline-Tool-Result-Block.
 */
export function toOpenAiMessages(
  system: string | undefined,
  messages: Message[],
): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  if (system) out.push({ role: "system", content: system });

  for (const message of messages) {
    const blocks = blocksOf(message);

    if (message.role === "assistant") {
      const toolCalls = blocks.filter(isToolUseBlock).map((b) => ({
        id: b.id,
        type: "function" as const,
        function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
      }));
      const text = textOf(blocks);
      const asst: OpenAiMessage = { role: "assistant", content: text || null };
      if (toolCalls.length > 0) asst.tool_calls = toolCalls;
      out.push(asst);
      continue;
    }

    // user turn: text becomes a user message, each tool_result its own tool msg.
    const toolResults = blocks.filter(isToolResultBlock);
    const text = textOf(blocks);
    if (text) out.push({ role: "user", content: text });
    for (const tr of toolResults) {
      out.push({ role: "tool", tool_call_id: tr.tool_use_id, content: tr.content });
    }
  }

  return out;
}

export interface OpenAiTool {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: ToolDefinition["input_schema"];
  };
}

export function toOpenAiTools(tools: ToolDefinition[]): OpenAiTool[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

export interface OpenAiResponseJson {
  id?: string;
  model?: string;
  choices?: Array<{
    finish_reason?: string;
    message?: {
      content?: string | null;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  };
}

function mapStop(finish: string | undefined): StopReason {
  switch (finish) {
    case "tool_calls":
      return "tool_use";
    case "stop":
      return "end_turn";
    case "length":
      return "max_tokens";
    default:
      return finish ?? "end_turn";
  }
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** OpenAI response → werknario LlmResponse. */
export function fromOpenAiResponse(json: OpenAiResponseJson): LlmResponse {
  const choice = json.choices?.[0];
  const message = choice?.message;
  const content: ContentBlock[] = [];

  if (typeof message?.content === "string" && message.content.length > 0) {
    content.push({ type: "text", text: message.content });
  }
  for (const tc of message?.tool_calls ?? []) {
    content.push({
      type: "tool_use",
      id: tc.id,
      name: tc.function.name,
      input: parseArgs(tc.function.arguments),
    });
  }

  const u = json.usage;
  const usage: LlmUsage | undefined = u
    ? {
        input_tokens: u.prompt_tokens ?? 0,
        output_tokens: u.completion_tokens ?? 0,
        // Diese Anbieter unterscheiden Cache-Schreiben/-Lesen meist nicht; ein
        // Cache-Treffer steht, wenn überhaupt, in prompt_tokens_details.
        cache_read_input_tokens: u.prompt_tokens_details?.cached_tokens,
      }
    : undefined;

  return {
    id: json.id,
    role: "assistant",
    content,
    stop_reason: mapStop(choice?.finish_reason),
    model: json.model,
    usage,
  };
}
