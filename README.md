# MCP Chatbot

A terminal chatbot that acts as an **MCP host**: it talks to an LLM through its
HTTP API and connects to Model Context Protocol servers to extend what the model
can do.

Universidad del Valle de Guatemala — Facultad de Ingeniería — Departamento de
Ciencias de la Computación — **CC3067 Redes, Proyecto 1**.

The MCP protocol is implemented **by hand** on top of JSON-RPC 2.0. No MCP SDK
or framework (FastMCP and similar) is used anywhere in this repository; every
message is built, framed, sent and parsed by the code in `src/mcp/` and
`servers/`.

## Status

| # | Requirement | Status |
|---|-------------|--------|
| 1 | LLM connection through its API | Done |
| 2 | Context kept across a session | Done |
| 3 | Log of every MCP request and response | Done |
| 4 | Official local MCP servers (Filesystem, Git) | Done |
| 5 | Custom local MCP server (logistics) | Done |
| 6 | Same MCP server running remotely | Built, awaiting deploy |
| 7 | Wireshark analysis of the remote traffic | Pending |
| 8-10 | Written report | Pending |

## Requirements

- **Node.js 20 or newer** (developed on v24). Check with `node --version`.
- **Python 3.10 or newer**, only for the official Git MCP server.
- An API key for one of the three supported providers:
  - **Google Gemini** — <https://aistudio.google.com/apikey>. Free tier, no
    credit card. This is the default.
  - **Groq** — <https://console.groq.com/keys>. Free tier, no credit card.
  - **Anthropic** — <https://console.anthropic.com>. Ships with USD 5 in free
    credits.

## Installation

```bash
git clone https://github.com/GenserDev/Redes-Proyecto-1.git
cd Redes-Proyecto-1
npm install
```

Install the official Git MCP server, which is a Python package:

```bash
pip install mcp-server-git
```

Create the sandbox repository the servers are allowed to work in:

```bash
git init workspace/demo-repo
```

Copy the environment template and fill in your key:

```bash
cp .env.example .env
```

Then edit `.env`:

```
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
```

Switching provider is one line: set `LLM_PROVIDER` to `groq` or `anthropic`
and fill in the matching key. Nothing else changes — `src/llm.js` reduces all
three APIs to the same internal message shape.

## Usage

```bash
npm start
```

You get a prompt. Anything that does not start with `/` is sent to the model:

```
you > Who was Alan Turing?
bot > Alan Turing was a British mathematician and computer scientist ...

you > When was he born?
bot > He was born on 23 June 1912 in London.
```

The second question works because the whole conversation is replayed on every
request — that is requirement #2.

### Commands

| Command | Description |
|---------|-------------|
| `/help` | List the available commands |
| `/servers` | Show the connected MCP servers and their transports |
| `/tools` | List every tool the model can reach, grouped by server |
| `/log [n]` | Show the last `n` MCP messages, or all of them if `n` is omitted |
| `/log on` / `/log off` | Toggle the live echo of MCP traffic while you chat |
| `/clear` | Forget the conversation history |
| `/exit` | Quit |

## MCP servers

The servers to start are declared in `mcp-servers.json`. On launch the chatbot
connects to each one, runs the MCP handshake, and merges every tool into a
single catalogue. Tools are published to the model as `<server>__<tool>`
(`filesystem__write_file`, `git__git_commit`) so two servers can expose the
same tool name without colliding.

| Server | Transport | Command | Tools |
|--------|-----------|---------|-------|
| `filesystem` | stdio | `node node_modules/@modelcontextprotocol/server-filesystem` | 14 |
| `git` | stdio | `python -m mcp_server_git` | 12 |
| `logistics` | stdio | `node servers/logistics/stdio-server.js` | 4 |
| `logistics-remote` | http | `POST https://<subdomain>.workers.dev/mcp` | 4 |

The first two are the official Anthropic servers; the third is written for
this project. The Filesystem server is sandboxed to `workspace/`, so the model
cannot touch the rest of the machine. Set `"enabled": false` on an entry to
skip it.

### Example scenario

With `/log on` you can watch the JSON-RPC traffic while the model works.
This is a real transcript, trimmed only in width:

