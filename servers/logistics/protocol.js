/**
 * MCP method routing for the logistics server.
 *
 * This is the part of the server that is the same no matter how messages
 * arrive. `stdio-server.js` feeds it lines read from a pipe and `worker.js`
 * feeds it the body of an HTTP request; neither of them knows what any method
 * means, and this module does not know how the bytes travelled.
 */

import { ErrorCode, buildError, buildResponse } from "../../src/mcp/jsonrpc.js";
import { SERVER_INFO, callTool, listTools } from "./tools.js";

/** Protocol revision this server implements. */
export const PROTOCOL_VERSION = "2025-06-18";

/**
 * Routes one JSON-RPC request to its handler.
 *
 * @param {object} message A JSON-RPC request (it carries an id and a method).
 * @returns {object} The response to send back.
 */
export function handleRequest(message) {
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
