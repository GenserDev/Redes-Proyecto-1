/**
 * Conversation agent (project requirement #2).
 *
 * Owns the message history for one chat session so follow-up questions resolve
 * against what was said earlier: asking "Who was Alan Turing?" and then "When
 * was he born?" works because both messages are sent to the model together.
 */

import { config } from "./config.js";
import { chat } from "./llm.js";

const SYSTEM_PROMPT = [
  "You are an assistant running inside a terminal chatbot that acts as an MCP host.",
  "Answer in the language the user writes in.",
  "Be concise and direct; use plain text, since the output is a terminal.",
].join(" ");

export class Agent {
  constructor() {
    /** @type {Array<object>} Conversation in the neutral message shape. */
    this.messages = [{ role: "system", content: SYSTEM_PROMPT }];
  }

  /**
   * Sends a user message and returns the assistant reply, keeping both in the
   * history so later turns can refer back to them.
   *
   * @param {string} text
   * @returns {Promise<string>}
   */
  async send(text) {
    this.messages.push({ role: "user", content: text });

    const reply = await chat({ messages: this.messages });

    this.messages.push({ role: "assistant", content: reply.text });
    this.trimHistory();

    return reply.text;
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
    this.messages = [system, ...rest.slice(-(limit - 1))];
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
