/**
 * LLM access layer (project requirement #1).
 *
 * Talks to the model provider over plain HTTP with `fetch` -- no vendor SDK is
 * involved. Two providers are supported and both are reduced to the same
 * neutral message shape so the rest of the program never branches on which one
 * is active:
 *
 *   { role: "system",    content: string }
 *   { role: "user",      content: string }
 *   { role: "assistant", content: string, toolCalls?: ToolCall[] }
 *   { role: "tool",      toolCallId: string, name: string, content: string }
 *
 * where ToolCall is { id, name, arguments }, with `arguments` already parsed
 * into an object. Groq speaks the OpenAI wire format; Anthropic uses content
 * blocks.
 */

import { config, requireApiKey } from "./config.js";

/**
 * Sends a conversation to the active provider and returns the reply.
 *
 * @param {object} params
 * @param {Array<object>} params.messages Conversation in the neutral shape.
 * @param {Array<object>} [params.tools]  Tool catalogue: { name, description, inputSchema }.
 * @returns {Promise<{text: string, toolCalls: Array<object>}>}
 */
export async function chat({ messages, tools = [] }) {
  const apiKey = requireApiKey();
  return config.provider === "groq"
    ? chatWithGroq(apiKey, messages, tools)
    : chatWithAnthropic(apiKey, messages, tools);
}

/** @returns {string} Human-readable description of the active model. */
export function describeModel() {
  const { provider } = config;
  return `${provider}/${config[provider].model}`;
}

// ---------------------------------------------------------------------------
// Groq (OpenAI-compatible wire format)
// ---------------------------------------------------------------------------

/**
 * @param {string} apiKey
 * @param {Array<object>} messages
 * @param {Array<object>} tools
 * @returns {Promise<{text: string, toolCalls: Array<object>}>}
 */
async function chatWithGroq(apiKey, messages, tools) {
  const body = {
    model: config.groq.model,
    messages: messages.map(toGroqMessage),
  };

  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.inputSchema,
      },
    }));
    body.tool_choice = "auto";
  }

  const data = await postJson(
    `${config.groq.baseUrl}/chat/completions`,
    { Authorization: `Bearer ${apiKey}` },
    body,
  );

  const message = data.choices?.[0]?.message ?? {};

  return {
    text: message.content ?? "",
    toolCalls: (message.tool_calls ?? []).map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: parseArguments(call.function.arguments),
    })),
  };
}

/**
 * Converts one neutral message into the OpenAI/Groq shape.
 *
 * @param {object} message
 * @returns {object}
 */
function toGroqMessage(message) {
  if (message.role === "tool") {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: message.content,
    };
  }

  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: "assistant",
      content: message.content || null,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: {
          name: call.name,
          arguments: JSON.stringify(call.arguments ?? {}),
        },
      })),
    };
  }

  return { role: message.role, content: message.content };
}

// ---------------------------------------------------------------------------
// Anthropic (content-block format)
// ---------------------------------------------------------------------------

/**
 * @param {string} apiKey
 * @param {Array<object>} messages
 * @param {Array<object>} tools
 * @returns {Promise<{text: string, toolCalls: Array<object>}>}
 */
async function chatWithAnthropic(apiKey, messages, tools) {
  // Anthropic takes the system prompt as a top-level field rather than as a
  // message, so it is pulled out of the conversation here.
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const body = {
    model: config.anthropic.model,
    max_tokens: 4096,
    messages: toAnthropicMessages(
      messages.filter((message) => message.role !== "system"),
    ),
  };

  if (systemPrompt) body.system = systemPrompt;

  if (tools.length > 0) {
    body.tools = tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }));
  }

  const data = await postJson(
    `${config.anthropic.baseUrl}/messages`,
    { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body,
  );

  const blocks = data.content ?? [];

  return {
    text: blocks
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join(""),
    toolCalls: blocks
      .filter((block) => block.type === "tool_use")
      .map((block) => ({
        id: block.id,
        name: block.name,
        arguments: block.input ?? {},
      })),
  };
}

/**
 * Converts neutral messages into Anthropic content blocks.
 *
 * @param {Array<object>} messages
 * @returns {Array<object>}
 */
function toAnthropicMessages(messages) {
  const result = [];

  for (const message of messages) {
    if (message.role === "tool") {
      const block = {
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
      };
      // Anthropic rejects two user messages in a row, so tool results that
      // follow one another are merged into a single user message.
      const previous = result[result.length - 1];
      if (previous?.role === "user" && Array.isArray(previous.content)) {
        previous.content.push(block);
      } else {
        result.push({ role: "user", content: [block] });
      }
      continue;
    }

    if (message.role === "assistant" && message.toolCalls?.length) {
      const content = [];
      if (message.content) content.push({ type: "text", text: message.content });
      for (const call of message.toolCalls) {
        content.push({
          type: "tool_use",
          id: call.id,
          name: call.name,
          input: call.arguments ?? {},
        });
      }
      result.push({ role: "assistant", content });
      continue;
    }

    result.push({ role: message.role, content: message.content });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * POSTs a JSON body and returns the decoded response, turning HTTP errors into
 * exceptions that carry the message reported by the provider.
 *
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {object} body
 * @returns {Promise<object>}
 */
async function postJson(url, headers, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`LLM API ${response.status}: ${text.slice(0, 400)}`);
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`LLM API returned invalid JSON: ${text.slice(0, 200)}`);
  }
}

/**
 * Parses a JSON arguments string, tolerating the empty or blank case.
 *
 * @param {string|undefined} raw
 * @returns {object}
 */
function parseArguments(raw) {
  if (!raw || raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    // A malformed argument string is a model error, not a crash: hand it to
    // the tool layer, which reports it back to the model.
    return { __malformed: raw };
  }
}
