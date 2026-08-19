/**
 * MCP client: the protocol logic, written by hand on top of JSON-RPC 2.0.
 *
 * This class is deliberately transport-agnostic. It receives an object with
 * `start`, `send`, `close` and an `onMessage` hook, which is satisfied both by
 * the stdio transport (local servers) and by the HTTP transport (remote
 * servers). That separation is what makes a remote MCP server usable through
 * exactly the same code path as a local one.
 *
 * Connection lifecycle, as defined by the specification:
 *
 *   1. client -> server   initialize                 (request)
 *   2. client <- server   initialize result          (response)
 *   3. client -> server   notifications/initialized  (notification)
 *   4. ... tools/list and tools/call from here on
 *
 * Reference: https://modelcontextprotocol.io/specification/2025-06-18
 */

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

/** Protocol revision this client implements. */
export const PROTOCOL_VERSION = "2025-06-18";

/** How long to wait for a response before giving up, in milliseconds. */
const REQUEST_TIMEOUT_MS = 30_000;

export class McpClient {
  /**
   * @param {object} options
   * @param {string} options.name    Logical server name, used for namespacing.
   * @param {object} options.transport Transport instance.
   */
  constructor({ name, transport }) {
    this.name = name;
    this.transport = transport;
    this.nextId = createIdGenerator();

    /** @type {Map<number, {resolve: Function, reject: Function, timer: NodeJS.Timeout}>} */
    this.pending = new Map();

    /** Server identification returned by initialize. */
    this.serverInfo = null;

    /** Capabilities the server advertised during initialize. */
    this.capabilities = {};

    /** @type {Array<object>} Tools reported by tools/list. */
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

  /**
   * Performs the full handshake and loads the tool catalogue.
   *
   * @returns {Promise<Array<object>>} The tools this server offers.
   */
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

  /**
   * Asks the server which tools it exposes.
   *
   * @returns {Promise<Array<object>>}
   */
  async listTools() {
    const result = await this.request("tools/list", {});
    return result.tools ?? [];
  }

  /**
   * Invokes one tool.
   *
   * @param {string} toolName
   * @param {object} args
   * @returns {Promise<object>} The MCP result, with `content` and `isError`.
   */
  async callTool(toolName, args) {
    return this.request("tools/call", { name: toolName, arguments: args ?? {} });
  }

  /**
   * Sends a request and resolves once the matching response arrives.
   *
   * @param {string} method
   * @param {object} [params]
   * @returns {Promise<object>}
   */
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

  /**
   * Sends a notification, which by definition produces no response.
   *
   * @param {string} method
   * @param {object} [params]
   */
  notify(method, params) {
    this.write(buildNotification(method, params));
  }

  /**
   * Serializes a message, records it, and hands it to the transport.
   *
   * @param {object} message
   */
  write(message) {
    logMcp({
      direction: OUTGOING,
      server: this.name,
      transport: this.transport.kind,
      message,
    });
    this.transport.send(message);
  }

  /**
   * Handles one raw line coming back from the server.
   *
   * @param {string} line
   */
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

    // Notifications from the server (log messages, list-changed events) need
    // no reply; they are already in the traffic log.
  }

  /**
   * Resolves or rejects the promise waiting on this response id.
   *
   * @param {object} message
   */
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

  /**
   * Rejects every request still waiting for a response.
   *
   * @param {string} reason
   */
  failPending(reason) {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(new Error(`MCP server "${this.name}": ${reason}`));
    }
    this.pending.clear();
  }

  /** Closes the connection and fails anything still waiting. */
  close() {
    this.failPending("connection closed");
    this.transport.close();
  }
}
