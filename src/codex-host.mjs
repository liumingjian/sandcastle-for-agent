import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { codex } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
import { parse } from "smol-toml";
import { CONFIG_DIR } from "./constants.mjs";

const execFileAsync = promisify(execFile);

/** @param {NodeJS.ProcessEnv} env */
export function withoutApiKeyEnv(env) {
  const clean = { ...env };
  delete clean.OPENAI_API_KEY;
  delete clean.OPENAI_KEY;
  delete clean.CODEX_API_KEY;
  return clean;
}

/** @param {string} value */
function tomlString(value) {
  return JSON.stringify(value);
}

const hostOnlyNames = new Set([
  "localhost",
  "127.0.0.1",
  "0.0.0.0",
  "[::1]",
  "[::]",
]);

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
function tomlKey(value) {
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : tomlString(value);
}

/**
 * Build a minimal container config from the host's active provider. Host MCP,
 * project trust and other machine-specific settings are intentionally excluded.
 * @param {string} source
 */
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
    'disable_response_storage = true',
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

/**
 * @param {object} options
 * @param {string} options.cwd
 * @param {string} [options.home]
 * @param {(path: string, encoding: "utf8") => Promise<string>} [options.readHostFile]
 * @param {(path: string, data: string) => Promise<unknown>} [options.writeConfig]
 */
export async function syncHostCodexConfig({
  cwd,
  home = homedir(),
  readHostFile = readFile,
  writeConfig = writeFile,
}) {
  const hostPath = join(home, ".codex", "config.toml");
  let source;
  try {
    source = await readHostFile(hostPath, "utf8");
  } catch {
    throw new Error(`Required host Codex file does not exist: ${hostPath}`);
  }
  const containerPath = join(cwd, CONFIG_DIR, "codex-config.toml");
  await writeConfig(containerPath, renderCodexConfig(source));
  return { hostPath, containerPath };
}

/**
 * @param {object} options
 * @param {string} options.cwd
 * @param {import("./config.mjs").ProjectConfig} options.config
 * @param {string} [options.home]
 */
export function getCodexMounts({ cwd, config, home = homedir() }) {
  const mounts = [
    {
      hostPath: join(cwd, CONFIG_DIR, "codex-config.toml"),
      sandboxPath: "~/.codex/config.toml",
      readonly: true,
    },
    {
      hostPath: join(home, ".codex", "auth.json"),
      sandboxPath: "~/.codex/auth.json",
      readonly: true,
    },
  ];
  if (config.loadGlobalAgents) {
    mounts.push({
      hostPath: join(home, ".codex", "AGENTS.md"),
      sandboxPath: "~/.codex/AGENTS.md",
      readonly: true,
    });
  }
  return mounts;
}

/**
 * @param {object} options
 * @param {string} options.cwd
 * @param {import("./config.mjs").ProjectConfig} options.config
 * @param {string} [options.home]
 * @param {(path: string) => Promise<unknown>} [options.accessFile]
 * @param {(file: string, args: string[], options: object) => Promise<unknown>} [options.exec]
 */
export async function preflightHostCodex({
  cwd,
  config,
  home = homedir(),
  accessFile = access,
  exec = execFileAsync,
}) {
  const required = [
    join(home, ".codex", "auth.json"),
    join(cwd, CONFIG_DIR, "codex-config.toml"),
  ];
  if (config.loadGlobalAgents) required.push(join(home, ".codex", "AGENTS.md"));
  for (const path of required) {
    try {
      await accessFile(path);
    } catch {
      throw new Error(`Required host Codex file does not exist: ${path}`);
    }
  }
  await exec("codex", ["login", "status"], {
    cwd,
    env: withoutApiKeyEnv(process.env),
  });
}

/**
 * The small interface used by every workflow. Authentication, mounts and stage
 * configuration stay behind this module.
 * @param {object} options
 * @param {string} options.cwd
 * @param {import("./config.mjs").ProjectConfig} options.config
 * @param {string} options.ghToken
 */
export function createHostCodexRuntime({ cwd, config, ghToken }) {
  const mounts = getCodexMounts({ cwd, config });
  return {
    sandbox: () => docker({ imageName: config.imageName, mounts, env: { GH_TOKEN: ghToken } }),
    /** @param {import("./config.mjs").StageName} stage */
    agent: (stage) => {
      const stageConfig = config.stages[stage];
      if (!stageConfig) throw new Error(`No model configured for stage '${stage}'.`);
      // Sandcastle 0.12 narrows this union to xhigh, but its runtime forwards
      // the value unchanged. Host Codex installations may additionally enable max.
      const options = /** @type {Parameters<typeof codex>[1]} */ (
        /** @type {unknown} */ ({ effort: stageConfig.effort })
      );
      return codex(stageConfig.model, options);
    },
  };
}
