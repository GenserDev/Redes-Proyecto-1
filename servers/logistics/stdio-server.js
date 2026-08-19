#!/usr/bin/env node
/**
 * Logistics MCP server, stdio transport (project requirement #5).
 *
 * This is the server side of the protocol, written by hand on the same
 * JSON-RPC 2.0 module the client uses. It reads newline-delimited JSON from
 * stdin and writes newline-delimited JSON to stdout; stdout carries protocol
 * messages only, so anything diagnostic goes to stderr.
 *
 * Methods implemented:
 *
 *   initialize                 handshake, reports capabilities and identity
 *   notifications/initialized  handshake acknowledgement, no response
 *   ping                       liveness check, empty result
 *   tools/list                 the tool catalogue
 *   tools/call                 run one tool
 *
 * Run it directly to try it out:
 *
 *   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node stdio-server.js
 */

import readline from "node:readline";
import {
  ErrorCode,
  buildError,
  buildResponse,
  isNotification,
  isRequest,
  parseMessage,
} from "../../src/mcp/jsonrpc.js";
import { SERVER_INFO, callTool, listTools } from "./tools.js";

/** Protocol revision this server implements. */
const PROTOCOL_VERSION = "2025-06-18";

/**
 * Writes one message to stdout, terminated by the newline that frames it.
 *
 * @param {object} message
 */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/**
 * Routes one request to its handler.
 *
 * @param {object} message A JSON-RPC request.
 * @returns {object} The response to send back.
 */
function handleRequest(message) {
  const { id, method, params } = message;

  switch (method) {
    case "initialize":
      return buildResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        // Only tools are offered: no resources, prompts or sampling.
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });

    case "ping":
      return buildResponse(id, {});

    case "tools/list":
      return buildResponse(id, { tools: listTools() });

    case "tools/call": {
      if (typeof params?.name !== "string") {
        return buildError(
          id,
          ErrorCode.INVALID_PARAMS,
          "tools/call requires a string 'name' parameter",
        );
      }
      // A tool that fails for domain reasons still answers with a result;
      // `isError` inside it tells the model what happened.
      return buildResponse(id, callTool(params.name, params.arguments));
    }

    default:
      return buildError(id, ErrorCode.METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }
}

/**
 * Handles one raw line from stdin.
 *
 * @param {string} line
 */
function handleLine(line) {
  if (line.trim() === "") return;

  let message;
  try {
    message = parseMessage(line);
  } catch (error) {
    // The id cannot be known when parsing failed, so the specification says to
    // answer with a null id.
    send(buildError(null, ErrorCode.PARSE_ERROR, error.message));
    return;
  }

  if (isNotification(message)) {
    // Notifications get no response by definition. `notifications/initialized`
    // completes the handshake; anything else is ignored on purpose.
    return;
  }

  if (!isRequest(message)) {
    send(
      buildError(
        message.id ?? null,
        ErrorCode.INVALID_REQUEST,
        "Expected a request carrying both an id and a method",
      ),
    );
    return;
  }

  try {
    send(handleRequest(message));
  } catch (error) {
    // An unexpected failure inside a handler is a server fault, which is what
    // the internal error code is for.
    send(buildError(message.id, ErrorCode.INTERNAL_ERROR, error.message));
  }
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on("line", handleLine);
rl.on("close", () => process.exit(0));

process.stderr.write(`${SERVER_INFO.name} ${SERVER_INFO.version} running on stdio\n`);
