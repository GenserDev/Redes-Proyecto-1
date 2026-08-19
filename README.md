# MCP Chatbot

Terminal chatbot that acts as an **MCP host**: it talks to an LLM through its
HTTP API and connects to Model Context Protocol servers to extend what the
model can do.

Universidad del Valle de Guatemala — CC3067 Redes, Proyecto 1.

The MCP protocol is implemented **by hand** on JSON-RPC 2.0. No MCP SDK or
framework is used.

## Technologies

| | |
|---|---|
| Runtime | Node.js 20+ (ESM, no build step) |
| Dependencies | `chalk`, `dotenv` |
| Protocol | JSON-RPC 2.0 over stdio and HTTP, MCP revision `2025-06-18` |
| LLM providers | Google Gemini (default), Groq, Anthropic |
| MCP servers | Filesystem and Git (official), plus a custom logistics server |
| Cloud | Cloudflare Workers, deployed with Wrangler |
| Capture analysis | Wireshark / tshark |

## Requirements

- Node.js 20 or newer
- Python 3.10 or newer (only for the official Git MCP server)
- An API key from one of: [Gemini](https://aistudio.google.com/apikey),
  [Groq](https://console.groq.com/keys), [Anthropic](https://console.anthropic.com)

## Installation

```bash
git clone https://github.com/GenserDev/Redes-Proyecto-1.git
cd Redes-Proyecto-1
npm install
pip install mcp-server-git
git init workspace/demo-repo
```

Copy the environment template and add your key:

```bash
cp .env.example .env
```

```
LLM_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
```

To use another provider, set `LLM_PROVIDER` to `groq` or `anthropic` and fill
in the matching key.

## Running

```bash
npm start
```

Anything that does not start with `/` is sent to the model.

| Command | Description |
|---------|-------------|
| `/help` | List the available commands |
| `/servers` | Show the connected MCP servers |
| `/tools` | List every tool the model can reach |
| `/log [n]` | Show the last `n` MCP messages |
| `/log on` / `/log off` | Toggle the live echo of MCP traffic |
| `/clear` | Forget the conversation history |
| `/exit` | Quit |

Every JSON-RPC message exchanged with an MCP server is written to
`logs/session-<timestamp>.jsonl`.

## MCP servers

Declared in `mcp-servers.json`. Set `"enabled": false` to skip one.

| Server | Transport | Tools |
|--------|-----------|-------|
| `filesystem` | stdio | 14 |
| `git` | stdio | 12 |
| `logistics` | stdio | 4 |
| `logistics-remote` | http | 4 |

`logistics` and `logistics-remote` are the same server reached two different
ways. The remote one is deployed at:

```
https://logistics-mcp.mcp-chatbot.workers.dev
```

To use it instead of the local one, swap `enabled` between the two entries and
restart.

Running the custom server standalone:

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | node servers/logistics/stdio-server.js
```

Deploying it:

```bash
npx wrangler login
npx wrangler deploy -c remote/wrangler.toml
```

## Documentation

| Document | Contents |
|----------|----------|
| [docs/Documentacion-Redes-P1.pdf](docs/Documentacion-Redes-P1.pdf) | Project report |
| [docs/WIRESHARK.md](docs/WIRESHARK.md) | Packet capture analysis |
| [servers/logistics/SPEC.md](servers/logistics/SPEC.md) | Custom MCP server specification |

## Project layout

```
src/            Chatbot: UI, LLM providers, agent, MCP client
servers/        Custom logistics MCP server
remote/         Cloudflare Workers deployment of that same server
workspace/      Sandbox the Filesystem and Git servers are limited to
docs/           Report, capture analysis and packet captures
```

## License

MIT.