```
you > En el repositorio demo-repo, crea un archivo README.md que describa un
      proyecto de chatbot MCP. Luego agregalo al staging y haz un commit con
      el mensaje 'docs: add readme'.

  tool filesystem__write_file {"content":"# MCP Chatbot Demo\n\nEste proyecto..."}
       ok Successfully wrote to demo-repo/README.md
  tool git__git_add {"files":["README.md"],"repo_path":"demo-repo"}
       ok Files staged successfully
  tool git__git_commit {"message":"docs: add readme","repo_path":"demo-repo"}
       ok Changes committed successfully with hash 2f063921cd74d70d...
bot > Archivo README.md creado, anadido al staging y commit realizado con el
      mensaje `docs: add readme`.
```

That session produced 18 log entries: 7 requests, 7 responses, 2 notifications
and 2 server diagnostics.

The model never touches the filesystem or Git itself. It asks for a tool by
name, the chatbot forwards the call as a JSON-RPC `tools/call` over stdio, and
the result is fed back into the conversation.

> **Note on repository creation.** The official Git MCP server exposes no
> `git_init` tool in any published version, so the repository is created once
> during setup with `git init workspace/demo-repo`. Everything after that —
> writing files, staging and committing — is driven by the chatbot.

## The logistics MCP server

The custom server (requirement #5) models the customer-service backend of a
Guatemalan parcel carrier. Full specification in
[servers/logistics/SPEC.md](servers/logistics/SPEC.md).

| Tool | What it does |
|------|--------------|
| `quote_shipment` | Price and transit time between two cities |
| `create_shipment` | Registers a shipment, returns a tracking number |
| `track_shipment` | Current status plus the full scan history |
| `list_shipments` | A customer's shipments, optionally filtered by status |

Both the server and its client speak JSON-RPC 2.0 through the same
`src/mcp/jsonrpc.js` module — one builds the messages, the other answers them.
The domain logic in `servers/logistics/tools.js` has no idea a transport
exists, which is what makes the remote deployment in the next stage a thin
shell over the same file.

Errors are split the way the specification intends: an unknown method is a
JSON-RPC error (`-32601`), while an unknown tracking number is a *successful*
response carrying `isError: true`, because that is an answer the model should
read and explain rather than a protocol failure.

```
you > Donde esta mi paquete GT-4471?

  tool logistics__track_shipment {"tracking_number":"GT-4471"}
       ok Tracking GT-4471 customer: Ferreteria El Tornillo route: Guatemala...
bot > El paquete GT-4471 esta en transito. El 15 de agosto a las 07:05 UTC
      salio del centro de clasificacion ESC-01 hacia Quetzaltenango. Entrega
      estimada para el 19 de agosto de 2026.

you > Cuanto me costaria mandar 8 kilos de Guatemala City a Flores en express?

  tool logistics__quote_shipment {"origin":"Guatemala City","destination":"Flores",
                                  "service_level":"express","weight_kg":8}
       ok Quote Guatemala City -> Flores ... price: GTQ 225.60
bot > El costo seria GTQ 225.60, con 3 dias habiles de transito.
```

You can also drive it by hand, without the chatbot:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node servers/logistics/stdio-server.js
```

## The same server, running remotely

Requirement #6 asks for the custom server to run in the cloud and be used by
the chatbot exactly as the local one is. It is deployed to **Cloudflare
Workers**, whose free plan needs no credit card.

The point of the exercise is what *did not* have to change. `src/mcp/client.js`
— the handshake, the id correlation, `tools/list`, `tools/call` — is untouched
between the two. Only the transport differs:

| | Local | Remote |
|---|-------|--------|
| Transport | `src/mcp/stdio.js` | `src/mcp/http.js` |
| Carrier | Child process pipe | HTTP POST |
| Framing | One JSON message per line | One JSON message per request body |
| Shell | `servers/logistics/stdio-server.js` | `remote/worker.js` |
| Router | `servers/logistics/protocol.js` | the same file |
| Domain | `servers/logistics/tools.js` | the same file |

Both shells are around 80 lines and contain no protocol knowledge: they frame
messages and hand them to the shared router.

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/mcp` | One JSON-RPC message per request; the reply is the response |
| `GET` | `/health` | Liveness probe, readable from a browser |

A notification is answered with HTTP `202` and an empty body, since the
protocol says notifications get no reply. Protocol failures come back as
JSON-RPC errors with HTTP `200`, so the client only ever parses one kind of
failure.

### Deploying

```bash
npx wrangler login
npx wrangler deploy -c remote/wrangler.toml
```

Wrangler prints the public URL. Put it in the `logistics-remote` entry of
`mcp-servers.json`, then flip which server is active:

```json
{ "name": "logistics",        "enabled": false },
{ "name": "logistics-remote", "enabled": true  }
```

Restart the chatbot and ask the same questions. The answers are identical and
`/servers` reports `transport: http`.

### Running it locally

For development, and for the plain-text Wireshark capture in the next stage,
the same worker runs on localhost over unencrypted HTTP:

```bash
npx wrangler dev -c remote/wrangler.toml
curl http://127.0.0.1:8787/health
```

## Notes on the providers

The three backends differ in more than their URLs, and `src/llm.js` absorbs
those differences so the agent never sees them:

- **Message replay.** Every provider attaches state to an assistant turn that
  our neutral message shape does not model — `reasoning` on Groq's gpt-oss
  models, `thoughtSignature` on Gemini 3. Rebuilding the turn from our own
  fields drops it, and the model then stalls mid-task or the API rejects the
  request outright. Assistant turns are therefore stored as they arrived and
  replayed verbatim.
- **Schema strictness.** Gemini validates function declarations against a
  subset of JSON Schema and rejects the whole request over a stray `$schema`
  or `default`, both of which the official MCP servers emit. Schemas are
  rewritten to that subset before being sent.
- **Quotas.** Groq's free tier meters 8000 tokens per minute, and the tool
  catalogue travels with every request. Tool descriptions are trimmed to their
  first sentence before being sent to the model (the full text stays in
  `/tools`), and HTTP 429 and 503 are retried after the delay the provider
  asks for.

## Configuration

All settings live in `.env`; see `.env.example` for the full list.

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `gemini` | `gemini`, `groq` or `anthropic` |
| `GEMINI_API_KEY` | — | Required when the provider is Gemini |
| `GEMINI_MODEL` | `gemini-3.7-flash` | Any Gemini model with function calling |
| `GROQ_API_KEY` | — | Required when the provider is Groq |
| `GROQ_MODEL` | `openai/gpt-oss-120b` | Any Groq model with tool support |
| `ANTHROPIC_API_KEY` | — | Required when the provider is Anthropic |
| `ANTHROPIC_MODEL` | `claude-sonnet-4-5` | Anthropic model id |
| `MAX_HISTORY_MESSAGES` | `40` | Messages kept before the oldest are dropped |
| `SHOW_MCP_LOG` | `false` | Echo MCP traffic to the terminal on startup |

## MCP traffic log

Every JSON-RPC message exchanged with an MCP server is recorded, in both
directions, and written to `logs/session-<timestamp>.jsonl`. One line per
message:

```json
{"timestamp":"2026-08-18T19:04:11.238Z","direction":"->","server":"filesystem","transport":"stdio","method":"tools/list","id":2,"kind":"request","message":{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}}
```

The `kind` field classifies each message the same way the Wireshark analysis
does — `request`, `notification`, `response` or `error` — which is what
requirement #7 asks for.

## Project layout

```
src/
  index.js          Terminal UI and entry point
  config.js         Environment and server configuration
  logger.js         MCP traffic log (requirement #3)
  llm.js            Provider layer: Gemini, Groq and Anthropic over plain fetch
  agent.js          Conversation history and tool-calling loop
  mcp/
    jsonrpc.js      JSON-RPC 2.0 messages: build, parse, validate
    client.js       Protocol logic: handshake, tools/list, tools/call
    stdio.js        Transport for local servers (one message per line)
    http.js         Transport for remote servers (one message per POST)
    manager.js      One client per server, merged tool catalogue
servers/logistics/
  tools.js          Domain logic and tool schemas, transport-agnostic
  protocol.js       MCP method routing, shared by both transports
  stdio-server.js   Local server over stdio (requirement #5)
  SPEC.md           Full server specification
remote/
  worker.js         Remote server over HTTP (requirement #6)
  wrangler.toml     Cloudflare Workers deployment
workspace/          Sandbox the Filesystem and Git servers are limited to
docs/               Report and Wireshark analysis
```

### How the protocol is implemented

`src/mcp/` is the whole MCP implementation, about 500 lines with no protocol
dependencies. The handshake follows the specification exactly:

```
client -> server   {"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
client <- server   {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18",...}}
client -> server   {"jsonrpc":"2.0","method":"notifications/initialized"}
client -> server   {"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}
```

Over stdio, each message is a single line of JSON on the child process's
stdin/stdout. `client.js` never refers to a transport directly, which is what
lets the same class drive a remote server later in the project.

## License

MIT.
