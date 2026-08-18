/**
 * MCP traffic log (project requirement #3).
 *
 * Every JSON-RPC message exchanged with an MCP server is recorded here, in
 * both directions. Entries are appended to a per-session JSON Lines file and
 * kept in memory so the `/log` command can print them on demand.
 */

import fs from "node:fs";
import path from "node:path";
import chalk from "chalk";
import { config } from "./config.js";

/** Message travelling from this host to an MCP server. */
export const OUTGOING = "->";
/** Message travelling from an MCP server back to this host. */
export const INCOMING = "<-";

/** @type {Array<object>} In-memory copy of every entry recorded this session. */
const entries = [];

/** Whether MCP messages are echoed to the terminal; toggled by `/log`. */
let echoToConsole = config.showMcpLog;

/** Lazily created write stream, so a session that never runs gets no file. */
let stream = null;

/** @type {string} Path of the session log file, filled in on first write. */
let logFilePath = "";

/**
 * Opens the session log file the first time something is recorded.
 *
 * @returns {fs.WriteStream}
 */
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

/**
 * Records one JSON-RPC message.
 *
 * @param {object} params
 * @param {string} params.direction   OUTGOING or INCOMING.
 * @param {string} params.server      Logical name of the MCP server.
 * @param {string} params.transport   "stdio" or "http".
 * @param {object} params.message     The raw JSON-RPC message.
 */
export function logMcp({ direction, server, transport, message }) {
  const entry = {
    timestamp: new Date().toISOString(),
    direction,
    server,
    transport,
    // Convenience fields lifted out of the payload so the log is scannable
    // without having to read the full JSON on every line.
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

/**
 * Classifies a JSON-RPC message the same way the Wireshark analysis does:
 * a request carries an id and a method, a notification carries a method but
 * no id, and a response carries an id and either a result or an error.
 *
 * @param {object} message
 * @returns {"request"|"notification"|"response"|"error"|"unknown"}
 */
function classify(message) {
  if (message.method !== undefined) {
    return message.id === undefined ? "notification" : "request";
  }
  if (message.error !== undefined) return "error";
  if (message.result !== undefined) return "response";
  return "unknown";
}

/**
 * Renders a single entry as one dimmed terminal line.
 *
 * @param {object} entry
 * @returns {string}
 */
function formatEntry(entry) {
  const time = entry.timestamp.slice(11, 23);
  const arrow = entry.direction === OUTGOING ? chalk.cyan("->") : chalk.green("<-");
  const label = entry.method ?? `id=${entry.id}`;
  const payload = JSON.stringify(entry.message);
  return chalk.dim(
    `  ${time} ${arrow} ${entry.server} [${entry.transport}] ${entry.kind} ${label} ${payload}`,
  );
}

/**
 * Prints the recorded entries, most recent last.
 *
 * @param {number} [limit] How many of the latest entries to show; all if omitted.
 */
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

/**
 * Turns the live terminal echo on or off.
 *
 * @param {boolean} [value] Explicit state; flips the current one if omitted.
 * @returns {boolean} The resulting state.
 */
export function setEcho(value) {
  echoToConsole = value === undefined ? !echoToConsole : value;
  return echoToConsole;
}

/** @returns {number} How many MCP messages have been recorded. */
export function entryCount() {
  return entries.length;
}

/** @returns {string} Path of the session log file ("" until the first write). */
export function currentLogFile() {
  return logFilePath;
}
