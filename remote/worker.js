/**
 * Logistics MCP server, HTTP transport (project requirement #6).
 *
 * The same server as servers/logistics/stdio-server.js, reached over the
 * network instead of a pipe. It runs on Cloudflare Workers, whose entry point
 * is a `fetch` handler, and it routes messages through the very same
 * protocol.js and tools.js as the local server -- not a copy of them.
 *
 * Endpoints:
 *
 *   POST /mcp     one JSON-RPC message per request; the response is the reply
 *   GET  /health  liveness probe, for checking a deployment from a browser
 *
 * A request that carries a notification gets HTTP 202 with an empty body,
 * since the protocol says notifications have no reply.
 */

import {
  ErrorCode,
  buildError,
  isNotification,
  isRequest,
  parseMessage,
} from "../src/mcp/jsonrpc.js";
import { PROTOCOL_VERSION, handleRequest } from "../servers/logistics/protocol.js";
import { SERVER_INFO } from "../servers/logistics/tools.js";

/**
 * Headers allowing a browser-based client to call this server. They are
 * harmless for the chatbot, which is not subject to the same-origin policy.
 */
const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id",
};

export default {
  /**
   * @param {Request} request
   * @returns {Promise<Response>}
   */
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json(
        {
          status: "ok",
          server: SERVER_INFO.name,
          version: SERVER_INFO.version,
          protocolVersion: PROTOCOL_VERSION,
          transport: "http",
        },
        200,
      );
    }

    if (request.method === "POST" && url.pathname === "/mcp") {
      return handleMcp(request);
    }

    return json({ error: "Not found. Use POST /mcp or GET /health." }, 404);
  },
};

/**
 * Handles one JSON-RPC message delivered over HTTP.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function handleMcp(request) {
  const body = await request.text();

  let message;
  try {
    message = parseMessage(body);
  } catch (error) {
    // A malformed body is still answered with a JSON-RPC error rather than a
    // bare HTTP error, so the client parses one kind of failure, not two.
    return json(buildError(null, ErrorCode.PARSE_ERROR, error.message), 200);
  }

  if (isNotification(message)) {
    // Notifications have no reply; 202 says the message was accepted.
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }

  if (!isRequest(message)) {
    return json(
      buildError(
        message.id ?? null,
        ErrorCode.INVALID_REQUEST,
        "Expected a request carrying both an id and a method",
      ),
      200,
    );
  }

  try {
    return json(handleRequest(message), 200);
  } catch (error) {
    return json(
      buildError(message.id, ErrorCode.INTERNAL_ERROR, error.message),
      200,
    );
  }
}

/**
 * @param {object} payload
 * @param {number} status
 * @returns {Response}
 */
function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": PROTOCOL_VERSION,
      ...CORS_HEADERS,
    },
  });
}
