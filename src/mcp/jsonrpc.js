// JSON-RPC 2.0 message construction and validation, shared by the MCP client
// and by the servers implemented in servers/logistics/.
//
//   Request       { jsonrpc, id, method, params? }   expects a response
//   Notification  { jsonrpc, method, params? }       no id, no response
//   Response      { jsonrpc, id, result | error }    matched back by id
//
// Reference: https://www.jsonrpc.org/specification

export const JSONRPC_VERSION = "2.0";

export const ErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
};

// Ids only have to be unique within one connection, so a counter is enough.
export function createIdGenerator() {
  let next = 1;
  return () => next++;
}

export function buildRequest(id, method, params) {
  const message = { jsonrpc: JSONRPC_VERSION, id, method };
  if (params !== undefined) message.params = params;
  return message;
}

export function buildNotification(method, params) {
  const message = { jsonrpc: JSONRPC_VERSION, method };
  if (params !== undefined) message.params = params;
  return message;
}

export function buildResponse(id, result) {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}

// A null id is what the specification prescribes when the failure happened
// before the request could be parsed.
export function buildError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: JSONRPC_VERSION, id: id ?? null, error };
}

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

export function isRequest(message) {
  return message.method !== undefined && message.id !== undefined;
}

export function isNotification(message) {
  return message.method !== undefined && message.id === undefined;
}

export function isResponse(message) {
  return (
    message.method === undefined &&
    message.id !== undefined &&
    (message.result !== undefined || message.error !== undefined)
  );
}
