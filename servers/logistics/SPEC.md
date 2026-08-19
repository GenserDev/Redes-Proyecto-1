# Logistics MCP Server — Specification

Custom MCP server built for **CC3067 Redes, Proyecto 1**. It models the
customer-service backend of a Guatemalan parcel carrier: quoting a shipment,
registering it, tracking it, and listing what a customer has in transit.

The protocol is implemented by hand on JSON-RPC 2.0. No MCP SDK is used.

- **Server name:** `logistics-mcp`
- **Version:** `1.0.0`
- **Protocol revision:** `2025-06-18`
- **Capabilities:** `tools` only (no resources, prompts or sampling)

## Transports

The domain logic lives in `tools.js` and knows nothing about transports. Two
thin shells expose it:

| Transport | Entry point | How it is addressed |
|-----------|-------------|---------------------|
| stdio | `servers/logistics/stdio-server.js` | Child process; one JSON message per line on stdin/stdout |
| HTTP | `remote/worker.js` | `POST /mcp` with a JSON-RPC body (added in the next stage) |

## Lifecycle

```
client -> server   initialize
client <- server   result: protocolVersion, capabilities, serverInfo
client -> server   notifications/initialized      (no response)
client -> server   tools/list
client <- server   result: tools[]
client -> server   tools/call
client <- server   result: content[], isError?
```

### `initialize`

Request:

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{
  "protocolVersion":"2025-06-18",
  "capabilities":{},
  "clientInfo":{"name":"mcp-chatbot","version":"0.1.0"}}}
```

Response:

```json
{"jsonrpc":"2.0","id":1,"result":{
  "protocolVersion":"2025-06-18",
  "capabilities":{"tools":{}},
  "serverInfo":{"name":"logistics-mcp","version":"1.0.0"}}}
```

### Other methods

| Method | Type | Result |
|--------|------|--------|
| `notifications/initialized` | notification | none, by definition |
| `ping` | request | `{}` |
| `tools/list` | request | `{ "tools": [...] }` |
| `tools/call` | request | `{ "content": [...], "isError": bool }` |

## Tools

### `quote_shipment`

Price and delivery time for a parcel between two cities.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `origin` | string | yes | Origin city |
| `destination` | string | yes | Destination city |
| `weight_kg` | number | yes | Weight in kilograms, `0 < weight_kg <= 70` |
| `service_level` | string | no | `standard` (default), `express`, `overnight` |

Example:

```json
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{
  "name":"quote_shipment",
  "arguments":{"origin":"Guatemala City","destination":"Flores",
               "weight_kg":8,"service_level":"express"}}}
```

```json
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":
"Quote Guatemala City -> Flores\n  weight:        8 kg\n  service:       express\n  zone:          remote\n  price:         GTQ 225.60\n  transit time:  3 business day(s)\n  estimated:     2026-08-24"}]}}
```

### `create_shipment`

Registers a shipment and returns its tracking number.

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `customer` | string | yes | Customer placing the shipment |
| `origin` | string | yes | Origin city |
| `destination` | string | yes | Destination city |
| `weight_kg` | number | yes | Weight in kilograms, `0 < weight_kg <= 70` |
| `service_level` | string | no | `standard` (default), `express`, `overnight` |

Returns the tracking number, the price, the estimated delivery date and the
drop-off branch. New tracking numbers are issued from `GT-4601` upward.

### `track_shipment`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `tracking_number` | string | yes | For example `GT-4471`; matching is case-insensitive |

Returns the current status plus every scan event, each with timestamp,
status, branch and note.

### `list_shipments`

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `customer` | string | yes | Customer name; substring match, case-insensitive |
| `status` | string | no | One of the statuses below |

## Domain reference

### Coverage and zones

| Zone | Cities | Base fee | Per kg | Base transit |
|------|--------|----------|--------|--------------|
| `metro` | Guatemala City, Mixco, Villa Nueva | GTQ 25 | GTQ 4.50 | 1 business day |
| `central` | Antigua Guatemala, Escuintla, Quetzaltenango | GTQ 40 | GTQ 6.00 | 2 business days |
| `remote` | Cobán, Flores, Puerto Barrios | GTQ 65 | GTQ 9.50 | 4 business days |

City names are matched case-insensitively and with accents stripped, so
`Cobán`, `coban` and `COBAN` all resolve to the same city.

### Service levels

| Level | Price multiplier | Days saved |
|-------|------------------|------------|
| `standard` | 1.0 | 0 |
| `express` | 1.6 | 1 |
| `overnight` | 2.4 | 2 |

### Pricing

```
zone       = the more expensive zone of the two endpoints
price       = (zone.base + zone.perKg * weight_kg) * service.multiplier
transitDays = max(1, zone.baseDays - service.daysSaved)
```

The estimated delivery date is the transit time counted in business days from
today, skipping Saturdays and Sundays.

### Statuses

`created`, `picked_up`, `in_transit`, `out_for_delivery`, `delivered`,
`exception`.

## Errors

Two kinds of failure are reported differently, which is what the specification
asks for.

**Protocol errors** become JSON-RPC error responses:

| Code | Meaning | When |
|------|---------|------|
| `-32700` | Parse error | The line was not valid JSON. Answered with `"id": null` |
| `-32600` | Invalid request | The message was not a valid JSON-RPC request |
| `-32601` | Method not found | An unknown method was called |
| `-32602` | Invalid params | `tools/call` arrived without a string `name` |
| `-32603` | Internal error | A handler threw unexpectedly |

```json
{"jsonrpc":"2.0","id":5,"error":{"code":-32601,"message":"Unknown method: bogus/method"}}
```

**Domain errors** are successful JSON-RPC responses carrying `isError: true`.
An unknown tracking number is not a protocol failure — it is an answer the
model should read and explain to the user:

```json
{"jsonrpc":"2.0","id":4,"result":{"content":[{"type":"text","text":
"No shipment found with tracking number \"GT-9999\". Tracking numbers look like GT-4471."}],"isError":true}}
```

The same applies to a city outside the coverage area, a weight above 70 kg, an
unknown service level and a missing required argument.

## Running it

As part of the chatbot, it is declared in `mcp-servers.json` and starts
automatically:

```bash
npm start
```

Standalone, for testing:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node servers/logistics/stdio-server.js
```

A full manual session, one message per line:

```bash
printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"probe","version":"1"}}}' \
  '{"jsonrpc":"2.0","method":"notifications/initialized"}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"track_shipment","arguments":{"tracking_number":"GT-4471"}}}' \
  | node servers/logistics/stdio-server.js
```

## Seed data

Four shipments are preloaded so a demo is reproducible:

| Tracking | Customer | Route | Status |
|----------|----------|-------|--------|
| `GT-4471` | Ferreteria El Tornillo | Guatemala City → Quetzaltenango | `in_transit` |
| `GT-4488` | Ferreteria El Tornillo | Guatemala City → Cobán | `delivered` |
| `GT-4502` | Cafe Las Nubes | Antigua Guatemala → Puerto Barrios | `exception` |
| `GT-4510` | Cafe Las Nubes | Antigua Guatemala → Guatemala City | `out_for_delivery` |

State is held in memory: shipments created during a session are visible for the
rest of that session and reset when the server restarts.
