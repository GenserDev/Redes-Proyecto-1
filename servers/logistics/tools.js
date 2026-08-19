// Logistics domain: the tools our own MCP server exposes. The industry case
// is a Guatemalan parcel carrier whose support chatbot can quote, create,
// track and list shipments.
//
// This module knows nothing about MCP or transports, which is what lets the
// same code back both the local stdio server and the remote HTTP worker.

export const SERVER_INFO = {
  name: "logistics-mcp",
  version: "1.0.0",
};

// ---------------------------------------------------------------------------
// Reference data
// ---------------------------------------------------------------------------

const CITIES = {
  "guatemala city": { zone: "metro", branch: "GT-CENTRAL" },
  "mixco": { zone: "metro", branch: "GT-CENTRAL" },
  "villa nueva": { zone: "metro", branch: "GT-CENTRAL" },
  "antigua guatemala": { zone: "central", branch: "SAC-01" },
  "escuintla": { zone: "central", branch: "ESC-01" },
  "quetzaltenango": { zone: "central", branch: "XELA-01" },
  "coban": { zone: "remote", branch: "AV-01" },
  "flores": { zone: "remote", branch: "PET-01" },
  "puerto barrios": { zone: "remote", branch: "IZA-01" },
};

const ZONE_RATES = {
  metro: { base: 25, perKg: 4.5, baseDays: 1 },
  central: { base: 40, perKg: 6.0, baseDays: 2 },
  remote: { base: 65, perKg: 9.5, baseDays: 4 },
};

const SERVICE_LEVELS = {
  standard: { multiplier: 1.0, daysSaved: 0 },
  express: { multiplier: 1.6, daysSaved: 1 },
  overnight: { multiplier: 2.4, daysSaved: 2 },
};

const STATUSES = ["created", "picked_up", "in_transit", "out_for_delivery", "delivered", "exception"];

const shipments = new Map(
  [
    {
      trackingNumber: "GT-4471",
      customer: "Ferreteria El Tornillo",
      origin: "Guatemala City",
      destination: "Quetzaltenango",
      weightKg: 12.5,
      serviceLevel: "express",
      status: "in_transit",
      priceGtq: 190.0,
      createdAt: "2026-08-14T09:12:00Z",
      estimatedDelivery: "2026-08-19",
      events: [
        { at: "2026-08-14T09:12:00Z", status: "created", location: "GT-CENTRAL", note: "Shipment registered" },
        { at: "2026-08-14T15:40:00Z", status: "picked_up", location: "GT-CENTRAL", note: "Collected from sender" },
        { at: "2026-08-15T07:05:00Z", status: "in_transit", location: "ESC-01", note: "Departed sorting hub" },
      ],
    },
    {
      trackingNumber: "GT-4488",
      customer: "Ferreteria El Tornillo",
      origin: "Guatemala City",
      destination: "Coban",
      weightKg: 3.0,
      serviceLevel: "standard",
      status: "delivered",
      priceGtq: 93.5,
      createdAt: "2026-08-10T11:00:00Z",
      estimatedDelivery: "2026-08-14",
      events: [
        { at: "2026-08-10T11:00:00Z", status: "created", location: "GT-CENTRAL", note: "Shipment registered" },
        { at: "2026-08-11T08:30:00Z", status: "in_transit", location: "AV-01", note: "Arrived at destination branch" },
        { at: "2026-08-13T14:22:00Z", status: "delivered", location: "AV-01", note: "Signed by M. Lopez" },
      ],
    },
    {
      trackingNumber: "GT-4502",
      customer: "Cafe Las Nubes",
      origin: "Antigua Guatemala",
      destination: "Puerto Barrios",
      weightKg: 48.0,
      serviceLevel: "standard",
      status: "exception",
      priceGtq: 521.0,
      createdAt: "2026-08-16T13:45:00Z",
      estimatedDelivery: "2026-08-21",
      events: [
        { at: "2026-08-16T13:45:00Z", status: "created", location: "SAC-01", note: "Shipment registered" },
        { at: "2026-08-17T06:10:00Z", status: "in_transit", location: "GT-CENTRAL", note: "In transit to Izabal" },
        { at: "2026-08-18T09:30:00Z", status: "exception", location: "IZA-01", note: "Road closed at km 245, delivery rescheduled" },
      ],
    },
    {
      trackingNumber: "GT-4510",
      customer: "Cafe Las Nubes",
      origin: "Antigua Guatemala",
      destination: "Guatemala City",
      weightKg: 6.2,
      serviceLevel: "overnight",
      status: "out_for_delivery",
      priceGtq: 185.0,
      createdAt: "2026-08-17T16:20:00Z",
      estimatedDelivery: "2026-08-18",
      events: [
        { at: "2026-08-17T16:20:00Z", status: "created", location: "SAC-01", note: "Shipment registered" },
        { at: "2026-08-17T19:00:00Z", status: "picked_up", location: "SAC-01", note: "Collected from sender" },
        { at: "2026-08-18T07:15:00Z", status: "out_for_delivery", location: "GT-CENTRAL", note: "On delivery route 12" },
      ],
    },
  ].map((shipment) => [shipment.trackingNumber, shipment]),
);

