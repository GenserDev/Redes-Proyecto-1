/**
 * JSON-RPC 2.0 message construction and validation.
 *
 * MCP is JSON-RPC 2.0 carried over a transport. This module owns the message
 * format itself and knows nothing about MCP methods or transports, so the same
 * code is reused by the client (src/mcp/client.js) and by the servers we
 * implement (servers/logistics/).
 *
 * The specification distinguishes three message shapes:
 *
 *   Request       { jsonrpc, id, method, params? }   expects a response
 *   Notification  { jsonrpc, method, params? }       no id, no response
 *   Response      { jsonrpc, id, result | error }    matched back by id
 *
 * Reference: https://www.jsonrpc.org/specification
 */

/** Every message must carry exactly this version string. */
export const JSONRPC_VERSION = "2.0";

/** Error codes reserved by the JSON-RPC 2.0 specification. */
export const ErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

/**
 * Creates a counter that hands out request ids. Ids only have to be unique
 * within one connection, so a per-connection counter is enough.
 *
 * @returns {() => number}
 */
export function createIdGenerator() {
  let next = 1;
  return () => next++;
}

/**
 * Builds a request, which is a message that expects a response.
 *
 * @param {number|string} id
 * @param {string} method
 * @param {object} [params]
 * @returns {object}
 */
export function buildRequest(id, method, params) {
  const message = { jsonrpc: JSONRPC_VERSION, id, method };
  if (params !== undefined) message.params = params;
  return message;
}

/**
 * Builds a notification: same as a request but without an id, which tells the
 * receiver that no response must be sent.
 *
 * @param {string} method
 * @param {object} [params]
 * @returns {object}
 */
export function buildNotification(method, params) {
  const message = { jsonrpc: JSONRPC_VERSION, method };
  if (params !== undefined) message.params = params;
  return message;
}

/**
 * Builds a successful response for the request that carried `id`.
 *
 * @param {number|string} id
 * @param {*} result
 * @returns {object}
 */
export function buildResponse(id, result) {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

/**
 * Builds an error response. `id` is null when the failure happened before the
 * request could be parsed, which is the case the specification defines for
 * parse errors.
 *
 * @param {number|string|null} id
 * @param {number} code
 * @param {string} message
 * @param {*} [data]
 * @returns {object}
 */
export function buildError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: JSONRPC_VERSION, id: id ?? null, error };
}

/**
 * Parses one serialized message and checks the envelope.
 *
 * @param {string} text
 * @returns {object}
 * @throws {Error} When the text is not JSON or is not a JSON-RPC 2.0 message.
 */
export function parseMessage(text) {
  let message;
  try {
    message = JSON.parse(text);
  } catch (cause) {
    throw new Error(`JSON-RPC parse error: ${cause.message}`);
  }

  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    throw new Error("JSON-RPC message must be an object");
  }

  if (message.jsonrpc !== JSONRPC_VERSION) {
    throw new Error(
      `JSON-RPC version must be "${JSONRPC_VERSION}", received ${JSON.stringify(message.jsonrpc)}`,
    );
  }

  return message;
}

/**
 * A request carries both a method and an id.
 *
 * @param {object} message
 * @returns {boolean}
 */
export function isRequest(message) {
  return message.method !== undefined && message.id !== undefined;
}

/**
 * A notification carries a method but no id.
 *
 * @param {object} message
 * @returns {boolean}
 */
export function isNotification(message) {
  return message.method !== undefined && message.id === undefined;
}

/**
 * A response carries an id and either a result or an error.
 *
 * @param {object} message
 * @returns {boolean}
 */
export function isResponse(message) {
  return (
    message.method === undefined &&
    message.id !== undefined &&
    (message.result !== undefined || message.error !== undefined)
  );
}
