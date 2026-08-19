# Proyecto 1 — Uso de un protocolo existente

**Universidad del Valle de Guatemala** · Facultad de Ingeniería · Departamento
de Ciencias de la Computación · **CC3067 Redes**

Terminal chatbot acting as an **MCP host**, connected to five MCP servers over
two different transports, with the Model Context Protocol implemented by hand on
JSON-RPC 2.0.

---

## 1. What was built

```
                        ┌──────────────────────────────┐
                        │   Chatbot (MCP host)         │
                        │   src/index.js               │
                        │   ┌────────────────────────┐ │
   Gemini / Groq  ◄─────┼───┤ llm.js    agent.js     │ │
   Anthropic API        │   └────────────────────────┘ │
                        │   ┌────────────────────────┐ │
                        │   │ mcp/client.js          │ │
                        │   │ mcp/manager.js         │ │
                        │   └───────┬────────┬───────┘ │
                        └───────────┼────────┼─────────┘
                            stdio   │        │  HTTP
                    ┌───────────────┘        └──────────────┐
                    │                                        │
        ┌───────────┴────────────┐              ┌────────────┴────────────┐
        │ filesystem (official)  │              │ logistics-remote        │
        │ git        (official)  │              │ Cloudflare Workers      │
        │ logistics  (ours)      │              │ (the same server)       │
        └────────────────────────┘              └─────────────────────────┘
```

| # | Requirement | Where it lives |
|---|-------------|----------------|
| 1 | LLM through its API | `src/llm.js` — three providers over plain `fetch` |
| 2 | Session context | `src/agent.js` — full history replayed each turn |
| 3 | Log of MCP interactions | `src/logger.js` — JSON Lines, `/log` command |
| 4 | Official local servers | `mcp-servers.json` — Filesystem and Git |
| 5 | Custom local server | `servers/logistics/` |
| 6 | The same server, remote | `remote/worker.js` on Cloudflare Workers |
| 7 | Wireshark analysis | [WIRESHARK.md](WIRESHARK.md) |
| 8–10 | This report | — |

No MCP SDK is used anywhere. `src/mcp/` is about 500 lines and builds, frames,
sends, parses and validates every message itself.

---

## 2. Server specification (requirement #8)

Full detail in [../servers/logistics/SPEC.md](../servers/logistics/SPEC.md).
Summary below.

### Identity and capabilities

| Field | Value |
|-------|-------|
| Server name | `logistics-mcp` |
| Version | `1.0.0` |
| Protocol revision | `2025-06-18` |
| Capabilities | `{"tools":{}}` — tools only, no resources, prompts or sampling |

### Methods

| Method | Type | Params | Result |
|--------|------|--------|--------|
| `initialize` | request | `protocolVersion`, `capabilities`, `clientInfo` | `protocolVersion`, `capabilities`, `serverInfo` |
| `notifications/initialized` | notification | — | none, by definition |
| `ping` | request | — | `{}` |
| `tools/list` | request | — | `{ tools: [...] }` |
| `tools/call` | request | `name`, `arguments` | `{ content: [...], isError? }` |

### Endpoints

| Transport | Address | Framing |
|-----------|---------|---------|
| stdio | child process, `node servers/logistics/stdio-server.js` | one JSON message per line on stdin/stdout |
| HTTP | `POST https://logistics-mcp.mcp-chatbot.workers.dev/mcp` | one JSON message per request body |
| HTTP | `GET https://logistics-mcp.mcp-chatbot.workers.dev/health` | liveness probe, not part of MCP |

Over HTTP a notification is answered with `202` and an empty body; every other
message is answered with `200` and a JSON-RPC message, including protocol
errors.

### Tools

| Tool | Required parameters | Optional | Returns |
|------|--------------------|----------|---------|
| `quote_shipment` | `origin`, `destination`, `weight_kg` | `service_level` | Price in GTQ, transit days, estimated date |
| `create_shipment` | `customer`, `origin`, `destination`, `weight_kg` | `service_level` | Tracking number, price, drop-off branch |
| `track_shipment` | `tracking_number` | — | Current status and full scan history |
| `list_shipments` | `customer` | `status` | Matching shipments |