let nextTrackingSuffix = 4600;

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: "quote_shipment",
    description:
      "Quote the price and delivery time for a parcel between two cities served by the carrier. Returns the price in quetzales (GTQ), the transit time in business days and the estimated delivery date.",
    inputSchema: {
      type: "object",
      properties: {
        origin: { type: "string", description: "Origin city, for example 'Guatemala City'" },
        destination: { type: "string", description: "Destination city, for example 'Quetzaltenango'" },
        weight_kg: { type: "number", description: "Parcel weight in kilograms, greater than 0" },
        service_level: {
          type: "string",
          enum: Object.keys(SERVICE_LEVELS),
          description: "Service level; defaults to standard",
        },
      },
      required: ["origin", "destination", "weight_kg"],
    },
    handler: quoteShipment,
  },
  {
    name: "create_shipment",
    description:
      "Register a new shipment for a customer and return its tracking number. The price is calculated with the same rules as quote_shipment.",
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
          description: "Service level; defaults to standard",
        },
      },
      required: ["customer", "origin", "destination", "weight_kg"],
    },
    handler: createShipment,
  },
  {
    name: "track_shipment",
    description:
      "Look up a shipment by its tracking number and return its current status together with the full history of scan events.",
    inputSchema: {
      type: "object",
      properties: {
        tracking_number: { type: "string", description: "Tracking number, for example 'GT-4471'" },
      },
      required: ["tracking_number"],
    },
    handler: trackShipment,
  },
  {
    name: "list_shipments",
    description:
      "List the shipments belonging to a customer, optionally filtered by status.",
    inputSchema: {
      type: "object",
      properties: {
        customer: { type: "string", description: "Customer name; matching is case-insensitive" },
        status: {
          type: "string",
          enum: STATUSES,
          description: "Optional status filter",
        },
      },
      required: ["customer"],
    },
    handler: listShipments,
  },
];

export function listTools() {
  return TOOLS.map(({ name, description, inputSchema }) => ({
    name,
    description,
    inputSchema,
  }));
}

// Domain problems -- an unknown city, a tracking number that does not exist --
// come back as results with isError rather than as JSON-RPC errors. The
// specification reserves protocol errors for the protocol itself; a failed
// lookup is information the model should read and explain.
export function callTool(name, args) {
  const tool = TOOLS.find((entry) => entry.name === name);

  if (tool === undefined) {
    return toolError(`Unknown tool "${name}". Available tools: ${TOOLS.map((t) => t.name).join(", ")}.`);
  }

  try {
    return tool.handler(args ?? {});
  } catch (error) {
    return toolError(error.message);
  }
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

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
      `  estimated:     ${quote.estimatedDelivery}`,
    ].join("\n"),
  );
}

