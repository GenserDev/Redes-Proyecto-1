# Wireshark Analysis of the MCP Traffic

Requirements #7 and #9. Two captures were taken of the **same MCP session**
against the **same server**, differing only in how the bytes travelled:

| Capture | File | Server | Transport |
|---------|------|--------|-----------|
| Remote, encrypted | `captures/mcp-remote-tls.pcapng` | `logistics-mcp.mcp-chatbot.workers.dev` (Cloudflare) | TCP/443, TLS 1.3, HTTP/1.1 |
| Local, plaintext | `captures/mcp-local-plaintext.pcapng` | `127.0.0.1:8787` (`wrangler dev`) | TCP/8787, HTTP/1.1, no TLS |

The remote capture is the real scenario the project asks for. The local one runs
the identical Worker without encryption, so the JSON-RPC payloads are readable
in Wireshark with no extra setup — useful for showing the message structure
side by side with the encrypted case.

Both were driven by the project's own MCP client, not by a synthetic tool, so
what was recorded is the actual host talking to the actual server.

## How to reproduce

Plaintext capture:

```bash
npx wrangler dev -c remote/wrangler.toml --port 8787
tshark -i \Device\NPF_Loopback -f "tcp port 8787" -a duration:20 \
  -w docs/captures/mcp-local-plaintext.pcapng
node docs/capture-session.mjs http://127.0.0.1:8787/mcp
```

`docs/capture-session.mjs` runs one full MCP session through the project's own
client: handshake, `tools/list`, and three `tools/call` including one that fails.

Encrypted capture, with Node exporting the TLS session keys so the payloads can
be decrypted afterwards:

```bash
tshark -i <wifi-interface> -f "tcp port 443" -a duration:30 \
  -w docs/captures/mcp-remote-tls.pcapng
node --tls-keylog=docs/captures/keylog.txt docs/capture-session.mjs \
  https://logistics-mcp.mcp-chatbot.workers.dev/mcp
```

To read the encrypted capture, point Wireshark at the key log:
*Edit → Preferences → Protocols → TLS → (Pre)-Master-Secret log filename* →
`docs/captures/keylog.txt`. On the command line:

```bash
tshark -r docs/captures/mcp-remote-tls.pcapng -o tls.keylog_file:docs/captures/keylog.txt -Y http
```

Useful display filters:

| Goal | Filter |
|------|--------|
| Only our TLS session | `tls.handshake.extensions_server_name contains "logistics-mcp"` |
| The decrypted MCP messages | `http.request or http.response` |
| The TCP handshake | `tcp.flags.syn == 1` |
| One connection | `tcp.port == 50308` |

---

## Requirement #7: classifying the JSON-RPC messages

JSON-RPC 2.0 defines three message shapes, and each is identified in the
capture by what the JSON object carries:

- **Request** — has both `method` and `id`. Expects a response.
- **Notification** — has `method` but **no `id`**. Gets no response at all.
- **Response** — has `id` and either `result` or `error`, no `method`. It is
  matched to its request by the `id`.

Decrypted from `mcp-remote-tls.pcapng`:

| Frame | TCP | HTTP | JSON-RPC class | Detail |
|-------|-----|------|----------------|--------|
| 91 | 50308 → 443 | `POST /mcp` | **Request** | `method=initialize`, `id=1` |
| 95 | 443 → 50308 | `200` | **Response** | `id=1` → `protocolVersion`, `capabilities`, `serverInfo` |
| 97 | 50308 → 443 | `POST /mcp` | **Notification** | `method=notifications/initialized`, no `id` |
| 101 | 443 → 50308 | `202` | *(none)* | Empty body: nothing to answer |
| 107 | 50309 → 443 | `POST /mcp` | **Request** | `method=tools/list`, `id=2` |
| 111 | 443 → 50309 | `200` | **Response** | `id=2` → 4 tools |
| 113 | 50308 → 443 | `POST /mcp` | **Request** | `method=tools/call`, `id=3` |
| 115 | 443 → 50308 | `200` | **Response** | `id=3` → `Tracking GT-4471` |
| 117 | 50308 → 443 | `POST /mcp` | **Request** | `method=tools/call`, `id=4` |
| 120 | 443 → 50308 | `200` | **Response** | `id=4` → `Quote Guatemala City -> Flores` |
| 123 | 50308 → 443 | `POST /mcp` | **Request** | `method=tools/call`, `id=5` |
| 126 | 443 → 50308 | `200` | **Response** | `id=5` → `isError`, unknown tracking number |

