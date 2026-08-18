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
| 4 | Official local MCP servers (Filesystem, Git) | Pending |
| 5 | Custom local MCP server (logistics) | Pending |
| 6 | Same MCP server running remotely | Pending |
| 7 | Wireshark analysis of the remote traffic | Pending |
| 8-10 | Written report | Pending |

## Requirements

- **Node.js 20 or newer** (developed on v24). Check with `node --version`.
- An API key for one of the supported providers:
  - **Groq** — <https://console.groq.com/keys>. Free tier, no credit card.
  - **Anthropic** — <https://console.anthropic.com>. Ships with USD 5 in free
    credits.

## Installation

```bash
git clone https://github.com/GenserDev/Redes-Proyecto-1.git
cd Redes-Proyecto-1
npm install
```

Copy the environment template and fill in your key:

```bash
cp .env.example .env
```

Then edit `.env`:

```
LLM_PROVIDER=groq
GROQ_API_KEY=gsk_your_key_here
```

To use Anthropic instead, set `LLM_PROVIDER=anthropic` and fill in
`ANTHROPIC_API_KEY`. Nothing else changes.

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
| `/log [n]` | Show the last `n` MCP messages, or all of them if `n` is omitted |
| `/log on` / `/log off` | Toggle the live echo of MCP traffic while you chat |
| `/clear` | Forget the conversation history |
| `/exit` | Quit |

## Configuration

All settings live in `.env`; see `.env.example` for the full list.

| Variable | Default | Description |
|----------|---------|-------------|
| `LLM_PROVIDER` | `groq` | `groq` or `anthropic` |
| `GROQ_API_KEY` | — | Required when the provider is Groq |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Any Groq model with tool support |
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
  index.js      Terminal UI and entry point
  config.js     Environment loading and validation
  logger.js     MCP traffic log (requirement #3)
  llm.js        Provider layer: Groq and Anthropic over plain fetch
  agent.js      Conversation history and tool-calling loop
  mcp/          Hand-written MCP client (added in the next stage)
servers/        Custom MCP servers
remote/         Cloud deployment of the custom MCP server
docs/           Report and Wireshark analysis
```

## License

MIT.
