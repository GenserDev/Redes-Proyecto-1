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
| 5 | Custom local MCP server (logistics) | Pending |
| 6 | Same MCP server running remotely | Pending |
| 7 | Wireshark analysis of the remote traffic | Pending |
| 8-10 | Written report | Pending |

## Requirements

- **Node.js 20 or newer** (developed on v24). Check with `node --version`.
- **Python 3.10 or newer**, only for the official Git MCP server.
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

Both are the official Anthropic servers. The Filesystem server is sandboxed to
`workspace/`, so the model cannot touch the rest of the machine. Set
`"enabled": false` on an entry to skip it.

### Example scenario

With `/log on` you can watch the JSON-RPC traffic while the model works:

```
you > Create a README.md in workspace/demo-repo describing this project,
      then stage it and commit it with the message "docs: add readme"

  tool filesystem__write_file {"path":"...demo-repo/README.md","content":"..."}
       ok Successfully wrote to ...
  tool git__git_add {"repo_path":"...demo-repo","files":["README.md"]}
       ok Files staged successfully
  tool git__git_commit {"repo_path":"...demo-repo","message":"docs: add readme"}
       ok Changes committed successfully with hash 4f2c1ab
bot > Done: the README is written, staged and committed as 4f2c1ab.
```

The model never touches the filesystem or Git itself. It asks for a tool by
name, the chatbot forwards the call as a JSON-RPC `tools/call` over stdio, and
the result is fed back into the conversation.

> **Note on repository creation.** The official Git MCP server exposes no
> `git_init` tool in any published version, so the repository is created once
> during setup with `git init workspace/demo-repo`. Everything after that —
> writing files, staging and committing — is driven by the chatbot.

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
  mcp/
    jsonrpc.js  JSON-RPC 2.0 messages: build, parse, validate
    stdio.js    Transport for local servers (child process, one message per line)
    client.js   Protocol logic: handshake, tools/list, tools/call
    manager.js  One client per server, merged tool catalogue
servers/        Custom MCP servers
remote/         Cloud deployment of the custom MCP server
workspace/      Sandbox the Filesystem and Git servers are limited to
docs/           Report and Wireshark analysis
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