The plaintext capture shows the very same sequence on frames 4, 14, 19, 29, 21,
37, 39, 49, 51, 61, 63 and 73.

### Which messages are synchronization

The MCP lifecycle uses the first three messages to agree on terms before any
work happens:

1. **`initialize` (request, frame 91)** — the client announces the protocol
   revision it speaks (`2025-06-18`), its own identity, and the capabilities it
   offers.
2. **`initialize` result (response, frame 95)** — the server answers with the
   revision it will use and which capabilities it actually has. Ours reports
   `{"tools":{}}`: it offers tools and nothing else.
3. **`notifications/initialized` (notification, frame 97)** — the client
   confirms the handshake is complete. This is the one message in the whole
   session with **no `id`**, and it is the clearest example of the distinction
   the requirement asks about: the server answers HTTP `202` with an **empty
   body** (frame 101). At the HTTP layer something came back; at the JSON-RPC
   layer nothing did, because a notification has no response by definition.

Everything after that is ordinary request/response traffic.

### Two errors, at two different layers

Frame 126 is worth pointing out. Asking for tracking number `GT-9999` fails,
but the capture shows **HTTP 200** and a JSON-RPC **`result`**, not an `error`.
That is deliberate: an unknown tracking number is a domain answer flagged with
`isError: true` inside the result, whereas a JSON-RPC `error` object is reserved
for protocol failures such as an unknown method (`-32601`) or a malformed body
(`-32700`). The capture makes the difference visible on the wire.

---

## Requirement #9: what happens at each layer

Everything below is read from `mcp-remote-tls.pcapng`, frames 79 onward, which
is the connection carrying `initialize`.

### Link layer — Ethernet II over Wi-Fi

```
Source MAC:       68:14:01:7a:7b:67   (Realtek RTL8723BE Wi-Fi adapter)
Destination MAC:  52:d6:0d:df:fb:9c   (default gateway)
EtherType:        0x86dd              (IPv6)
Frame sizes:      74 to 1434 bytes
```

The destination MAC is **the router's, not the server's**. MAC addresses only
have meaning inside the local segment: every frame leaving this laptop is
addressed to the gateway, which strips the frame and builds a new one for the
next hop. The server's identity lives one layer up.

The largest frames are 1434 bytes, just under the 1500-byte Ethernet MTU. That
ceiling is what forces the TLS certificate — several kilobytes — to arrive
across multiple frames rather than one.

### Network layer — IPv6

```
Source:       2803:c800:406e:cc18:5d52:3e3b:ebe6:fbcb   (this laptop)
Destination:  2606:4700:3033::6815:3f1e                 (Cloudflare edge)
Next header:  6                                         (TCP)
Hop limit:    63 outbound, 55 inbound
```

Two things stand out.

**The connection is IPv6.** The name resolves to both families and the resolver
returned IPv6 first, so that is what was used. `2606:4700::/32` is Cloudflare's
range.

**The destination is an anycast address.** That same address is announced from
data centres worldwide; routing delivers to the nearest one. The Worker is not
"in a server somewhere" that we dialled — we reached whichever edge node is
closest, which is what makes the round trip 50 ms instead of hundreds.

The inbound hop limit of 55 means the replies crossed roughly 9 routers on the
way back, assuming the usual initial value of 64.

### Transport layer — TCP

The three-way handshake, frames 79–81:

