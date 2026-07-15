/**
 * Message and tool shapes for the agent loop. This is a deliberately small subset
 * of the Anthropic Messages API — enough to drive tool-use turns, no more. The
 * proxy speaks this shape on the wire; the mock provider returns it verbatim.
 */

export type Role = "user" | "assistant";

export interface TextBlock {
  type: "text";
  text: string;
}

export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: "tool_result";
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface Message {
  role: Role;
  /** A plain string is shorthand for a single text block. */
  content: string | ContentBlock[];
}

export type StopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "stop_sequence"
  | (string & {});

/** What the proxy returns for one model turn. */
export interface LlmResponse {
  id?: string;
  role: "assistant";
  content: ContentBlock[];
  stop_reason: StopReason;
  model?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** What the extension sends to the proxy for one model turn. */
export interface LlmRequest {
  model?: string;
  system?: string;
  messages: Message[];
  tools?: ToolDefinition[];
  max_tokens?: number;
}

export function isTextBlock(b: ContentBlock): b is TextBlock {
  return b.type === "text";
}

export function isToolUseBlock(b: ContentBlock): b is ToolUseBlock {
  return b.type === "tool_use";
}

export function isToolResultBlock(b: ContentBlock): b is ToolResultBlock {
  return b.type === "tool_result";
}
