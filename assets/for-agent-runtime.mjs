import { access, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";

const CONFIG_DIR = ".sandcastle";
const CONFIG_FILE = "for-agent.json";
const DEFAULT_MAX_PARALLEL = 5;
const hostOnlyNames = new Set(["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "[::]"]);

/** @param {string} value */
export function toContainerBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
  } catch {
    throw new Error(`Host Codex provider base URL must use http or https: ${value}`);
  }
  if (hostOnlyNames.has(url.hostname.toLowerCase())) {
    url.hostname = "host.docker.internal";
  }
  return url.toString().replace(/\/$/, value.endsWith("/") ? "/" : "");
}

/** @param {string} value */
function tomlString(value) {
  return JSON.stringify(value);
}

/** @param {string} value */
function tomlKey(value) {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : tomlString(value);
}

/** @param {string} source */
export function renderCodexConfig(source) {
  let hostConfig;
  try {
    hostConfig = /** @type {Record<string, unknown>} */ (parse(source));
  } catch (error) {
    throw new Error("Host ~/.codex/config.toml is invalid TOML.", { cause: error });
  }

  const providerId =
    typeof hostConfig.model_provider === "string"
      ? hostConfig.model_provider
      : undefined;
  const providers =
    hostConfig.model_providers &&
    typeof hostConfig.model_providers === "object" &&
    !Array.isArray(hostConfig.model_providers)
      ? /** @type {Record<string, unknown>} */ (hostConfig.model_providers)
      : {};
  const provider =
    providerId &&
    providers[providerId] &&
    typeof providers[providerId] === "object" &&
    !Array.isArray(providers[providerId])
      ? /** @type {Record<string, unknown>} */ (providers[providerId])
      : undefined;

  const lines = [];
  if (providerId) lines.push(`model_provider = ${tomlString(providerId)}`);
  if (typeof hostConfig.openai_base_url === "string") {
    lines.push(
      `openai_base_url = ${tomlString(toContainerBaseUrl(hostConfig.openai_base_url))}`,
    );
  }
  lines.push(
    "disable_response_storage = true",
    'network_access = "enabled"',
    'approval_policy = "never"',
    'sandbox_mode = "danger-full-access"',
  );

  if (providerId && provider) {
    lines.push("", `[model_providers.${tomlKey(providerId)}]`);
    for (const key of ["name", "wire_api"]) {
      if (typeof provider[key] === "string") {
        lines.push(`${key} = ${tomlString(provider[key])}`);
      }
    }
    if (typeof provider.base_url === "string") {
      lines.push(`base_url = ${tomlString(toContainerBaseUrl(provider.base_url))}`);
    }
    for (const key of [
      "requires_openai_auth",
      "supports_standalone_web_search",
      "supports_websockets",
    ]) {
      if (typeof provider[key] === "boolean") {
        lines.push(`${key} = ${String(provider[key])}`);
      }
    }
    for (const key of [
      "request_max_retries",
      "stream_idle_timeout_ms",
      "stream_max_retries",
    ]) {
      if (typeof provider[key] === "number" && Number.isFinite(provider[key])) {
        lines.push(`${key} = ${String(provider[key])}`);
      }
    }
  }

  return `${lines.join("\n")}\n`;
}

/** @param {string} source */
function parseEnv(source) {
  /** @type {Record<string, string>} */
  const result = {};
  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index < 1) continue;
    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

/** @param {string} path */
async function readOptional(path) {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

/** @param {string} path */
async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} cwd */
async function detectProjectSetup(cwd) {
  if (!(await exists(join(cwd, "package.json")))) return {};

  let command = "npm install";
  if (await exists(join(cwd, "pnpm-lock.yaml"))) command = "corepack pnpm install";
  else if (await exists(join(cwd, "yarn.lock"))) command = "corepack yarn install";
  else if (await exists(join(cwd, "bun.lock"))) command = "";

  return {
    hooks: command
      ? { sandbox: { onSandboxReady: [{ command }] } }
      : undefined,
    copyToWorktree: (await exists(join(cwd, "node_modules")))
      ? ["node_modules"]
      : undefined,
  };
}

/**
 * Load the host context consumed by the generated upstream main entrypoint.
 * The main entrypoint owns the Sandcastle provider calls and mount list.
 * @param {object} options
 * @param {string} options.cwd
 * @param {string} [options.home]
 */
export async function loadHostCodexContext({ cwd, home = homedir() }) {
  const configPath = join(cwd, CONFIG_DIR, CONFIG_FILE);
  const storedConfig = JSON.parse(await readFile(configPath, "utf8"));
  const config = {
    ...storedConfig,
    maxParallel: storedConfig.maxParallel ?? DEFAULT_MAX_PARALLEL,
  };
  const env = {
    ...process.env,
    ...parseEnv(await readOptional(join(cwd, CONFIG_DIR, ".env"))),
  };
  for (const key of ["OPENAI_API_KEY", "OPENAI_KEY", "CODEX_API_KEY"]) {
    if (env[key]) {
      throw new Error(
        `${CONFIG_DIR}/.env must not declare OpenAI API keys. This package uses the host Codex login only.`,
      );
    }
  }
  if (!env.GH_TOKEN) {
    throw new Error(`GH_TOKEN is missing. Set it in ${CONFIG_DIR}/.env.`);
  }

  const hostConfigPath = join(home, ".codex", "config.toml");
  const hostAuthPath = join(home, ".codex", "auth.json");
  const containerConfigPath = join(cwd, CONFIG_DIR, "codex-config.toml");
  const hostConfig = await readFile(hostConfigPath, "utf8");
  await access(hostAuthPath);
  await writeFile(containerConfigPath, renderCodexConfig(hostConfig));

  const agentsPath = config.loadGlobalAgents
    ? join(home, ".codex", "AGENTS.md")
    : undefined;
  if (agentsPath) await access(agentsPath);

  return {
    config,
    ghToken: env.GH_TOKEN,
    hostFiles: {
      codexConfig: containerConfigPath,
      auth: hostAuthPath,
      agents: agentsPath,
    },
    setup: await detectProjectSetup(cwd),
  };
}