```
79   3.656 s   50308 → 443   [SYN]       window 64800, MSS 1440
80   3.706 s   443 → 50308   [SYN, ACK]  window 65535, MSS 1360
81   3.707 s   50308 → 443   [ACK]
```

The 50 ms between SYN and SYN-ACK is the round-trip time to the Cloudflare
edge, and it sets the floor for everything above: each MCP request/response pair
took **59 to 73 ms**, which is that RTT plus a few milliseconds of processing.
The Worker itself reports a startup time of 5 ms, so almost all of the latency
a user perceives is the network, not the server.

The two sides advertise different **MSS** values — 1440 from us, 1360 from
Cloudflare. Cloudflare's smaller figure leaves room for tunnel encapsulation
inside its network. The effective segment size is the smaller of the two.

The session used **two connections**, and the reason is visible in the trace:

| Connection | Packets | Bytes | Duration | Carried |
|------------|---------|-------|----------|---------|
| `50308` | 32 | 15 kB | 1.17 s | `initialize`, the notification, all three `tools/call` |
| `50309` | 14 | 6.8 kB | 0.69 s | `tools/list` |

The client sends `notifications/initialized` and immediately follows with
`tools/list` without waiting, since a notification has no reply to wait for.
The first connection was still busy, so the HTTP client opened a second one.
The five requests that follow all reuse connection `50308` — one TCP handshake
and one TLS handshake amortised across the whole session, which is exactly the
behaviour HTTP keep-alive exists to provide.

### Application layer — TLS, then HTTP, then JSON-RPC

Three protocols are stacked here, and the capture shows them nesting.

**TLS 1.3.** The ClientHello (frame 83) offers 52 cipher suites and carries the
SNI extension in the clear — `logistics-mcp.mcp-chatbot.workers.dev` — which is
how Cloudflare knows which certificate to present before anything is encrypted.
The ServerHello (frame 86) selects:

```
Version:  0x0304   TLS 1.3
Cipher:   0x1302   TLS_AES_256_GCM_SHA384
ALPN:     http/1.1
```

From frame 92 onward every record is `Application Data`; without the key log
file, the JSON-RPC below is unreadable.

**HTTP/1.1**, negotiated through ALPN. Each MCP message is one `POST /mcp` with
`content-type: application/json`, and the response body is the reply. HTTP
status is used only for transport-level outcomes: `200` when there is a JSON-RPC
message to return, `202` for a notification that has no reply.

**JSON-RPC 2.0**, in the body — the table in requirement #7 above.

### The same session without encryption

The plaintext capture makes the difference concrete:

| | Remote (Cloudflare) | Local (`wrangler dev`) |
|---|---|---|
| Link | Ethernet II over Wi-Fi, MTU 1500 | Loopback, no physical medium |
| Network | IPv6 to an anycast address, hop limit 63 | IPv4 `127.0.0.1` → `127.0.0.1`, TTL 128 |
| Transport | TCP/443, MSS 1440/1360, window 64800 | TCP/8787, MSS **65495**, window 65535 |
| Security | TLS 1.3, key log needed to read anything | None; payloads readable directly |
| RTT | ~50 ms | under 1 ms |

The MSS gap is the most telling number: **65495 bytes on loopback against 1440
over Wi-Fi**. Loopback never touches a network card, so it is not bound by the
Ethernet MTU and a whole JSON-RPC message fits in a single segment. Over the
real network the same message must be cut into Ethernet-sized pieces.

At the JSON-RPC layer, however, the two captures are identical: the same five
requests, the same notification, the same responses matched by the same `id`s.
That is the point of a layered model — MCP neither knows nor cares that one
session crossed the internet and the other never left the machine.

---

## A note on the key log

`captures/keylog.txt` is committed on purpose: without it the encrypted capture
cannot be decrypted and the analysis above cannot be checked. The keys decrypt
**only these two recorded sessions** against a public endpoint that holds no
credentials and requires no authentication, so there is nothing to expose. A
fresh key log is written each time a capture is taken.
