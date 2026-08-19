/**
 * MCP stdio transport.
 *
 * The server runs as a child process. Messages travel as newline-delimited
 * JSON: one complete JSON-RPC message per line on stdin and stdout, with the
 * child's stderr reserved for diagnostics. There is no Content-Length header
 * here -- that framing belongs to the Language Server Protocol, not to MCP.
 *
 * Because a stream delivers bytes rather than lines, incoming data is buffered
 * and only split once a newline actually arrives; a single chunk may contain
 * several messages, or half of one.
 */

import { spawn } from "node:child_process";

export class StdioTransport {
  /**
   * @param {object} options
   * @param {string} options.name      Logical name, used in the traffic log.
   * @param {string} options.command   Executable to run.
   * @param {string[]} [options.args]  Arguments for the executable.
   * @param {string} [options.cwd]     Working directory for the child process.
   * @param {Record<string,string>} [options.env] Extra environment variables.
   */
  constructor({ name, command, args = [], cwd, env = {} }) {
    this.name = name;
    this.kind = "stdio";
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;

    /** @type {import("node:child_process").ChildProcess|null} */
    this.child = null;

    /** Bytes received but not yet terminated by a newline. */
    this.buffer = "";

    /** @type {(line: string) => void} Receives one raw message per line. */
    this.onMessage = () => {};

    /** @type {(line: string) => void} Receives the child's stderr output. */
    this.onStderr = () => {};
  }

  /**
   * Launches the child process and starts reading messages from its stdout.
   */
  start() {
    // On Windows the launchers we depend on (npx, uvx) are .cmd/.bat scripts,
    // which spawn cannot execute directly; going through the shell resolves
    // them the same way an interactive prompt would.
    const useShell = process.platform === "win32";

    this.child = spawn(
      this.command,
      useShell ? this.args.map(quoteForShell) : this.args,
      {
        cwd: this.cwd,
        env: { ...process.env, ...this.env },
        shell: useShell,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    this.child.stdout.setEncoding("utf8");
    this.child.stdout.on("data", (chunk) => this.consume(chunk));

    this.child.stderr.setEncoding("utf8");
    this.child.stderr.on("data", (chunk) => {
      for (const line of chunk.split(/\r?\n/)) {
        if (line.trim() !== "") this.onStderr(line);
      }
    });

    this.child.on("error", (error) => {
      this.onStderr(`failed to start "${this.command}": ${error.message}`);
    });
  }

  /**
   * Accumulates incoming bytes and emits every complete line as a message.
   *
   * @param {string} chunk
   */
  consume(chunk) {
    this.buffer += chunk;

    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      // Servers occasionally print blank lines; they are not messages.
      if (line !== "") {
        this.onMessage(line);
      }

      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  /**
   * Writes one message, terminated by the newline that delimits it.
   *
   * @param {object} message
   */
  send(message) {
    if (this.child === null || this.child.stdin.destroyed) {
      throw new Error(`MCP server "${this.name}" is not running`);
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /** Terminates the child process. */
  close() {
    if (this.child === null) return;
    this.child.stdin.end();
    this.child.kill();
    this.child = null;
  }

  /** @returns {string} How this connection is described in logs and the UI. */
  describe() {
    return `${this.command} ${this.args.join(" ")}`.trim();
  }
}

/**
 * Quotes an argument that is about to be handed to a shell, so paths
 * containing spaces survive.
 *
 * @param {string} argument
 * @returns {string}
 */
function quoteForShell(argument) {
  return /[\s"]/.test(argument) ? `"${argument.replace(/"/g, '\\"')}"` : argument;
}
