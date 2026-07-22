/**
 * Build a mid-conversation state for prompt-contract testing: the agent has been
 * given a task and has "read" some files (injected as synthetic read_file
 * tool-use / tool-result pairs), and now we ask a real model for its next turn.
 * A prompt/behaviour tester (Promptfoo) sends this to the configured model and
 * asserts on the response: does it cite, does it refuse to invent, does it treat
 * file text as content not commands, does it stay in voice.
 *
 * Pure and dependency-free (only our own types + the real system prompt), so it
 * is unit-tested here and the Promptfoo provider is a thin wrapper. Using the
 * real buildSystemPrompt/TOOL_DEFINITIONS means a prompt edit is tested, not a
 * re-typed copy.
 */

import { withLineNumbers } from "./grounding.js";
import { buildSystemPrompt } from "./prompt.js";
import { TOOL_DEFINITIONS } from "./tools.js";
import {
  isTextBlock,
  isToolUseBlock,
  type LlmRequest,
  type LlmResponse,
  type Message,
} from "./types.js";

export interface PromptScenario {
  /** The task, as a human would type it. */
  task: string;
  /** Files the agent has already read (path -> raw content), injected as read_file results. */
  reads?: Record<string, string>;
  locale?: "en" | "de";
  projectPath?: string;
  defaultBranch?: string;
}

/**
 * The message history for a scenario: the user task, then for each read a
 * synthetic read_file tool_use and its line-numbered tool_result — exactly what
 * the agent loop would have produced, so the model sees a realistic state.
 */
export function buildScenarioMessages(s: PromptScenario): Message[] {
  const messages: Message[] = [{ role: "user", content: s.task }];
  let i = 0;
  for (const [path, content] of Object.entries(s.reads ?? {})) {
    const id = `read_${i++}`;
    messages.push({
      role: "assistant",
      content: [{ type: "tool_use", id, name: "read_file", input: { path } }],
    });
    messages.push({
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: id,
          content: `Datei ${path}\n${withLineNumbers(content)}`,
        },
      ],
    });
  }
  return messages;
}

/** The full request for a scenario: real system prompt, the messages, the real tools. */
export function buildScenarioRequest(s: PromptScenario): LlmRequest {
  return {
    system: buildSystemPrompt({
      projectPath: s.projectPath ?? "prompt-eval/mock",
      defaultBranch: s.defaultBranch ?? "main",
      locale: s.locale ?? "en",
    }),
    messages: buildScenarioMessages(s),
    tools: TOOL_DEFINITIONS,
  };
}

export interface ScenarioToolCall {
  name: string;
  input: Record<string, unknown>;
}

/** Tool calls the model made in its response (for asserting on unauthorized writes). */
export function toolCallsOf(response: LlmResponse): ScenarioToolCall[] {
  return (response.content ?? [])
    .filter(isToolUseBlock)
    .map((b) => ({ name: b.name, input: b.input ?? {} }));
}

/** The assistant text of a response (for asserting on invented content / voice). */
export function textOf(response: LlmResponse): string {
  return (response.content ?? [])
    .filter(isTextBlock)
    .map((b) => b.text)
    .join("\n");
}
