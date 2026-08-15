import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { codex } from "@ai-hero/sandcastle";
import { docker } from "@ai-hero/sandcastle/sandboxes/docker";
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

/** @param {string} baseUrl */
export function renderCodexConfig(baseUrl) {
  return `model_provider = "OpenAI"\n` +
    `disable_response_storage = true\n` +
    `network_access = "enabled"\n` +
    `approval_policy = "never"\n` +
    `sandbox_mode = "danger-full-access"\n\n` +
    `[model_providers.OpenAI]\n` +
    `name = "OpenAI"\n` +
    `base_url = ${tomlString(baseUrl)}\n` +
    `wire_api = "responses"\n` +
    `requires_openai_auth = true\n`;
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
      return codex(stageConfig.model, { effort: stageConfig.effort });
    },
  };
}
