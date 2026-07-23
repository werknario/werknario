import {
  isToolResultBlock,
  isToolUseBlock,
  type ContentBlock,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
  type Message,
} from "@werknario/shared";
import type { Provider } from "./index.js";

const DEFAULT_PATH =
  "mock-substrate-musik/vertraege/session-notiz_landgang_2026-05-30.md";

const SPLIT_SHEET_PATH =
  "mock-substrate-musik/vertraege/split-sheet_landgang_ENTWURF.md";

const SPLIT_SHEET_CONTENT =
  "# Split Sheet — Landgang (ENTWURF)\n\n" +
  "(automatisch aus der Session-Notiz abgeleitet)\n\n" +
  "| Beteiligte | Rolle | Anteil |\n" +
  "|---|---|---|\n" +
  "| … | … | ANTEIL OFFEN |\n";

// Second scripted path for the launch demo: at the merge-request step the agent
// cites a file it never read, so the grounding gate refuses the merge request
// before a human sees it. Triggered by a marker phrase in the task text so the
// happy path stays the default. See docs/launch/demo-script.md.
const FABRICATED_DEMO_RE = /fabricated citation|erfundenes zitat|erfundener beleg/i;

function blocksOf(message: Message): ContentBlock[] {
  return typeof message.content === "string"
    ? [{ type: "text", text: message.content }]
    : message.content;
}

/** Plain-text content of the last user message that actually contains text. */
function lastUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (!message || message.role !== "user") continue;
    const text = blocksOf(message)
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
    if (text !== "") return text;
  }
  return "";
}

/** Whether the task asks for the fabricated-citation demo variant. */
function wantsFabricatedDemo(messages: Message[]): boolean {
  return FABRICATED_DEMO_RE.test(lastUserText(messages));
}

/** Last whitespace-separated token in `text` that looks like a file path. */
function extractPath(text: string): string {
  const tokens = text.split(/\s+/);
  for (let i = tokens.length - 1; i >= 0; i--) {
    const raw = tokens[i];
    if (!raw) continue;
    const token = raw.replace(/[.,;:!?)]+$/, "");
    if (token.includes("/") || /\.[A-Za-z0-9]{1,5}$/.test(token)) {
      return token;
    }
  }
  return DEFAULT_PATH;
}

/** How many tool_use blocks have already been emitted in this conversation. */
function toolUseCount(messages: Message[]): number {
  let count = 0;
  for (const message of messages) {
    for (const block of blocksOf(message)) {
      if (isToolUseBlock(block)) count += 1;
    }
  }
  return count;
}

/** Whether a tool_result exists whose tool_use_id was minted for `toolName`. */
function hasResultFor(messages: Message[], toolName: string): boolean {
  for (const message of messages) {
    for (const block of blocksOf(message)) {
      if (isToolResultBlock(block) && block.tool_use_id.includes(toolName)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Deterministic token usage per turn, so the token account can be exercised
 * offline. Turn 0 writes the system prompt into the cache; later turns read it
 * back (mirrors what prompt caching does in the real providers). No randomness.
 */
function mockUsage(messages: Message[]): LlmUsage {
  const n = toolUseCount(messages);
  return {
    input_tokens: 1000 + n * 200,
    output_tokens: 120,
    cache_creation_input_tokens: n === 0 ? 800 : 0,
    cache_read_input_tokens: n === 0 ? 0 : 800,
  };
}

type Stage = "read_file" | "propose_edit" | "create_merge_request" | "done";

function nextStage(messages: Message[]): Stage {
  if (!hasResultFor(messages, "read_file")) return "read_file";
  if (!hasResultFor(messages, "propose_edit")) return "propose_edit";
  if (!hasResultFor(messages, "create_merge_request")) return "create_merge_request";
  return "done";
}

/**
 * Deterministic "flagship brain" for tests and offline dev. It never calls a
 * network; it inspects the message history the agent loop resends every turn
 * and returns whatever the next scripted step is. No Math.random/Date.now —
 * ids are derived from how many tool_use blocks already exist.
 */
export function createMockProvider(): Provider {
  return {
    async createMessage(req: LlmRequest): Promise<LlmResponse> {
      const stage = nextStage(req.messages);
      const n = toolUseCount(req.messages) + 1;
      const usage = mockUsage(req.messages);
      const fabricated = wantsFabricatedDemo(req.messages);

      if (stage === "read_file") {
        const path = extractPath(lastUserText(req.messages));
        return {
          role: "assistant",
          content: [
            { type: "text", text: "Ich lese zuerst die Notiz." },
            {
              type: "tool_use",
              id: `mock_read_file_${n}`,
              name: "read_file",
              input: { path },
            },
          ],
          stop_reason: "tool_use",
          usage,
        };
      }

      if (stage === "propose_edit") {
        return {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: `mock_propose_edit_${n}`,
              name: "propose_edit",
              input: {
                path: SPLIT_SHEET_PATH,
                content: SPLIT_SHEET_CONTENT,
                summary: "Split-Sheet-Entwurf aus der Session-Notiz",
              },
            },
          ],
          stop_reason: "tool_use",
          usage,
        };
      }

      if (stage === "create_merge_request") {
        return {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: `mock_create_merge_request_${n}`,
              name: "create_merge_request",
              input: {
                title: "Split Sheet Landgang (Entwurf)",
                description: fabricated
                  ? "Automatisch aus session-notiz_landgang_2026-05-30.md abgeleitet. " +
                    "Beteiligung 50/50 laut [Beleg: vertraege/fees.csv:L12]. Bitte Anteile prüfen."
                  : "Automatisch aus session-notiz_landgang_2026-05-30.md abgeleitet. Bitte Anteile prüfen.",
                source_branch: "split/landgang-entwurf-mock",
              },
            },
          ],
          stop_reason: "tool_use",
          usage,
        };
      }

      return {
        role: "assistant",
        content: [
          {
            type: "text",
            text: fabricated
              ? "MR refused: fabricated citation. Die Beschreibung belegte vertraege/fees.csv, " +
                "aber diese Datei wurde in dieser Sitzung nie gelesen. Das Grounding-Gate hat den " +
                "Merge Request abgewiesen, bevor ein Mensch ihn gesehen hat."
              : "Entwurf vorgelegt und Merge Request geöffnet. Bitte die offenen Anteile prüfen.",
          },
        ],
        stop_reason: "end_turn",
        usage,
      };
    },
  };
}
