// Runtime configuration. Everything comes from environment variables so the same image runs
// as a private single-household install or as the public hosted demo.
//
// The one-line provider switch is LLM_PROVIDER:
//   LLM_PROVIDER=nebius   -> NVIDIA Nemotron on Nebius Token Factory (needs NEBIUS_API_KEY)
//   LLM_PROVIDER=mock     -> deterministic offline provider (tests, development without a key)
//   LLM_PROVIDER=auto     -> nebius when a key is present, otherwise mock (default)
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));

const DEFAULTS = {
  baseUrl: "https://api.tokenfactory.nebius.com/v1/",
  // Fast tier: every note capture and every quick answer. Deep tier: weekly reasoning.
  fastModel: "nvidia/nemotron-3-super-120b-a12b",
  deepModel: "nvidia/Nemotron-3-Ultra-550b-a55b",
};

function readKeyFile(path) {
  // Local development only: lets the owner keep the key in the keys folder instead of an env
  // var. The value is read into memory and never logged.
  try {
    const data = JSON.parse(readFileSync(path, "utf8"));
    const key = data?.nebius?.api_key;
    const tavily = data?.tavily?.api_key;
    return { nebius: typeof key === "string" && key.length > 8 ? key : null, tavily: typeof tavily === "string" && tavily.length > 8 ? tavily : null };
  } catch {
    return { nebius: null, tavily: null };
  }
}

export function loadConfig(env = process.env) {
  let apiKey = env.NEBIUS_API_KEY || null;
  let tavilyKey = env.TAVILY_API_KEY || null;
  const keysFile = env.HEARTH_KEYS_FILE || (env.HEARTH_USE_LOCAL_KEYS === "1" ? join(homedir(), ".ruicodex-keys", "hackathons-2026.json") : null);
  if (keysFile && existsSync(keysFile)) {
    const k = readKeyFile(keysFile);
    apiKey = apiKey || k.nebius;
    tavilyKey = tavilyKey || k.tavily;
  }

  const wanted = (env.LLM_PROVIDER || "auto").toLowerCase();
  const provider = wanted === "auto" ? (apiKey ? "nebius" : "mock") : wanted;
  if (provider === "nebius" && !apiKey) throw new Error("LLM_PROVIDER=nebius but no NEBIUS_API_KEY is configured");

  const mode = (env.HEARTH_MODE || "demo").toLowerCase(); // demo | private
  return {
    port: Number(env.PORT || 8080),
    host: env.HOST || "0.0.0.0",
    mode,
    dataDir: resolve(env.HEARTH_DATA_DIR || join(ROOT, "data")),
    vaultKey: env.HEARTH_VAULT_KEY || null,
    trustProxyHeader: (env.TRUST_PROXY_HEADER || "").toLowerCase() || null,
    timezone: env.HEARTH_TIMEZONE || "Europe/Brussels",
    llm: {
      provider,
      apiKey,
      baseUrl: env.NEBIUS_BASE_URL || DEFAULTS.baseUrl,
      fastModel: env.HEARTH_FAST_MODEL || DEFAULTS.fastModel,
      deepModel: env.HEARTH_DEEP_MODEL || DEFAULTS.deepModel,
      timeoutMs: Number(env.HEARTH_LLM_TIMEOUT_MS || 90_000),
      // Nemotron 3 is a hybrid reasoning model. Captures do not need a visible chain of
      // thought, so the fast tier asks for thinking off; the deep tier keeps it on.
      fastThinking: env.HEARTH_FAST_THINKING === "on",
      deepThinking: env.HEARTH_DEEP_THINKING !== "off",
    },
    tavilyKey,
    limits: {
      // Credit protection for the public demo: per visitor sandbox and per day overall.
      callsPerSession: Number(env.HEARTH_CALLS_PER_SESSION || 40),
      callsPerDay: Number(env.HEARTH_CALLS_PER_DAY || 1500),
      sessionTtlMinutes: Number(env.HEARTH_SESSION_TTL_MIN || 180),
      maxSessions: Number(env.HEARTH_MAX_SESSIONS || 500),
    },
  };
}

// A description safe to show in the UI and logs: no key material, ever.
export function publicConfig(config) {
  return {
    mode: config.mode,
    provider: config.llm.provider,
    baseUrl: config.llm.provider === "nebius" ? config.llm.baseUrl : null,
    fastModel: config.llm.fastModel,
    deepModel: config.llm.deepModel,
    tavily: Boolean(config.tavilyKey),
    timezone: config.timezone,
  };
}
