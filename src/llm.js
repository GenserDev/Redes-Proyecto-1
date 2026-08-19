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

  switch (config.provider) {
    case "groq":
      return chatWithGroq(apiKey, messages, tools);
    case "anthropic":
      return chatWithAnthropic(apiKey, messages, tools);
    default:
      return chatWithGemini(apiKey, messages, tools);
  }
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
  const toolCalls = message.tool_calls ?? [];

  return {
    text: message.content ?? "",
    // Reasoning models put their chain of thought here. It is never shown to
    // the user, but the agent uses its presence to tell a finished turn from
    // one where the model thought without acting.
    reasoning: message.reasoning ?? "",
    toolCalls: toolCalls.map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: parseArguments(call.function.arguments),
    })),
    // Reasoning models carry state in fields outside `content` (`reasoning`
    // for the gpt-oss family). Rebuilding the message from our neutral shape
    // would drop them and the model loses the thread mid-task, so the original
    // is kept and echoed back verbatim on the next request.
    raw: message,
  };
}

/**
 * Converts one neutral message into the OpenAI/Groq shape.
 *
 * @param {object} message
 * @returns {object}
 */
function toGroqMessage(message) {
  // An assistant turn that came from the provider is sent back untouched, so
  // fields we do not model (reasoning, refusals) survive the round trip.
  if (message.role === "assistant" && message.raw) return message.raw;

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
    reasoning: "",
    toolCalls: blocks
      .filter((block) => block.type === "tool_use")
      .map((block) => ({
        id: block.id,
        name: block.name,
        arguments: block.input ?? {},
      })),
    // Same reasoning as on the Groq side: the original content blocks are
    // preserved so nothing is lost when the turn is replayed.
    raw: blocks,
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

    if (message.role === "assistant" && message.raw) {
      result.push({ role: "assistant", content: message.raw });
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
// Gemini (Google AI Studio)
// ---------------------------------------------------------------------------

/**
 * @param {string} apiKey
 * @param {Array<object>} messages
 * @param {Array<object>} tools
 * @returns {Promise<{text: string, reasoning: string, toolCalls: Array<object>}>}
 */
async function chatWithGemini(apiKey, messages, tools) {
  // Like Anthropic, Gemini takes the system prompt outside the conversation.
  const systemPrompt = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");

  const body = {
    contents: toGeminiContents(
      messages.filter((message) => message.role !== "system"),
    ),
  };

  if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };

  if (tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: tools.map((tool) => {
          const declaration = {
            name: tool.name,
            description: tool.description,
          };
          // Gemini rejects a parameter object with no properties, so a
          // no-argument tool is declared without a schema at all.
          const parameters = toGeminiSchema(tool.inputSchema);
          if (parameters && Object.keys(parameters.properties ?? {}).length > 0) {
            declaration.parameters = parameters;
          }
          return declaration;
        }),
      },
    ];
  }

  const data = await postJson(
    `${config.gemini.baseUrl}/models/${config.gemini.model}:generateContent`,
    { "x-goog-api-key": apiKey },
    body,
  );

  const parts = data.candidates?.[0]?.content?.parts ?? [];

  return {
    text: parts
      .filter((part) => typeof part.text === "string")
      .map((part) => part.text)
      .join(""),
    reasoning: "",
    toolCalls: parts
      .filter((part) => part.functionCall)
      .map((part, index) => ({
        // Gemini matches a result to its call by function name rather than by
        // id, so an id is synthesized purely to satisfy our neutral shape.
        id: `${part.functionCall.name}-${index}`,
        name: part.functionCall.name,
        arguments: part.functionCall.args ?? {},
      })),
    // Gemini 3 attaches a `thoughtSignature` to each functionCall part and
    // rejects the next request if it does not come back. Keeping the original
    // parts and replaying them verbatim satisfies that without this code
    // having to know the field exists.
    raw: parts,
  };
}

/**
 * Converts neutral messages into Gemini `contents`. Gemini names the assistant
 * role "model", and tool results travel as `functionResponse` parts inside a
 * user turn.
 *
 * @param {Array<object>} messages
 * @returns {Array<object>}
 */
