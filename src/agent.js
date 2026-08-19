/**
 * Conversation agent (project requirements #2 and #4).
 *
 * Owns the message history for one chat session so follow-up questions resolve
 * against what was said earlier: asking "Who was Alan Turing?" and then "When
 * was he born?" works because both messages are sent to the model together.
 *
 * It also runs the tool-calling loop. The model never touches an MCP server
 * itself: it asks for a tool by name, this class forwards the call through the
 * MCP manager, feeds the result back into the conversation, and asks the model
 * again. The loop ends when the model answers with plain text instead of
 * another tool request.
 */

import { config } from "./config.js";
import { chat } from "./llm.js";

const SYSTEM_PROMPT = [
  "You are an assistant running inside a terminal chatbot that acts as an MCP host.",
  "You have access to tools provided by MCP servers; their names are prefixed",
  "with the server they belong to, for example filesystem__read_text_file.",
  "Use a tool whenever the answer depends on the real state of the system, and",
  "report what the tool returned rather than guessing.",
  "Answer in the language the user writes in.",
  "Be concise and direct; use plain text, since the output is a terminal.",
].join(" ");

/** Safety valve: how many tool rounds a single user message may trigger. */
const MAX_TOOL_ROUNDS = 8;

export class Agent {
  /**
   * @param {object} [options]
   * @param {import("./mcp/manager.js").McpManager} [options.manager] Tool source.
   * @param {(event: object) => void} [options.onToolEvent] UI hook for progress.
   */
  constructor({ manager = null, onToolEvent = () => {} } = {}) {
    this.manager = manager;
    this.onToolEvent = onToolEvent;

    /** @type {Array<object>} Conversation in the neutral message shape. */
    this.messages = [{ role: "system", content: SYSTEM_PROMPT }];
  }

  /**
   * Sends a user message and returns the assistant reply, running any tools
   * the model asks for along the way.
   *
   * @param {string} text
   * @returns {Promise<string>}
   */
  async send(text) {
    this.messages.push({ role: "user", content: text });

    const tools = this.manager ? this.manager.listTools() : [];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
      const reply = await chat({ messages: this.messages, tools });

      if (reply.toolCalls.length === 0) {
        this.messages.push({ role: "assistant", content: reply.text });
        this.trimHistory();
        return reply.text;
      }

      // The assistant turn that requested the tools has to stay in the history:
      // providers reject a tool result that does not follow its own request.
      this.messages.push({
        role: "assistant",
        content: reply.text,
        toolCalls: reply.toolCalls,
      });

      await this.runToolCalls(reply.toolCalls);
    }

    const message = `Stopped after ${MAX_TOOL_ROUNDS} tool rounds without a final answer.`;
    this.messages.push({ role: "assistant", content: message });
    return message;
  }

  /**
   * Executes every tool the model requested and appends the results.
   *
   * @param {Array<object>} toolCalls
   * @returns {Promise<void>}
   */
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

  /**
   * Drops the oldest exchanges once the history grows past the configured
   * limit. The system prompt is always kept, since losing it would change the
   * behaviour of the assistant mid-session.
   */
  trimHistory() {
    const limit = config.maxHistoryMessages;
    if (this.messages.length <= limit) return;

    const [system, ...rest] = this.messages;
    let kept = rest.slice(-(limit - 1));

    // A tool result whose matching request was just trimmed away would be
    // rejected by the provider, so leading orphans are dropped as well.
    while (kept.length > 0 && kept[0].role === "tool") {
      kept = kept.slice(1);
    }

    this.messages = [system, ...kept];
  }

  /** Forgets the conversation, keeping the system prompt. */
  reset() {
    this.messages = [this.messages[0]];
  }

  /** @returns {number} Conversation messages excluding the system prompt. */
  historySize() {
    return this.messages.length - 1;
  }
}
