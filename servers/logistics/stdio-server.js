#!/usr/bin/env node
/**
 * Logistics MCP server, stdio transport (project requirement #5).
 *
 * The transport shell: it reads newline-delimited JSON from stdin and writes
 * newline-delimited JSON to stdout, handing each parsed request to the shared
 * router in protocol.js. stdout carries protocol messages only, so anything
 * diagnostic goes to stderr.
 *
 * Run it directly to try it out:
 *
 *   echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node stdio-server.js
 */

import readline from "node:readline";
import {
  ErrorCode,
  buildError,
  isNotification,
  isRequest,
  parseMessage,
} from "../../src/mcp/jsonrpc.js";
import { handleRequest } from "./protocol.js";
import { SERVER_INFO } from "./tools.js";

/**
 * Writes one message to stdout, terminated by the newline that frames it.
 *
 * @param {object} message
 */
function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
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
