// Loads the .env file and mcp-servers.json once at startup.

import "dotenv/config";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

// A key left as `FOO=` in .env is almost always a mistake, so a blank value is
// treated as unset rather than as an intentional empty string.
function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

function envBool(name, fallback) {
  const value = env(name);
  if (value === "") return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

const PROVIDERS = ["groq", "anthropic", "gemini"];

const provider = env("LLM_PROVIDER", "gemini").toLowerCase();

if (!PROVIDERS.includes(provider)) {
  throw new Error(
    `LLM_PROVIDER must be one of ${PROVIDERS.join(", ")}; received "${provider}".`,
  );
}

export const config = {
  provider,

  groq: {
    apiKey: env("GROQ_API_KEY"),
    model: env("GROQ_MODEL", "openai/gpt-oss-120b"),
    baseUrl: "https://api.groq.com/openai/v1",
  },

  anthropic: {
    apiKey: env("ANTHROPIC_API_KEY"),
    model: env("ANTHROPIC_MODEL", "claude-sonnet-4-5"),
    baseUrl: "https://api.anthropic.com/v1",
  },

  gemini: {
    apiKey: env("GEMINI_API_KEY"),
    model: env("GEMINI_MODEL", "gemini-3.7-flash"),
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
  },

  maxHistoryMessages: Number(env("MAX_HISTORY_MESSAGES", "40")),
  showMcpLog: envBool("SHOW_MCP_LOG", false),
  logDir: path.join(ROOT_DIR, "logs"),
};

export function loadServerConfigs() {
  const file = path.join(ROOT_DIR, "mcp-servers.json");

  if (!fs.existsSync(file)) return [];

  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  const servers = parsed.servers ?? [];

  return servers.map((server) => ({
    ...server,
    args: (server.args ?? []).map(expandRoot),
    cwd: server.cwd ? expandRoot(server.cwd) : undefined,
    url: server.url ? expandRoot(server.url) : undefined,
  }));
}

// Paths in mcp-servers.json use a {{ROOT}} placeholder so the file stays
// portable across machines.
function expandRoot(value) {
  return value.replaceAll("{{ROOT}}", ROOT_DIR);
}

export function requireApiKey() {
  const key = config[config.provider].apiKey;
  if (!key) {
    throw new Error(
      `Missing ${config.provider.toUpperCase()}_API_KEY. Copy .env.example to .env and fill it in.`,
    );
  }
  return key;
}
