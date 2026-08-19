/**
 * MCP HTTP transport.
 *
 * The remote counterpart of stdio.js. Each JSON-RPC message is the body of one
 * HTTP POST, and the reply body is the response to it; a notification gets an
 * empty body back, which is why nothing is delivered upwards in that case.
 *
 * The interface is identical to the stdio transport -- `start`, `send`,
 * `close`, plus the `onMessage`, `onStderr` and `onClose` hooks -- so
 * client.js drives a server on the other side of the internet with exactly the
 * same code it uses for a child process.
 */

/** How long to wait for a reply before giving up, in milliseconds. */
const REQUEST_TIMEOUT_MS = 20_000;

export class HttpTransport {
  /**
   * @param {object} options
   * @param {string} options.name Logical name, used in the traffic log.
   * @param {string} options.url  Endpoint that accepts JSON-RPC over POST.
   */
  constructor({ name, url }) {
    this.name = name;
    this.kind = "http";
    this.url = url;

    /** @type {(line: string) => void} Receives one raw message per reply. */
    this.onMessage = () => {};

    /** @type {(line: string) => void} Receives diagnostics. */
    this.onStderr = () => {};

    /** @type {(reason: string) => void} Called when the endpoint is unreachable. */
    this.onClose = () => {};

    /** Session id, if the server issues one during initialize. */
    this.sessionId = null;
  }

  /**
   * Nothing to launch: an HTTP endpoint is already running. The method exists
   * so the transport interface stays identical to the stdio one.
   */
  start() {}

  /**
   * POSTs one message and feeds the reply back to the client.
   *
   * The client calls this synchronously, so the request is started here and
   * the answer is delivered through `onMessage` once it arrives, exactly as a
   * message read from a pipe would be.
   *
   * @param {object} message
   */
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

        // A notification is answered with an empty body: there is no message
        // to deliver, and the client is not waiting for one.
        if (text.trim() !== "") this.onMessage(text);
      })
      .catch((error) => {
        // A network failure cannot be matched to a single request, so the
        // client is told the connection is gone and fails everything pending.
        this.onClose(`request to ${this.url} failed: ${error.message}`);
      });
  }

  /** Nothing to tear down: HTTP keeps no connection of its own open. */
  close() {}

  /** @returns {string} How this connection is described in logs and the UI. */
  describe() {
    return this.url;
  }
}