Domain rules: three coverage zones (`metro`, `central`, `remote`) driving base
fee, per-kilogram rate and transit time; three service levels multiplying price
and shortening transit; a 70 kg parcel limit; delivery dates counted in business
days.

### Error model

The two kinds of failure are reported differently, and this distinction is
visible in the packet capture:

| Failure | Reported as | Example |
|---------|-------------|---------|
| Unknown method | JSON-RPC `error`, code `-32601` | `bogus/method` |
| Malformed body | JSON-RPC `error`, code `-32700`, `id: null` | not valid JSON |
| `tools/call` without a `name` | JSON-RPC `error`, code `-32602` | — |
| Unknown tracking number | `result` with `isError: true` | `GT-9999` |
| City outside coverage, weight over 70 kg | `result` with `isError: true` | — |

A protocol error means the message itself was wrong. A domain error means the
message was fine and the answer is "no" — information the model should read and
explain, not a transport failure.

---

## 3. Network analysis (requirement #9)

Full analysis with frame numbers in [WIRESHARK.md](WIRESHARK.md). The findings
in brief, from a real session against the deployed Cloudflare Worker:

| Layer | What the capture shows |
|-------|------------------------|
| **Link** | Ethernet II over Wi-Fi. Frames addressed to the **gateway's** MAC, not the server's — MAC addressing is local to the segment. Frames up to 1434 bytes against the 1500-byte MTU. |
| **Network** | IPv6 to `2606:4700:3033::6815:3f1e`, a Cloudflare **anycast** address announced from many data centres at once; routing picked the nearest. Hop limit 55 inbound ≈ 9 routers on the return path. |
| **Transport** | TCP three-way handshake; SYN → SYN-ACK in **50 ms**, which is the RTT. MSS 1440 offered, 1360 accepted. Two connections; five of the six requests reused the first one, amortising both handshakes. |
| **Application** | TLS 1.3 (`TLS_AES_256_GCM_SHA384`), ALPN `http/1.1`, then `POST /mcp` per message, then JSON-RPC 2.0 in the body. |

Two observations worth highlighting.

**The 50 ms RTT sets the floor for everything.** Each MCP request/response pair
measured 59–73 ms while the Worker itself reports 5 ms of startup. Nearly all
the latency the user feels is the network, not the code. Reusing one TCP
connection across five requests is therefore not a micro-optimisation: it avoids
paying the TCP and TLS handshakes five times over.

**Loopback advertises an MSS of 65495 against 1440 over Wi-Fi.** Loopback never
touches a network card and so is not bound by the Ethernet MTU. The same
JSON-RPC message that fits in one segment locally must be split into
Ethernet-sized pieces over the real network — a difference invisible to MCP,
which is what a layered model is for.

---

## 4. Difficulties and how they were resolved

Six problems cost real time. All were found by testing, not by reading.

**1. The npx cache was corrupt.** `npx @modelcontextprotocol/server-filesystem`
failed with `Cannot find package 'zod'`. Installing the server as a project
dependency and launching it with `node` directly fixed it and made startup
faster and reproducible. `uvx` for the Git server failed too — `pywin32` could
not be installed because a file was locked — so `pip install mcp-server-git`
plus `python -m mcp_server_git` was used instead.

**2. The official Git server has no `git_init`.** The project brief suggests
asking the chatbot to create a repository. No published version of the server
exposes such a tool, which was confirmed by inspecting releases down to 0.6.2.
The repository is therefore created once during setup and everything after that
— writing the README, staging, committing — is driven by the chatbot.

**3. A missing server hung the chatbot for 30 seconds.** A server that failed to
start left the client waiting for the full request timeout. Watching the child
process's `exit` event and failing pending requests immediately turned a 30
second hang into an instant, readable error.

