// Promptfoo custom provider for werknario. It uses the REAL production code —
// buildSystemPrompt() + TOOL_DEFINITIONS from @werknario/shared and the same
// provider factory as the CLI — so a change to the system prompt or the tools is
// tested here automatically, not against a re-typed copy.
//
// Each Promptfoo test supplies vars: `task` (the user's task) and optionally
// `reads` (a JSON map of path -> file content the agent has "read"). The provider
// builds the mid-conversation state and asks the configured model for its next
// turn. Assertions then check the response.
//
// Model comes from the environment (LLM_PROVIDER + key), same as the CLI. The
// mock provider ignores the prompt, so behaviour tests need a real model.

import { buildScenarioRequest, textOf, toolCallsOf } from "@werknario/shared";
import { createProvider, loadConfig } from "@werknario/proxy";

const provider = createProvider(loadConfig(process.env));

export default class WerknarioAgentProvider {
  id() {
    return "werknario-agent";
  }

  async callApi(_prompt, context) {
    const vars = (context && context.vars) || {};
    const scenario = {
      task: String(vars.task ?? ""),
      reads: vars.reads ? JSON.parse(String(vars.reads)) : {},
      locale: vars.locale ? String(vars.locale) : "en",
    };
    const response = await provider.createMessage(buildScenarioRequest(scenario));
    return {
      output: textOf(response),
      metadata: {
        toolCalls: toolCallsOf(response),
        stopReason: response.stop_reason,
      },
    };
  }
}
