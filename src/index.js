#!/usr/bin/env node
/**
 * Terminal user interface and entry point.
 *
 * A read-eval-print loop built on Node's own `readline`: it reads a line,
 * routes it either to a slash command or to the agent, and prints the reply.
 *
 * Colour choices follow the HCI guidance from the course: one hue per role so
 * the eye can separate speakers at a glance, MCP traffic dimmed so it never
 * competes with the conversation, and red reserved exclusively for errors.
 */

import readline from "node:readline";
import chalk from "chalk";
import { describeModel } from "./llm.js";
import { Agent } from "./agent.js";
import { printLog, setEcho, entryCount, currentLogFile } from "./logger.js";

/** Role colours, kept in one place so the palette stays consistent. */
const ui = {
  user: chalk.cyan.bold,
  assistant: chalk.white,
  label: chalk.magenta.bold,
  meta: chalk.dim,
  error: chalk.red.bold,
  accent: chalk.yellow,
};

const agent = new Agent();

/**
 * Prints the startup banner with the active model and a hint about /help.
 */
function printBanner() {
  const line = "-".repeat(62);
  console.log(ui.label(line));
  console.log(ui.label("  MCP Chatbot") + ui.meta("  |  CC3067 Redes - Proyecto 1"));
  console.log(ui.meta(`  model: ${describeModel()}`));
  console.log(ui.meta("  type /help for commands, /exit to quit"));
  console.log(ui.label(line));
}

/**
 * Prints the list of slash commands.
 */
function printHelp() {
  const rows = [
    ["/help", "show this help"],
    ["/log [n]", "show the last n MCP messages (all if omitted)"],
    ["/log on|off", "toggle live echo of MCP traffic"],
    ["/clear", "forget the conversation history"],
    ["/exit", "quit the chatbot"],
  ];
  for (const [command, description] of rows) {
    console.log(`  ${ui.accent(command.padEnd(14))} ${ui.meta(description)}`);
  }
}

/**
 * Handles a slash command.
 *
 * @param {string} line The full input line, starting with "/".
 * @returns {boolean} True when the loop should stop.
 */
function runCommand(line) {
  const [command, ...args] = line.trim().split(/\s+/);

  switch (command) {
    case "/help":
      printHelp();
      return false;

    case "/log": {
      const argument = args[0];
      if (argument === "on" || argument === "off") {
        const enabled = setEcho(argument === "on");
        console.log(ui.meta(`  live MCP echo ${enabled ? "enabled" : "disabled"}`));
      } else {
        printLog(argument ? Number(argument) : undefined);
      }
      return false;
    }

    case "/clear":
      agent.reset();
      console.log(ui.meta("  conversation history cleared"));
      return false;

    case "/exit":
    case "/quit":
      return true;

    default:
      console.log(ui.error(`  unknown command: ${command}`));
      printHelp();
      return false;
  }
}

/**
 * Shows an animated "thinking" indicator while a request is in flight.
 *
 * @returns {() => void} Call to stop the indicator and clear the line.
 */
function startThinking() {
  const frames = ["|", "/", "-", "\\"];
  let index = 0;

  const timer = setInterval(() => {
    process.stdout.write(`\r${ui.meta(`  ${frames[index]} thinking...`)}`);
    index = (index + 1) % frames.length;
  }, 120);

  return () => {
    clearInterval(timer);
    // Overwrite the indicator so the reply starts on a clean line.
    process.stdout.write(`\r${" ".repeat(20)}\r`);
  };
}

/**
 * Runs the read-eval-print loop until the user exits.
 */
async function main() {
  printBanner();

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

  for (;;) {
    const line = (await ask(ui.user("\nyou > "))).trim();

    if (line === "") continue;

    if (line.startsWith("/")) {
      if (runCommand(line)) break;
      continue;
    }

    const stopThinking = startThinking();
    try {
      const reply = await agent.send(line);
      stopThinking();
      console.log(`${ui.label("bot >")} ${ui.assistant(reply)}`);
    } catch (error) {
      stopThinking();
      console.log(`${ui.error("error >")} ${error.message}`);
    }
  }

  rl.close();

  if (entryCount() > 0) {
    console.log(ui.meta(`\n  MCP log written to ${currentLogFile()}`));
  }
  console.log(ui.meta("  bye\n"));
}

main().catch((error) => {
  console.error(ui.error(`fatal: ${error.message}`));
  process.exit(1);
});
