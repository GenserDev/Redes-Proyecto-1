// One MCP client per configured server, presenting their tools to the model as
// a single catalogue.

import { McpClient } from "./client.js";
import { StdioTransport } from "./stdio.js";
import { HttpTransport } from "./http.js";

const NAMESPACE_SEPARATOR = "__";
const MAX_TOOL_NAME_LENGTH = 64;
const MAX_DESCRIPTION_LENGTH = 180;

export class McpManager {
  constructor(serverConfigs) {
    this.serverConfigs = serverConfigs.filter((entry) => entry.enabled !== false);

    this.clients = new Map();
    this.catalogue = [];
    this.failures = [];
  }

  // A server that fails is reported but does not prevent the others from
  // being used.
  async connectAll() {
    for (const serverConfig of this.serverConfigs) {
      try {
        await this.connectOne(serverConfig);
      } catch (error) {
        this.failures.push({ name: serverConfig.name, error: error.message });
      }
    }
  }

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

  listTools() {
    return this.catalogue.map(({ name, description, inputSchema }) => ({
      name,
      description: shortenDescription(description),
      inputSchema,
    }));
  }

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

  close() {
    for (const [, client] of this.clients) {
      client.close();
    }
    this.clients.clear();
  }
}

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

// Two servers may expose a tool with the same name, so tools are published as
// <server>__<tool>. Providers only accept letters, digits, underscore and
// hyphen in a function name.
function namespaceToolName(serverName, toolName) {
  const raw = `${serverName}${NAMESPACE_SEPARATOR}${toolName}`;
  return raw.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, MAX_TOOL_NAME_LENGTH);
}

// The whole catalogue travels with every request, and the official servers ship
// descriptions several sentences long: keeping them in full costs around 2300
// tokens per call, which exhausts a free-tier per-minute quota after a handful
// of turns.
function shortenDescription(description) {
  const firstParagraph = description.split("\n")[0].trim();

  if (firstParagraph.length <= MAX_DESCRIPTION_LENGTH) return firstParagraph;

  const sentenceEnd = firstParagraph.lastIndexOf(". ", MAX_DESCRIPTION_LENGTH);
  return sentenceEnd > 60
    ? firstParagraph.slice(0, sentenceEnd + 1)
    : `${firstParagraph.slice(0, MAX_DESCRIPTION_LENGTH)}...`;
}

// An MCP result is a list of content blocks. Non-text blocks are described
// rather than dropped, so the model knows something came back that it cannot
// read.
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
