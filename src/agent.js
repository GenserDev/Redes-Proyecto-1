// Conversation history (requirement #2) and the MCP tool-calling loop
// (requirement #4).

import { config } from "./config.js";
import { chat } from "./llm.js";

const SYSTEM_PROMPT = [
  "You are an assistant running inside a terminal chatbot that acts as an MCP host.",
  "You have access to tools provided by MCP servers; their names are prefixed",
  "with the server they belong to, for example filesystem__read_text_file.",
  "Use a tool whenever the answer depends on the real state of the system, and",
  "report what the tool returned rather than guessing.",
  "If a tool reports an error, say so and explain it; never claim an operation",
  "succeeded when the tool that performed it failed.",
  "Paths given to the filesystem and git tools are relative to the workspace",
  "directory those servers are configured with.",
  "Answer in the language the user writes in.",
  "Be concise and direct; use plain text, since the output is a terminal.",
].join(" ");

const MAX_TOOL_ROUNDS = 8;

export class Agent {
  constructor({ manager = null, onToolEvent = () => {} } = {}) {
    this.manager = manager;
    this.onToolEvent = onToolEvent;
    this.messages = [{ role: "system", content: SYSTEM_PROMPT }];
  }

  async send(text) {
    this.messages.push({ role: "user", content: text });

    const tools = this.manager ? this.manager.listTools() : [];
    let lastReasoning = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const reply = await chat({ messages: this.messages, tools });

      if (reply.toolCalls.length === 0) {
        if (reply.text.trim() !== "") {
          this.messages.push({ role: "assistant", content: reply.text });
          this.trimHistory();
          return reply.text;
        }

        // A reasoning model can produce a turn that only thinks: no answer and
        // no tool call. That is an unfinished turn, not a reply, so the request
        // is simply made again rather than showing the user its notes.
        lastReasoning = reply.reasoning || lastReasoning;
        continue;
      }

      // The turn that requested the tools has to stay in the history, because
      // providers reject a tool result that does not follow its own request.
      // `raw` carries the provider's original message so nothing is lost.
      this.messages.push({
        role: "assistant",
        content: reply.text,
        toolCalls: reply.toolCalls,
        raw: reply.raw,
      });

      await this.runToolCalls(reply.toolCalls);
    }

    const message = lastReasoning
      ? `Stopped after ${MAX_TOOL_ROUNDS} rounds without a final answer. The model was still working on: ${lastReasoning}`
      : `Stopped after ${MAX_TOOL_ROUNDS} tool rounds without a final answer.`;

    this.messages.push({ role: "assistant", content: message });
    return message;
  }

  async runToolCalls(toolCalls) {
    for (const call of toolCalls) {
      this.onToolEvent({ phase: "start", name: call.name, args: call.arguments });

      const result = this.manager
        ? await this.manager.callTool(call.name, call.arguments)
        : { text: `No MCP server is connected, cannot run ${call.name}`, isError: true };

      this.onToolEvent({
        phase: "end",
        name: call.name,
        isError: result.isError,
        text: result.text,
      });

      this.messages.push({
        role: "tool",
        toolCallId: call.id,
        name: call.name,
        content: result.text,
      });
    }
  }

  trimHistory() {
    const limit = config.maxHistoryMessages;
    if (this.messages.length <= limit) return;

    // The system prompt is always kept: losing it would change the behaviour
    // of the assistant mid-session.
    const [system, ...rest] = this.messages;
    let kept = rest.slice(-(limit - 1));

    // A tool result whose matching request was just trimmed away would be
    // rejected by the provider, so leading orphans are dropped as well.
    while (kept.length > 0 && kept[0].role === "tool") {
      kept = kept.slice(1);
    }

    this.messages = [system, ...kept];
  }

  reset() {
    this.messages = [this.messages[0]];
  }

  historySize() {
    return this.messages.length - 1;
  }
}
