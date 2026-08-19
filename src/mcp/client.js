// MCP client: the protocol logic, written by hand on JSON-RPC 2.0.
//
// It is deliberately transport-agnostic, which is what makes a remote MCP
// server usable through exactly the same code path as a local one.
//
// Lifecycle defined by the specification:
//
//   1. client -> server   initialize                 (request)
//   2. client <- server   initialize result          (response)
//   3. client -> server   notifications/initialized  (notification)
//   4. ... tools/list and tools/call from here on
//
// Reference: https://modelcontextprotocol.io/specification/2025-06-18

import {
  ErrorCode,
  buildError,
  buildNotification,
  buildRequest,
  createIdGenerator,
  isRequest,
  isResponse,
  parseMessage,
} from "./jsonrpc.js";
import { logMcp, OUTGOING, INCOMING } from "../logger.js";

export const PROTOCOL_VERSION = "2025-06-18";

const REQUEST_TIMEOUT_MS = 30_000;

export class McpClient {
  constructor({ name, transport }) {
    this.name = name;
    this.transport = transport;
    this.nextId = createIdGenerator();

    this.pending = new Map();
    this.serverInfo = null;
    this.capabilities = {};
    this.tools = [];

    this.transport.onMessage = (line) => this.receive(line);
    this.transport.onClose = (reason) => this.failPending(reason);

    this.transport.onStderr = (line) => {
      // Server diagnostics are not protocol messages, but they are the only
      // clue available when a server fails to start, so they are recorded too.
      logMcp({
        direction: INCOMING,
        server: this.name,
        transport: this.transport.kind,
        message: { stderr: line },
      });
    };
  }

  async connect() {
    this.transport.start();

    const result = await this.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "mcp-chatbot", version: "0.1.0" },
    });

    this.serverInfo = result.serverInfo ?? { name: this.name };
    this.capabilities = result.capabilities ?? {};

    // The specification requires this notification before any other request:
    // it tells the server the handshake is complete.
    this.notify("notifications/initialized");

    this.tools = this.capabilities.tools ? await this.listTools() : [];
    return this.tools;
  }

  async listTools() {
    const result = await this.request("tools/list", {});
    return result.tools ?? [];
  }

  async callTool(toolName, args) {
    return this.request("tools/call", { name: toolName, arguments: args ?? {} });
  }

  request(method, params) {
    const id = this.nextId();
    const message = buildRequest(id, method, params);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP server "${this.name}" timed out on ${method}`));
      }, REQUEST_TIMEOUT_MS);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.write(message);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params) {
    this.write(buildNotification(method, params));
  }

  write(message) {
    logMcp({
      direction: OUTGOING,
      server: this.name,
      transport: this.transport.kind,
      message,
    });
    this.transport.send(message);
  }

  receive(line) {
    let message;
    try {
      message = parseMessage(line);
    } catch (error) {
      // A malformed message cannot be correlated with a request, so it is
      // recorded and dropped rather than crashing the session.
      logMcp({
        direction: INCOMING,
        server: this.name,
        transport: this.transport.kind,
        message: { parseError: error.message, raw: line },
      });
      return;
    }

    logMcp({
      direction: INCOMING,
      server: this.name,
      transport: this.transport.kind,
      message,
    });

    if (isResponse(message)) {
      this.settle(message);
      return;
    }

    // This client advertises no capabilities, so any request the server sends
    // is answered with the standard "method not found" error.
    if (isRequest(message)) {
      this.write(
        buildError(
          message.id,
          ErrorCode.METHOD_NOT_FOUND,
          `Client does not implement ${message.method}`,
        ),
      );
    }

    // Notifications from the server need no reply; they are already logged.
  }

  settle(message) {
    const entry = this.pending.get(message.id);
    if (entry === undefined) return; // Late response to a timed-out request.

    clearTimeout(entry.timer);
    this.pending.delete(message.id);

    if (message.error !== undefined) {
      entry.reject(
        new Error(
          `MCP error ${message.error.code} from "${this.name}": ${message.error.message}`,
        ),
      );
      return;
    }

    entry.resolve(message.result);
  }

  failPending(reason) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`MCP server "${this.name}": ${reason}`));
    }
    this.pending.clear();
  }

  close() {
    this.failPending("connection closed");
    this.transport.close();
  }
}
