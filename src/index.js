#!/usr/bin/env node
// Terminal UI and entry point. One hue per role so the eye separates
// speakers at a glance, MCP traffic dimmed so it never competes with the
// conversation, and red reserved exclusively for errors.

import readline from "node:readline";
import chalk from "chalk";
import { loadServerConfigs } from "./config.js";
import { describeModel } from "./llm.js";
import { Agent } from "./agent.js";
import { McpManager } from "./mcp/manager.js";
import { printLog, setEcho, entryCount, currentLogFile } from "./logger.js";

const ui = {
  user: chalk.cyan.bold,
  assistant: chalk.white,
  label: chalk.magenta.bold,
  meta: chalk.dim,
  error: chalk.red.bold,
  accent: chalk.yellow,
  ok: chalk.green,
};

function printBanner() {
  const line = "-".repeat(62);
  console.log(ui.label(line));
  console.log(ui.label("  MCP Chatbot") + ui.meta("  |  CC3067 Redes - Proyecto 1"));
  console.log(ui.meta(`  model: ${describeModel()}`));
  console.log(ui.meta("  type /help for commands, /exit to quit"));
  console.log(ui.label(line));
}

function printHelp() {
  const rows = [
    ["/help", "show this help"],
    ["/servers", "show the connected MCP servers"],
    ["/tools", "list every tool available to the model"],
    ["/log [n]", "show the last n MCP messages (all if omitted)"],
    ["/log on|off", "toggle live echo of MCP traffic"],
    ["/clear", "forget the conversation history"],
    ["/exit", "quit the chatbot"],
  ];
  for (const [command, description] of rows) {
    console.log(`  ${ui.accent(command.padEnd(14))} ${ui.meta(description)}`);
  }
}

function printServers(manager) {
  const rows = manager.status();

  if (rows.length === 0) {
    console.log(ui.meta("  no MCP servers configured (see mcp-servers.json)"));
    return;
  }

  for (const row of rows) {
    const state = row.connected ? ui.ok("connected") : ui.error("failed");
    const version = row.serverInfo
      ? `${row.serverInfo.name} ${row.serverInfo.version ?? ""}`.trim()
      : "-";
    console.log(`  ${ui.accent(row.name.padEnd(12))} ${state}`);
    console.log(ui.meta(`    transport: ${row.transport}   tools: ${row.toolCount}`));
    console.log(ui.meta(`    server:    ${version}`));
    console.log(ui.meta(`    target:    ${row.target}`));
  }
}

function printTools(manager) {
  const tools = manager.catalogue;

  if (tools.length === 0) {
    console.log(ui.meta("  no tools available"));
    return;
  }

  let currentServer = "";
  for (const tool of tools) {
    if (tool.server !== currentServer) {
      currentServer = tool.server;
      console.log(`  ${ui.accent(currentServer)}`);
    }
    const summary = tool.description.split("\n")[0].slice(0, 70);
    console.log(`    ${tool.name.padEnd(38)} ${ui.meta(summary)}`);
  }
  console.log(ui.meta(`  ${tools.length} tools available`));
}

function runCommand(line, agent, manager) {
  const [command, ...args] = line.trim().split(/\s+/);

  switch (command) {
    case "/help":
      printHelp();
      return false;

    case "/servers":
      printServers(manager);
      return false;

    case "/tools":
      printTools(manager);
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

function reportToolEvent(event) {
  if (event.phase === "start") {
    const args = JSON.stringify(event.args ?? {});
    console.log(
      `  ${ui.accent("tool")} ${event.name} ${ui.meta(args.slice(0, 120))}`,
    );
    return;
  }

  const status = event.isError ? ui.error("error") : ui.ok("ok");
  const preview = event.text.replace(/\s+/g, " ").slice(0, 100);
  console.log(`       ${status} ${ui.meta(preview)}`);
}

async function main() {
  printBanner();

  const manager = new McpManager(loadServerConfigs());

  process.stdout.write(ui.meta("  starting MCP servers..."));
  await manager.connectAll();
  process.stdout.write("\r");

  const connected = manager.status().filter((row) => row.connected).length;
  console.log(
    ui.meta(
      `  ${connected} MCP server(s) connected, ${manager.catalogue.length} tools available`,
    ),
  );
  for (const failure of manager.failures) {
    console.log(ui.error(`  ${failure.name}: ${failure.error}`));
  }

  const agent = new Agent({ manager, onToolEvent: reportToolEvent });

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question) => new Promise((resolve) => rl.question(question, resolve));

  for (;;) {
    const line = (await ask(ui.user("\nyou > "))).trim();

    if (line === "") continue;

    if (line.startsWith("/")) {
      if (runCommand(line, agent, manager)) break;
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
  manager.close();

  if (entryCount() > 0) {
    console.log(ui.meta(`\n  MCP log written to ${currentLogFile()}`));
  }
  console.log(ui.meta("  bye\n"));
}

main().catch((error) => {
  console.error(ui.error(`fatal: ${error.message}`));
  process.exit(1);
});
