// LLM access layer (requirement #1). Talks to the provider over plain fetch --
// no vendor SDK. All three providers are reduced to the same neutral shape so
// the rest of the program never branches on which one is active:
//
//   { role: "system",    content }
//   { role: "user",      content }
//   { role: "assistant", content, toolCalls?, raw? }
//   { role: "tool",      toolCallId, name, content }

import { config, requireApiKey } from "./config.js";

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

export function describeModel() {
  const { provider } = config;
  return `${provider}/${config[provider].model}`;
}

// ---------------------------------------------------------------------------
// Groq (OpenAI-compatible wire format)
// ---------------------------------------------------------------------------

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
    // Never shown to the user, but the agent uses its presence to tell a
    // finished turn from one where the model thought without acting.
    reasoning: message.reasoning ?? "",
    toolCalls: toolCalls.map((call) => ({
      id: call.id,
      name: call.function.name,
      arguments: parseArguments(call.function.arguments),
    })),
    // Reasoning models carry state in fields outside `content`. Rebuilding the
    // message from our neutral shape would drop them and the model loses the
    // thread mid-task, so the original is kept and echoed back verbatim.
    raw: message,
  };
}

function toGroqMessage(message) {
  // An assistant turn that came from the provider is sent back untouched, so
  // fields we do not model survive the round trip.
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
    raw: blocks,
  };
}

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

async function chatWithGemini(apiKey, messages, tools) {
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
    // Gemini 3 attaches a thoughtSignature to each functionCall part and
    // rejects the next request if it does not come back. Replaying the original
    // parts verbatim satisfies that without this code knowing the field exists.
    raw: parts,
  };
}

// Gemini names the assistant role "model", and tool results travel as
// functionResponse parts inside a user turn.
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
      const previous = contents[contents.length - 1];
      if (previous?.role === "user" && previous.parts[0]?.functionResponse) {
        previous.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
      }
      continue;
    }

    if (message.role === "assistant") {
      const parts = message.raw ?? buildGeminiAssistantParts(message);

      // An assistant turn with neither text nor calls would be rejected.
      if (parts.length > 0) contents.push({ role: "model", parts });
      continue;
    }

    contents.push({ role: "user", parts: [{ text: message.content }] });
  }

  return contents;
}

// For turns that did not come from Gemini: a history restored from elsewhere,
// or one produced by another provider.
function buildGeminiAssistantParts(message) {
  const parts = [];

  if (message.content) parts.push({ text: message.content });

  for (const call of message.toolCalls ?? []) {
    parts.push({ functionCall: { name: call.name, args: call.arguments ?? {} } });
  }

  return parts;
}

const GEMINI_SCHEMA_KEYS = [
  "type",
  "description",
  "enum",
  "properties",
  "required",
  "items",
  "nullable",
];

// The official MCP servers ship schemas with $schema, default, minItems and
// similar keywords. Gemini validates function declarations strictly and rejects
// the whole request when it meets one, so the schema is rebuilt from the
// keywords it understands.
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

const MAX_RETRIES = 3;

// 429 is a rate limit and 503 a momentarily overloaded provider. Both clear on
// their own after a short wait, and free tiers metered per minute hit them
// easily once a large tool catalogue travels with every request.
const RETRYABLE_STATUSES = [429, 503];

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

// Prefers the delay the provider asks for, and otherwise backs off
// exponentially.
function retryDelayMs(response, text, attempt) {
  const header = Number(response.headers.get("retry-after"));
  if (Number.isFinite(header) && header > 0) return header * 1000;

  const quoted = text.match(/try again in ([\d.]+)s/i);
  if (quoted) return Math.ceil(Number(quoted[1]) * 1000) + 500;

  return 2000 * 2 ** attempt;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArguments(raw) {
  if (!raw || raw.trim() === "") return {};
  try {
    return JSON.parse(raw);
  } catch {
    // A malformed argument string is a model error, not a crash: hand it to the
    // tool layer, which reports it back to the model.
    return { __malformed: raw };
  }
}
