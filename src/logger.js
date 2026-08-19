// MCP traffic log (requirement #3): every JSON-RPC message, both directions.

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { config } from "./config.js";

export const OUTGOING = "->";
export const INCOMING = "<-";

const entries = [];

let echoToConsole = config.showMcpLog;
let stream = null;
let logFilePath = "";

function getStream() {
  if (stream === null) {
    fs.mkdirSync(config.logDir, { recursive: true });
    // Colons are illegal in Windows filenames, so the ISO timestamp is sanitized.
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    logFilePath = path.join(config.logDir, `session-${stamp}.jsonl`);
    stream = fs.createWriteStream(logFilePath, { flags: "a" });
  }
  return stream;
}

export function logMcp({ direction, server, transport, message }) {
  const entry = {
    timestamp: new Date().toISOString(),
    direction,
    server,
    transport,
    // Lifted out of the payload so the log is scannable without reading the
    // full JSON on every line.
    method: message.method ?? null,
    id: message.id ?? null,
    kind: classify(message),
    message,
  };

  entries.push(entry);
  getStream().write(`${JSON.stringify(entry)}\n`);

  if (echoToConsole) {
    console.log(formatEntry(entry));
  }
}

// Same classification used in the Wireshark analysis: a request carries an id
// and a method, a notification carries a method but no id, and a response
// carries an id with either a result or an error.
function classify(message) {
  if (message.method !== undefined) {
    return message.id === undefined ? "notification" : "request";
  }
  if (message.error !== undefined) return "error";
  if (message.result !== undefined) return "response";
  return "unknown";
}

function formatEntry(entry) {
  const time = entry.timestamp.slice(11, 23);
  const arrow = entry.direction === OUTGOING ? chalk.cyan("->") : chalk.green("<-");
  const label = entry.method ?? `id=${entry.id}`;
  const payload = JSON.stringify(entry.message);
  return chalk.dim(
    `  ${time} ${arrow} ${entry.server} [${entry.transport}] ${entry.kind} ${label} ${payload}`,
  );
}

export function printLog(limit) {
  if (entries.length === 0) {
    console.log(chalk.dim("  (no MCP traffic recorded yet)"));
    return;
  }
  const slice = limit ? entries.slice(-limit) : entries;
  for (const entry of slice) {
    console.log(formatEntry(entry));
  }
  console.log(
    chalk.dim(
      `  ${slice.length} of ${entries.length} entries | file: ${logFilePath}`,
    ),
  );
}

export function setEcho(value) {
  echoToConsole = value === undefined ? !echoToConsole : value;
  return echoToConsole;
}

export function entryCount() {
  return entries.length;
}

export function currentLogFile() {
  return logFilePath;
}