function createShipment(args) {
  const customer = requireText(args.customer, "customer");
  const origin = resolveCity(args.origin, "origin");
  const destination = resolveCity(args.destination, "destination");
  const weightKg = resolveWeight(args.weight_kg);
  const serviceLevel = resolveServiceLevel(args.service_level);

  const quote = priceFor(origin, destination, weightKg, serviceLevel);

  nextTrackingSuffix += 1;
  const trackingNumber = `GT-${nextTrackingSuffix}`;
  const now = new Date().toISOString();

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
      { at: now, status: "created", location: origin.branch, note: "Shipment registered" },
    ],
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
      `  drop-off:      branch ${origin.branch}`,
    ].join("\n"),
  );
}

function trackShipment(args) {
  const trackingNumber = requireText(args.tracking_number, "tracking_number").toUpperCase();
  const shipment = shipments.get(trackingNumber);

  if (shipment === undefined) {
    return toolError(
      `No shipment found with tracking number "${trackingNumber}". Tracking numbers look like GT-4471.`,
    );
  }

  const history = shipment.events
    .map((event) => `  ${event.at}  ${event.status.padEnd(17)} ${event.location.padEnd(11)} ${event.note}`)
    .join("\n");

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
      history,
    ].join("\n"),
  );
}

function listShipments(args) {
  const customer = requireText(args.customer, "customer").toLowerCase();

  if (args.status !== undefined && !STATUSES.includes(args.status)) {
    return toolError(
      `Unknown status "${args.status}". Valid statuses: ${STATUSES.join(", ")}.`,
    );
  }

  const matches = [...shipments.values()].filter(
    (shipment) =>
      shipment.customer.toLowerCase().includes(customer) &&
      (args.status === undefined || shipment.status === args.status),
  );

  if (matches.length === 0) {
    return toolText(`No shipments found for customer "${args.customer}".`);
  }

  const rows = matches.map(
    (shipment) =>
      `  ${shipment.trackingNumber}  ${shipment.status.padEnd(17)} ${shipment.origin} -> ${shipment.destination}, est. ${shipment.estimatedDelivery}`,
  );

  return toolText(
    [`${matches.length} shipment(s) for ${args.customer}:`, ...rows].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

// The zone used is the more expensive of the two endpoints, which is how the
// carrier bills a route that leaves the metropolitan area.
function priceFor(origin, destination, weightKg, serviceLevel) {
  const order = ["metro", "central", "remote"];
  const zone =
    order.indexOf(origin.zone) >= order.indexOf(destination.zone)
      ? origin.zone
      : destination.zone;

  const rate = ZONE_RATES[zone];
  const service = SERVICE_LEVELS[serviceLevel];

  const priceGtq = round2((rate.base + rate.perKg * weightKg) * service.multiplier);
  const transitDays = Math.max(1, rate.baseDays - service.daysSaved);

  return {
    zone,
    priceGtq,
    transitDays,
    estimatedDelivery: addBusinessDays(new Date(), transitDays),
  };
}

// Skips Saturdays and Sundays.
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

function round2(value) {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Argument validation
// ---------------------------------------------------------------------------

function resolveCity(value, field) {
  const text = requireText(value, field);
  const key = normalize(text);
  const entry = CITIES[key];

  if (entry === undefined) {
    const served = Object.keys(CITIES)
      .map((city) => city.replace(/\b\w/g, (letter) => letter.toUpperCase()))
      .join(", ");
    throw new Error(`City "${text}" is not served. Cities with coverage: ${served}.`);
  }

  return { name: titleCase(key), zone: entry.zone, branch: entry.branch };
}

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

function resolveServiceLevel(value) {
  if (value === undefined || value === "") return "standard";

  const level = String(value).toLowerCase();

  if (!(level in SERVICE_LEVELS)) {
    throw new Error(
      `Unknown service_level "${value}". Valid levels: ${Object.keys(SERVICE_LEVELS).join(", ")}.`,
    );
  }

  return level;
}

function requireText(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required and must be a non-empty string.`);
  }
  return value.trim();
}

// Lowercases and strips accents so "Cobán" and "coban" resolve to one key.
function normalize(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

function titleCase(value) {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

// ---------------------------------------------------------------------------
// MCP result helpers
// ---------------------------------------------------------------------------

function toolText(text) {
  return { content: [{ type: "text", text }] };
}

function toolError(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}