**4. Reasoning models lose their thread if the turn is rebuilt.** The assistant
message was being reconstructed from our own neutral format, which silently
dropped provider-specific fields: `reasoning` on Groq's gpt-oss models,
`thoughtSignature` on Gemini 3. The first symptom was the model stalling after
one tool call; the second was Gemini rejecting the request outright. The fix was
to store the provider's message exactly as it arrived and replay it verbatim.
This turned out to be the single most instructive bug in the project: an
abstraction that looks lossless can be lossy in ways only the far side knows
about.

**5. Free-tier rate limits.** Groq meters 8000 tokens per minute and the tool
catalogue — 30 tools once every server is connected — travels with every
request, costing about 2300 tokens each time. Trimming tool descriptions to
their first sentence and retrying HTTP 429 and 503 after the delay the provider
asks for solved it. Gemini's more generous free tier became the default.

**6. Gemini validates tool schemas strictly.** It rejects an entire request over
a stray `$schema` or `default` keyword, both of which the official MCP servers
emit. Schemas are rewritten to the subset it accepts before being sent.

---

## 5. Lessons learned

**The protocol earns its keep at the transport boundary.** The clearest result
of the project is a negative one: moving the logistics server from a local pipe
to a Cloudflare data centre required **zero changes to `src/mcp/client.js`**.
The handshake, the id correlation, `tools/list` and `tools/call` are the same
code in both cases. Only a 90-line transport was added. That is the entire
argument for a standard protocol, demonstrated rather than asserted.

**Writing a protocol by hand teaches what an SDK hides.** Implementing JSON-RPC
directly forced decisions an SDK would have made silently: that stdio framing is
newline-delimited rather than the header-based framing LSP uses; that a
notification has no `id` and therefore no response, which is why the HTTP
transport must return an empty body; that responses are matched by `id` and not
by arrival order, which is what makes concurrent requests on one connection
possible.

**Layering is what makes the two captures comparable.** The same five requests
and one notification appear in both traces. Underneath, one used IPv6 to an
anycast address across nine routers with TLS 1.3 on top, and the other never
left the machine. MCP saw no difference — which is precisely the property the
OSI and TCP/IP models describe.

**An error taxonomy is a design decision, not an implementation detail.**
Deciding that an unknown tracking number is a `result` with `isError: true`
rather than a JSON-RPC `error` shapes how the model behaves: it reads the
message and explains it to the user instead of treating it as a broken tool.
Getting this wrong would have been invisible in code review and obvious in
conversation.

**The network dominates the experience.** 5 ms of server time against 50 ms of
round trip. Anything that reduces round trips matters far more than anything
that speeds up the handler.

---

## 6. Conclusions

The project met all ten required functionalities. The chatbot answers from the
model's own knowledge, keeps context across a session, logs every JSON-RPC
message in both directions, and drives five MCP servers — two official, one
written for this project, and that same one again over the network.

MCP is, in the end, a thin agreement layered on JSON-RPC 2.0: a handshake, a way
to list tools, and a way to call them. Its value is not technical sophistication
but the fact that everyone agrees on it. The Filesystem and Git servers were
written by Anthropic with no knowledge of this chatbot, and the logistics server
was written here with no knowledge of any particular host; they interoperate
because both sides implement the same specification. That interoperability —
which the brief describes as the problem MCP was created to solve — is the part
worth taking away.

Implementing it by hand also made the course material concrete in a way a
library would have prevented. `initialize` is not an API call; it is a TCP
handshake, a TLS negotiation, an HTTP request, and a JSON object, each visible
in Wireshark as a distinct layer doing its own job.

### Possible extensions

- **Resources and prompts.** Only `tools` was implemented, being what the
  project required. The rate table would fit naturally as an MCP resource.
- **Persistence in the remote server.** State is in memory, so shipments created
  through the Worker are lost when the isolate is recycled. Cloudflare KV or D1
  would fix this without touching the protocol layer.
- **Streaming.** The specification allows `text/event-stream` responses for
  long-running tools. Our tools answer instantly, so a plain JSON response was
  the simpler and correct choice.
