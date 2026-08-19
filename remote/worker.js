// Logistics MCP server over HTTP (requirement #6), running on Cloudflare
// Workers. Same protocol.js and tools.js as the local server, not a copy.
//
//   POST /mcp     one JSON-RPC message per request
//   GET  /health  liveness probe

import {
  ErrorCode,
  buildError,
  isNotification,
  isRequest,
  parseMessage,
} from "../src/mcp/jsonrpc.js";
import { PROTOCOL_VERSION, handleRequest } from "../servers/logistics/protocol.js";
import { SERVER_INFO } from "../servers/logistics/tools.js";

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id",
};

export default {
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
