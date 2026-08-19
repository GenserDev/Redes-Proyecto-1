// MCP stdio transport: the server runs as a child process and messages travel
// as newline-delimited JSON. There is no Content-Length header here -- that
// framing belongs to the Language Server Protocol, not to MCP.

import { spawn } from "node:child_process";

export class StdioTransport {
  constructor({ name, command, args = [], cwd, env = {} }) {
    this.name = name;
    this.kind = "stdio";
    this.command = command;
    this.args = args;
    this.cwd = cwd;
    this.env = env;

    this.child = null;
    this.buffer = "";

    this.onMessage = () => {};
    this.onStderr = () => {};
    this.onClose = () => {};
  }

  start() {
    // Launched without a shell: every server in mcp-servers.json is started
    // through a real executable (node, uvx, python), which keeps arguments free
    // of quoting rules and avoids shell injection entirely.
    this.child = spawn(this.command, this.args, {
      cwd: this.cwd,
      env: { ...process.env, ...this.env },
      stdio: ["pipe", "pipe", "pipe"],
    });

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
      this.onClose(`could not start "${this.command}": ${error.message}`);
    });

    // A server that exits before answering would otherwise leave the client
    // waiting for the full request timeout, so the exit is reported at once.
    this.child.on("exit", (code) => {
      this.onClose(`"${this.command}" exited with code ${code}`);
    });
  }

  // A stream delivers bytes, not lines: a chunk may hold several messages or
  // half of one, so data is buffered until a newline actually arrives.
  consume(chunk) {
    this.buffer += chunk;

    let newlineIndex = this.buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (line !== "") {
        this.onMessage(line);
      }

      newlineIndex = this.buffer.indexOf("\n");
    }
  }

  send(message) {
    if (this.child === null || this.child.stdin.destroyed) {
      throw new Error(`MCP server "${this.name}" is not running`);
    }
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  close() {
    if (this.child === null) return;
    this.child.stdin.end();
    this.child.kill();
    this.child = null;
  }

  describe() {
    return `${this.command} ${this.args.join(" ")}`.trim();
  }
}
