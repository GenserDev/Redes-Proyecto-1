/**
 * Configuration loader.
 *
 * Reads the .env file once at startup and exposes a plain object with the
 * settings the rest of the application needs. Keeping every environment
 * lookup here means no other module has to touch `process.env`.
 */

import "dotenv/config";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Absolute path to the repository root (this file lives in <root>/src). */
export const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

/**
 * Reads an environment variable, falling back to a default when it is unset
 * or blank. Blank is treated as unset because a key left as `FOO=` in .env is
 * almost always a mistake rather than an intentional empty string.
 *
 * @param {string} name
 * @param {string} [fallback]
 * @returns {string}
 */
function env(name, fallback = "") {
  const value = process.env[name];
  return value === undefined || value.trim() === "" ? fallback : value.trim();
}

/**
 * Reads a boolean environment variable. Accepts "true"/"1" as true.
 *
 * @param {string} name
 * @param {boolean} fallback
 * @returns {boolean}
 */
function envBool(name, fallback) {
  const value = env(name);
  if (value === "") return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

const provider = env("LLM_PROVIDER", "groq").toLowerCase();

if (provider !== "groq" && provider !== "anthropic") {
  throw new Error(
    `LLM_PROVIDER must be "groq" or "anthropic", received "${provider}".`,
  );
}

export const config = {
  /** Which LLM backend to talk to: "groq" or "anthropic". */
  provider,

  groq: {
    apiKey: env("GROQ_API_KEY"),
    model: env("GROQ_MODEL", "llama-3.3-70b-versatile"),
    baseUrl: "https://api.groq.com/openai/v1",
  },

  anthropic: {
    apiKey: env("ANTHROPIC_API_KEY"),
    model: env("ANTHROPIC_MODEL", "claude-sonnet-4-5"),
    baseUrl: "https://api.anthropic.com/v1",
  },

  /** Conversation messages retained before the oldest ones are dropped. */
  maxHistoryMessages: Number(env("MAX_HISTORY_MESSAGES", "40")),

  /** Whether MCP traffic is echoed to the terminal (toggled with /log). */
  showMcpLog: envBool("SHOW_MCP_LOG", false),

  /** Directory where per-session JSON Lines logs are written. */
  logDir: path.join(ROOT_DIR, "logs"),
};

/**
 * Returns the API key for the active provider, throwing a message that tells
 * the user exactly which variable to fill in when it is missing.
 *
 * @returns {string}
 */
export function requireApiKey() {
  const key = config[config.provider].apiKey;
  if (!key) {
    const variable =
      config.provider === "groq" ? "GROQ_API_KEY" : "ANTHROPIC_API_KEY";
    throw new Error(
      `Missing ${variable}. Copy .env.example to .env and fill it in.`,
    );
  }
  return key;
}