function toGeminiContents(messages) {
  const contents = [];

  for (const message of messages) {
    if (message.role === "tool") {
      const part = {
        functionResponse: {
          name: message.name,
          response: { result: message.content },
        },
      };
      // Results that follow one another belong to the same turn.
      const previous = contents[contents.length - 1];
      if (previous?.role === "user" && previous.parts[0]?.functionResponse) {
        previous.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
      }
      continue;
    }

    if (message.role === "assistant") {
      // A turn that came from Gemini is replayed exactly as it arrived, so the
      // thought signatures attached to its function calls survive.
      const parts = message.raw ?? buildGeminiAssistantParts(message);

      // An assistant turn with neither text nor calls would be rejected.
      if (parts.length > 0) contents.push({ role: "model", parts });
      continue;
    }

    contents.push({ role: "user", parts: [{ text: message.content }] });
  }

  return contents;
}

/**
 * Rebuilds an assistant turn from the neutral shape, for messages that did not
 * come from Gemini (a history restored from elsewhere, or another provider).
 *
 * @param {object} message
 * @returns {Array<object>}
 */
function buildGeminiAssistantParts(message) {
  const parts = [];

  if (message.content) parts.push({ text: message.content });

  for (const call of message.toolCalls ?? []) {
    parts.push({ functionCall: { name: call.name, args: call.arguments ?? {} } });
  }

  return parts;
}

/** JSON Schema keywords Gemini accepts; everything else is dropped. */
const GEMINI_SCHEMA_KEYS = [
  "type",
  "description",
  "enum",
  "properties",
  "required",
  "items",
  "nullable",
];

/**
 * Reduces a JSON Schema to the subset Gemini accepts.
 *
 * The official MCP servers ship schemas with `$schema`, `default`, `minItems`
 * and similar keywords. Gemini validates function declarations strictly and
 * rejects the whole request when it meets one, so the schema is rebuilt from
 * the keywords it understands.
 *
 * @param {object} schema
 * @returns {object|null}
 */
function toGeminiSchema(schema) {
  if (schema === null || typeof schema !== "object") return null;

  const result = {};

  for (const key of GEMINI_SCHEMA_KEYS) {
    if (!(key in schema)) continue;

    if (key === "properties") {
      result.properties = {};
      for (const [name, value] of Object.entries(schema.properties)) {
        const converted = toGeminiSchema(value);
        if (converted !== null) result.properties[name] = converted;
      }
      continue;
    }

    if (key === "items") {
      const converted = toGeminiSchema(schema.items);
      if (converted !== null) result.items = converted;
      continue;
    }

    result[key] = schema[key];
  }

  return result;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** How many times a retryable request is retried before giving up. */
const MAX_RETRIES = 3;

/**
 * Statuses worth retrying: 429 is a rate limit, 503 is a provider that is
 * momentarily overloaded. Both clear on their own after a short wait.
 */
const RETRYABLE_STATUSES = [429, 503];

/**
 * POSTs a JSON body and returns the decoded response, turning HTTP errors into
 * exceptions that carry the message reported by the provider.
 *
 * Free tiers are metered per minute, and a conversation that carries a large
 * tool catalogue hits that ceiling easily, so HTTP 429 is retried after the
 * delay the provider asks for instead of failing the user's message.
 *
 * @param {string} url
 * @param {Record<string, string>} headers
 * @param {object} body
 * @returns {Promise<object>}
 */
async function postJson(url, headers, body) {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

    const text = await response.text();

    if (RETRYABLE_STATUSES.includes(response.status) && attempt < MAX_RETRIES) {
      await sleep(retryDelayMs(response, text, attempt));
      continue;
    }

    if (!response.ok) {
      throw new Error(`LLM API ${response.status}: ${text.slice(0, 400)}`);
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`LLM API returned invalid JSON: ${text.slice(0, 200)}`);
    }
  }
}

/**
 * Works out how long to wait before retrying, preferring the delay the
 * provider asks for and otherwise backing off exponentially.
 *
 * @param {Response} response
 * @param {string} text
 * @param {number} attempt Zero-based retry number.
 * @returns {number} Milliseconds to wait.
 */
function retryDelayMs(response, text, attempt) {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;

  const quoted = text.match(/try again in ([\d.]+)s/i);
  if (quoted) return Math.ceil(Number(quoted[1]) * 1000) + 500;

  return 2000 * 2 ** attempt;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
