var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// ../src/mcp/jsonrpc.js
var JSONRPC_VERSION = "2.0";
var ErrorCode = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603
};
function buildResponse(id, result) {
  return { jsonrpc: JSONRPC_VERSION, id, result };
}
__name(buildResponse, "buildResponse");
function buildError(id, code, message, data) {
  const error = { code, message };
  if (data !== void 0) error.data = data;
  return { jsonrpc: JSONRPC_VERSION, id: id ?? null, error };
}
__name(buildError, "buildError");
function parseMessage(text) {
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
      `JSON-RPC version must be "${JSONRPC_VERSION}", received ${JSON.stringify(message.jsonrpc)}`
    );
  }
  return message;
}
__name(parseMessage, "parseMessage");
function isRequest(message) {
  return message.method !== void 0 && message.id !== void 0;
}
__name(isRequest, "isRequest");
function isNotification(message) {
  return message.method !== void 0 && message.id === void 0;
}
__name(isNotification, "isNotification");

// ../servers/logistics/tools.js
var SERVER_INFO = {
  name: "logistics-mcp",
  version: "1.0.0"
};
var CITIES = {
  "guatemala city": { zone: "metro", branch: "GT-CENTRAL" },
  "mixco": { zone: "metro", branch: "GT-CENTRAL" },
  "villa nueva": { zone: "metro", branch: "GT-CENTRAL" },
  "antigua guatemala": { zone: "central", branch: "SAC-01" },
  "escuintla": { zone: "central", branch: "ESC-01" },
  "quetzaltenango": { zone: "central", branch: "XELA-01" },
  "coban": { zone: "remote", branch: "AV-01" },
  "flores": { zone: "remote", branch: "PET-01" },
  "puerto barrios": { zone: "remote", branch: "IZA-01" }
};
var ZONE_RATES = {
  metro: { base: 25, perKg: 4.5, baseDays: 1 },
  central: { base: 40, perKg: 6, baseDays: 2 },
  remote: { base: 65, perKg: 9.5, baseDays: 4 }
};
var SERVICE_LEVELS = {
  standard: { multiplier: 1, daysSaved: 0 },
  express: { multiplier: 1.6, daysSaved: 1 },
  overnight: { multiplier: 2.4, daysSaved: 2 }
};
var STATUSES = ["created", "picked_up", "in_transit", "out_for_delivery", "delivered", "exception"];
var shipments = new Map(
  [
    {
      trackingNumber: "GT-4471",
      customer: "Ferreteria El Tornillo",
      origin: "Guatemala City",
      destination: "Quetzaltenango",
      weightKg: 12.5,
      serviceLevel: "express",
      status: "in_transit",
      priceGtq: 190,
      createdAt: "2026-08-14T09:12:00Z",
      estimatedDelivery: "2026-08-19",
      events: [
        { at: "2026-08-14T09:12:00Z", status: "created", location: "GT-CENTRAL", note: "Shipment registered" },
        { at: "2026-08-14T15:40:00Z", status: "picked_up", location: "GT-CENTRAL", note: "Collected from sender" },
        { at: "2026-08-15T07:05:00Z", status: "in_transit", location: "ESC-01", note: "Departed sorting hub" }
      ]
    },
    {
      trackingNumber: "GT-4488",
      customer: "Ferreteria El Tornillo",
      origin: "Guatemala City",
      destination: "Coban",
      weightKg: 3,
      serviceLevel: "standard",
      status: "delivered",
      priceGtq: 93.5,
      createdAt: "2026-08-10T11:00:00Z",
      estimatedDelivery: "2026-08-14",
      events: [
        { at: "2026-08-10T11:00:00Z", status: "created", location: "GT-CENTRAL", note: "Shipment registered" },
        { at: "2026-08-11T08:30:00Z", status: "in_transit", location: "AV-01", note: "Arrived at destination branch" },
        { at: "2026-08-13T14:22:00Z", status: "delivered", location: "AV-01", note: "Signed by M. Lopez" }
      ]
    },
    {
      trackingNumber: "GT-4502",
      customer: "Cafe Las Nubes",
      origin: "Antigua Guatemala",
      destination: "Puerto Barrios",
      weightKg: 48,
      serviceLevel: "standard",
      status: "exception",
      priceGtq: 521,
      createdAt: "2026-08-16T13:45:00Z",
      estimatedDelivery: "2026-08-21",
      events: [
        { at: "2026-08-16T13:45:00Z", status: "created", location: "SAC-01", note: "Shipment registered" },
        { at: "2026-08-17T06:10:00Z", status: "in_transit", location: "GT-CENTRAL", note: "In transit to Izabal" },
        { at: "2026-08-18T09:30:00Z", status: "exception", location: "IZA-01", note: "Road closed at km 245, delivery rescheduled" }
      ]
    },
    {
      trackingNumber: "GT-4510",
      customer: "Cafe Las Nubes",
      origin: "Antigua Guatemala",
      destination: "Guatemala City",
      weightKg: 6.2,
      serviceLevel: "overnight",
      status: "out_for_delivery",
      priceGtq: 185,
      createdAt: "2026-08-17T16:20:00Z",
      estimatedDelivery: "2026-08-18",
      events: [
        { at: "2026-08-17T16:20:00Z", status: "created", location: "SAC-01", note: "Shipment registered" },
        { at: "2026-08-17T19:00:00Z", status: "picked_up", location: "SAC-01", note: "Collected from sender" },
        { at: "2026-08-18T07:15:00Z", status: "out_for_delivery", location: "GT-CENTRAL", note: "On delivery route 12" }
      ]
    }
  ].map((shipment) => [shipment.trackingNumber, shipment])
);
var nextTrackingSuffix = 4600;
var TOOLS = [
  {
    name: "quote_shipment",
    description: "Quote the price and delivery time for a parcel between two cities served by the carrier. Returns the price in quetzales (GTQ), the transit time in business days and the estimated delivery date.",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Origin city, for example 'Guatemala City'" },
        destination: { type: "string", description: "Destination city, for example 'Quetzaltenango'" },
        weight_kg: { type: "number", description: "Parcel weight in kilograms, greater than 0" },
        service_level: {
          type: "string",
          enum: Object.keys(SERVICE_LEVELS),
          description: "Service level; defaults to standard"
        }
      },
      required: ["origin", "destination", "weight_kg"]
    },
    handler: quoteShipment
  },
  {
    name: "create_shipment",
    description: "Register a new shipment for a customer and return its tracking number. The price is calculated with the same rules as quote_shipment.",
    inputSchema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Name of the customer placing the shipment" },
        origin: { type: "string", description: "Origin city" },
        destination: { type: "string", description: "Destination city" },
        weight_kg: { type: "number", description: "Parcel weight in kilograms, greater than 0" },
        service_level: {
          type: "string",
          enum: Object.keys(SERVICE_LEVELS),
          description: "Service level; defaults to standard"
        }
      },
      required: ["customer", "origin", "destination", "weight_kg"]
    },
    handler: createShipment
  },
  {
    name: "track_shipment",
    description: "Look up a shipment by its tracking number and return its current status together with the full history of scan events.",
    inputSchema: {
      type: "object",
      properties: {
        tracking_number: { type: "string", description: "Tracking number, for example 'GT-4471'" }
      },
      required: ["tracking_number"]
    },
    handler: trackShipment
  },
  {
    name: "list_shipments",
    description: "List the shipments belonging to a customer, optionally filtered by status.",
    inputSchema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Customer name; matching is case-insensitive" },
        status: {
          type: "string",
          enum: STATUSES,
          description: "Optional status filter"
        }
      },
      required: ["customer"]
    },
    handler: listShipments
  }
];
function listTools() {
  return TOOLS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema
  }));
}
__name(listTools, "listTools");
function callTool(name, args) {
  const tool = TOOLS.find((entry) => entry.name === name);
  if (tool === void 0) {
    return toolError(`Unknown tool "${name}". Available tools: ${TOOLS.map((t) => t.name).join(", ")}.`);
  }
  try {
    return tool.handler(args ?? {});
  } catch (error) {
    return toolError(error.message);
  }
}
__name(callTool, "callTool");
function quoteShipment(args) {
  const origin = resolveCity(args.origin, "origin");
  const destination = resolveCity(args.destination, "destination");
  const weightKg = resolveWeight(args.weight_kg);
  const serviceLevel = resolveServiceLevel(args.service_level);
  const quote = priceFor(origin, destination, weightKg, serviceLevel);
  return toolText(
    [
      `Quote ${origin.name} -> ${destination.name}`,
      `  weight:        ${weightKg} kg`,
      `  service:       ${serviceLevel}`,
      `  zone:          ${quote.zone}`,
      `  price:         GTQ ${quote.priceGtq.toFixed(2)}`,
      `  transit time:  ${quote.transitDays} business day(s)`,
      `  estimated:     ${quote.estimatedDelivery}`
    ].join("\n")
  );
}
__name(quoteShipment, "quoteShipment");
function createShipment(args) {
  const customer = requireText(args.customer, "customer");
  const origin = resolveCity(args.origin, "origin");
  const destination = resolveCity(args.destination, "destination");
  const weightKg = resolveWeight(args.weight_kg);
  const serviceLevel = resolveServiceLevel(args.service_level);
  const quote = priceFor(origin, destination, weightKg, serviceLevel);
  nextTrackingSuffix += 1;
  const trackingNumber = `GT-${nextTrackingSuffix}`;
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const shipment = {
    trackingNumber,
    customer,
    origin: origin.name,
    destination: destination.name,
    weightKg,
    serviceLevel,
    status: "created",
    priceGtq: quote.priceGtq,
    createdAt: now,
    estimatedDelivery: quote.estimatedDelivery,
    events: [
      { at: now, status: "created", location: origin.branch, note: "Shipment registered" }
    ]
  };
  shipments.set(trackingNumber, shipment);
  return toolText(
    [
      `Shipment created: ${trackingNumber}`,
      `  customer:      ${customer}`,
      `  route:         ${origin.name} -> ${destination.name}`,
      `  weight:        ${weightKg} kg`,
      `  service:       ${serviceLevel}`,
      `  price:         GTQ ${quote.priceGtq.toFixed(2)}`,
      `  estimated:     ${quote.estimatedDelivery}`,
      `  drop-off:      branch ${origin.branch}`
    ].join("\n")
  );
}
__name(createShipment, "createShipment");
function trackShipment(args) {
  const trackingNumber = requireText(args.tracking_number, "tracking_number").toUpperCase();
  const shipment = shipments.get(trackingNumber);
  if (shipment === void 0) {
    return toolError(
      `No shipment found with tracking number "${trackingNumber}". Tracking numbers look like GT-4471.`
    );
  }
  const history = shipment.events.map((event) => `  ${event.at}  ${event.status.padEnd(17)} ${event.location.padEnd(11)} ${event.note}`).join("\n");
  return toolText(
    [
      `Tracking ${shipment.trackingNumber}`,
      `  customer:      ${shipment.customer}`,
      `  route:         ${shipment.origin} -> ${shipment.destination}`,
      `  weight:        ${shipment.weightKg} kg`,
      `  service:       ${shipment.serviceLevel}`,
      `  status:        ${shipment.status}`,
      `  estimated:     ${shipment.estimatedDelivery}`,
      "",
      "History:",
      history
    ].join("\n")
  );
}
__name(trackShipment, "trackShipment");
function listShipments(args) {
  const customer = requireText(args.customer, "customer").toLowerCase();
  if (args.status !== void 0 && !STATUSES.includes(args.status)) {
    return toolError(
      `Unknown status "${args.status}". Valid statuses: ${STATUSES.join(", ")}.`
    );
  }
  const matches = [...shipments.values()].filter(
    (shipment) => shipment.customer.toLowerCase().includes(customer) && (args.status === void 0 || shipment.status === args.status)
  );
  if (matches.length === 0) {
    return toolText(`No shipments found for customer "${args.customer}".`);
  }
  const rows = matches.map(
    (shipment) => `  ${shipment.trackingNumber}  ${shipment.status.padEnd(17)} ${shipment.origin} -> ${shipment.destination}, est. ${shipment.estimatedDelivery}`
  );
  return toolText(
    [`${matches.length} shipment(s) for ${args.customer}:`, ...rows].join("\n")
  );
}
__name(listShipments, "listShipments");
function priceFor(origin, destination, weightKg, serviceLevel) {
  const order = ["metro", "central", "remote"];
  const zone = order.indexOf(origin.zone) >= order.indexOf(destination.zone) ? origin.zone : destination.zone;
  const rate = ZONE_RATES[zone];
  const service = SERVICE_LEVELS[serviceLevel];
  const priceGtq = round2((rate.base + rate.perKg * weightKg) * service.multiplier);
  const transitDays = Math.max(1, rate.baseDays - service.daysSaved);
  return {
    zone,
    priceGtq,
    transitDays,
    estimatedDelivery: addBusinessDays(/* @__PURE__ */ new Date(), transitDays)
  };
}
__name(priceFor, "priceFor");
function addBusinessDays(start, days) {
  const date = new Date(start.getTime());
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}
__name(addBusinessDays, "addBusinessDays");
function round2(value) {
  return Math.round(value * 100) / 100;
}
__name(round2, "round2");
function resolveCity(value, field) {
  const text = requireText(value, field);
  const key = normalize(text);
  const entry = CITIES[key];
  if (entry === void 0) {
    const served = Object.keys(CITIES).map((city) => city.replace(/\b\w/g, (letter) => letter.toUpperCase())).join(", ");
    throw new Error(`City "${text}" is not served. Cities with coverage: ${served}.`);
  }
  return { name: titleCase(key), zone: entry.zone, branch: entry.branch };
}
__name(resolveCity, "resolveCity");
function resolveWeight(value) {
  const weight = Number(value);
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error("weight_kg must be a number greater than 0.");
  }
  if (weight > 70) {
    throw new Error("weight_kg exceeds the 70 kg limit for parcel service.");
  }
  return round2(weight);
}
__name(resolveWeight, "resolveWeight");
function resolveServiceLevel(value) {
  if (value === void 0 || value === "") return "standard";
  const level = String(value).toLowerCase();
  if (!(level in SERVICE_LEVELS)) {
    throw new Error(
      `Unknown service_level "${value}". Valid levels: ${Object.keys(SERVICE_LEVELS).join(", ")}.`
    );
  }
  return level;
}
__name(resolveServiceLevel, "resolveServiceLevel");
function requireText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required and must be a non-empty string.`);
  }
  return value.trim();
}
__name(requireText, "requireText");
function normalize(value) {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
}
__name(normalize, "normalize");
function titleCase(value) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}
__name(titleCase, "titleCase");
function toolText(text) {
  return { content: [{ type: "text", text }] };
}
__name(toolText, "toolText");
function toolError(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}
__name(toolError, "toolError");

// ../servers/logistics/protocol.js
var PROTOCOL_VERSION = "2025-06-18";
function handleRequest(message) {
  const { id, method, params } = message;
  switch (method) {
    case "initialize":
      return buildResponse(id, {
        protocolVersion: PROTOCOL_VERSION,
        // Only tools are offered: no resources, prompts or sampling.
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO
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
          "tools/call requires a string 'name' parameter"
        );
      }
      return buildResponse(id, callTool(params.name, params.arguments));
    }
    default:
      return buildError(id, ErrorCode.METHOD_NOT_FOUND, `Unknown method: ${method}`);
  }
}
__name(handleRequest, "handleRequest");

// worker.js
var CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id"
};
var worker_default = {
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
          transport: "http"
        },
        200
      );
    }
    if (request.method === "POST" && url.pathname === "/mcp") {
      return handleMcp(request);
    }
    return json({ error: "Not found. Use POST /mcp or GET /health." }, 404);
  }
};
async function handleMcp(request) {
  const body = await request.text();
  let message;
  try {
    message = parseMessage(body);
  } catch (error) {
    return json(buildError(null, ErrorCode.PARSE_ERROR, error.message), 200);
  }
  if (isNotification(message)) {
    return new Response(null, { status: 202, headers: CORS_HEADERS });
  }
  if (!isRequest(message)) {
    return json(
      buildError(
        message.id ?? null,
        ErrorCode.INVALID_REQUEST,
        "Expected a request carrying both an id and a method"
      ),
      200
    );
  }
  try {
    return json(handleRequest(message), 200);
  } catch (error) {
    return json(
      buildError(message.id, ErrorCode.INTERNAL_ERROR, error.message),
      200
    );
  }
}
__name(handleMcp, "handleMcp");
function json(payload, status) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": PROTOCOL_VERSION,
      ...CORS_HEADERS
    }
  });
}
__name(json, "json");

// ../node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-7iceEI/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// ../node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-7iceEI/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
