// MCP HTTP transport: one JSON-RPC message per POST. It exposes the same
// interface as stdio.js, which is what lets client.js drive a remote server
// with exactly the same code it uses for a child process.

const REQUEST_TIMEOUT_MS = 20_000;

export class HttpTransport {
  constructor({ name, url }) {
    this.name = name;
    this.kind = "http";
    this.url = url;

    this.onMessage = () => {};
    this.onStderr = () => {};
    this.onClose = () => {};

    this.sessionId = null;
  }

  // Nothing to launch: an HTTP endpoint is already running. The method exists
  // so the transport interface stays identical to the stdio one.
  start() {}

  // The client calls this synchronously, so the request is started here and the
  // answer is delivered through onMessage once it arrives, exactly as a message
  // read from a pipe would be.
  send(message) {
    const headers = {
      "content-type": "application/json",
      accept: "application/json",
      // Announcing the revision lets a server refuse a client it cannot serve.
      "mcp-protocol-version": "2025-06-18",
    };

    if (this.sessionId !== null) headers["mcp-session-id"] = this.sessionId;

    fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
      .then(async (response) => {
        // Servers may hand out a session id on the first exchange; echoing it
        // back on later requests is what keeps them on the same session.
        const session = response.headers.get("mcp-session-id");
        if (session) this.sessionId = session;

        const text = await response.text();

        if (!response.ok) {
          this.onStderr(`HTTP ${response.status} from ${this.url}: ${text.slice(0, 200)}`);
        }

        // A notification is answered with an empty body: there is no message to
        // deliver, and the client is not waiting for one.
        if (text.trim() !== "") this.onMessage(text);
      })
      .catch((error) => {
        // A network failure cannot be matched to a single request, so the client
        // is told the connection is gone and fails everything pending.
        this.onClose(`request to ${this.url} failed: ${error.message}`);
      });
  }

  close() {}

  describe() {
    return this.url;
  }
}
