/**
 * Connection manager: keeps one MCP client per configured server and presents
 * their tools to the model as a single catalogue.
 *
 * Two servers may well expose a tool with the same name, so every tool is
 * published as `<server>__<tool>`. The prefix is stripped again before the
 * call is forwarded, which means the server never sees our naming scheme.
 */

import { McpClient } from "./client.js";
import { StdioTransport } from "./stdio.js";
import { HttpTransport } from "./http.js";

/** Separator between the server name and the tool name. */
const NAMESPACE_SEPARATOR = "__";

/** Providers reject function names longer than this. */
const MAX_TOOL_NAME_LENGTH = 64;

export class McpManager {
  /**
   * @param {Array<object>} serverConfigs Entries from mcp-servers.json.
   */
  constructor(serverConfigs) {
    this.serverConfigs = serverConfigs.filter((entry) => entry.enabled !== false);

    /** @type {Map<string, McpClient>} Connected clients, keyed by server name. */
    this.clients = new Map();

    /** @type {Array<object>} Namespaced tools, in the shape the LLM layer wants. */
    this.catalogue = [];

    /** @type {Array<{name: string, error: string}>} Servers that failed to start. */
    this.failures = [];
  }

  /**
   * Connects to every configured server. A server that fails is reported but
   * does not prevent the others from being used.
   *
   * @returns {Promise<void>}
   */
  async connectAll() {
    for (const serverConfig of this.serverConfigs) {
      try {
        await this.connectOne(serverConfig);
      } catch (error) {
        this.failures.push({ name: serverConfig.name, error: error.message });
      }
    }
  }

  /**
   * Connects to a single server and adds its tools to the catalogue.
   *
   * @param {object} serverConfig
   * @returns {Promise<void>}
   */
  async connectOne(serverConfig) {
    const transport = createTransport(serverConfig);
    const client = new McpClient({ name: serverConfig.name, transport });

    let tools;
    try {
      tools = await client.connect();
    } catch (error) {
      // Leaving a half-started child process behind would keep the terminal
      // from exiting cleanly, so it is torn down before the error propagates.
      client.close();
      throw error;
    }

    this.clients.set(serverConfig.name, client);

    for (const tool of tools) {
      this.catalogue.push({
        name: namespaceToolName(serverConfig.name, tool.name),
        description: tool.description ?? "",
        inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
        server: serverConfig.name,
        toolName: tool.name,
      });
    }
  }

  /**
   * @returns {Array<object>} Tools in the shape the LLM layer expects.
   */
  listTools() {
    return this.catalogue.map(({ name, description, inputSchema }) => ({
      name,
      description: shortenDescription(description),
      inputSchema,
    }));
  }

  /**
   * Runs a namespaced tool and reduces the MCP result to plain text, which is
   * what gets fed back into the conversation.
   *
   * @param {string} namespacedName
   * @param {object} args
   * @returns {Promise<{text: string, isError: boolean}>}
   */
  async callTool(namespacedName, args) {
    const entry = this.catalogue.find((tool) => tool.name === namespacedName);

    if (entry === undefined) {
      return { text: `Unknown tool: ${namespacedName}`, isError: true };
    }

    const client = this.clients.get(entry.server);

    try {
      const result = await client.callTool(entry.toolName, args);
      return {
        text: extractText(result),
        isError: result.isError === true,
      };
    } catch (error) {
      // Transport and protocol failures are reported back to the model as a
      // tool error, so it can explain the problem instead of the chat dying.
      return { text: `Tool call failed: ${error.message}`, isError: true };
    }
  }

  /**
   * @returns {Array<object>} One status row per server, for the /servers command.
   */
  status() {
    const rows = [];

    for (const [name, client] of this.clients) {
      rows.push({
        name,
        connected: true,
        transport: client.transport.kind,
        target: client.transport.describe(),
        serverInfo: client.serverInfo,
        toolCount: this.catalogue.filter((tool) => tool.server === name).length,
      });
    }

    for (const failure of this.failures) {
      rows.push({
        name: failure.name,
        connected: false,
        transport: "-",
        target: failure.error,
        serverInfo: null,
        toolCount: 0,
      });
    }

    return rows;
  }

  /** Shuts every server down. */
  close() {
    for (const [, client] of this.clients) {
      client.close();
    }
    this.clients.clear();
  }
}

/**
 * Builds the transport a server configuration asks for.
 *
 * @param {object} serverConfig
 * @returns {object}
 */
function createTransport(serverConfig) {
  const type = serverConfig.type ?? "stdio";

  if (type === "stdio") {
    return new StdioTransport({
      name: serverConfig.name,
      command: serverConfig.command,
      args: serverConfig.args,
      cwd: serverConfig.cwd,
      env: serverConfig.env,
    });
  }

  if (type === "http") {
    return new HttpTransport({ name: serverConfig.name, url: serverConfig.url });
  }

  throw new Error(`Unsupported MCP transport "${type}"`);
}

/**
 * Combines a server name and a tool name into a single identifier that
 * providers accept: letters, digits, underscore and hyphen only.
 *
 * @param {string} serverName
 * @param {string} toolName
 * @returns {string}
 */
function namespaceToolName(serverName, toolName) {
  const raw = `${serverName}${NAMESPACE_SEPARATOR}${toolName}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, MAX_TOOL_NAME_LENGTH);
}

/** Characters of tool description sent to the model. */
const MAX_DESCRIPTION_LENGTH = 180;

/**
 * Shortens a tool description before it is sent to the model.
 *
 * The whole catalogue travels with every request, and the official servers
 * ship descriptions several sentences long: keeping them in full costs around
 * 2300 tokens per call, which exhausts a free-tier per-minute quota after a
 * handful of turns. The first sentence carries the information the model
 * actually needs to pick a tool.
 *
 * @param {string} description
 * @returns {string}
 */
function shortenDescription(description) {
  const firstParagraph = description.split("\n")[0].trim();

  if (firstParagraph.length <= MAX_DESCRIPTION_LENGTH) return firstParagraph;

  // Prefer cutting at a sentence boundary so the text stays readable.
  const sentenceEnd = firstParagraph.lastIndexOf(". ", MAX_DESCRIPTION_LENGTH);
  return sentenceEnd > 60
    ? firstParagraph.slice(0, sentenceEnd + 1)
    : `${firstParagraph.slice(0, MAX_DESCRIPTION_LENGTH)}...`;
}

/**
 * Reduces an MCP tool result to text. Results are a list of content blocks;
 * text blocks are concatenated and anything else is described so the model
 * knows something was returned that it cannot read.
 *
 * @param {object} result
 * @returns {string}
 */
function extractText(result) {
  const blocks = result?.content;

  if (!Array.isArray(blocks)) {
    return JSON.stringify(result ?? {});
  }

  const parts = blocks.map((block) =>
    block.type === "text" ? block.text : `[${block.type} content]`,
  );

  return parts.join("\n").trim() || "(empty result)";
}
