import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { withoutApiKeyEnv } from "./codex-host.mjs";
import { runStreamingCommand } from "./command.mjs";
import {
  CONFIG_DIR,
  UPSTREAM_SANDCASTLE_VERSION,
} from "./constants.mjs";

const execFileAsync = promisify(execFile);
const TEMPLATE_DEPENDENCIES = ["tsx@4.21.0", "zod@4.4.3"];

/** @param {string} path @param {(path: string) => Promise<unknown>} accessFile */
async function exists(path, accessFile) {
  try {
    await accessFile(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object} options
 * @param {string} options.cwd
 * @param {(path: string) => Promise<unknown>} [options.accessFile]
 */
export async function assertInitializationTarget({ cwd, accessFile = access }) {
  if (await exists(join(cwd, CONFIG_DIR), accessFile)) {
    throw new Error(
      `${CONFIG_DIR} already exists. Use 'sandcastle-for-agent configure' to update it.`,
    );
  }
}

/**
 * @param {object} options
 * @param {string} options.cwd
 * @param {(path: string) => Promise<unknown>} [options.accessFile]
 */
export async function assertConfigurationTarget({ cwd, accessFile = access }) {
  if (!(await exists(join(cwd, CONFIG_DIR), accessFile))) {
    throw new Error(
      `${CONFIG_DIR} does not exist. Run 'sandcastle-for-agent init' first.`,
    );
  }
}

/**
 * Check every host capability needed by the complete initialization path before
 * package files or Sandcastle configuration are written.
 * @param {object} options
 * @param {string} options.cwd
 * @param {string} [options.home]
 * @param {(path: string) => Promise<unknown>} [options.accessFile]
 * @param {(file: string, args: string[], options: object) => Promise<unknown>} [options.exec]
 */
export async function preflightInitializer({
  cwd,
  home = homedir(),
  accessFile = access,
  exec = execFileAsync,
}) {
  const requiredCodexFiles = [
    join(home, ".codex", "config.toml"),
    join(home, ".codex", "auth.json"),
  ];
  for (const path of requiredCodexFiles) {
    try {
      await accessFile(path);
    } catch {
      throw new Error(`Required host Codex file does not exist: ${path}`);
    }
  }

  /** @type {[string, string[], string][]} */
  const checks = [
    ["npm", ["--version"], "npm"],
    ["docker", ["info", "--format", "{{.ServerVersion}}"], "Docker"],
    ["gh", ["auth", "status"], "GitHub CLI authentication"],
    ["codex", ["login", "status"], "Codex login"],
  ];
  for (const [file, args, label] of checks) {
    try {
      await exec(file, args, {
        cwd,
        env: file === "codex" ? withoutApiKeyEnv(process.env) : process.env,
      });
    } catch (error) {
      const detail =
        error && typeof error === "object" && "stderr" in error
          ? String(error.stderr).trim()
          : "";
      throw new Error(
        `${label} check failed.${detail ? ` ${detail}` : ""}`,
        { cause: error },
      );
    }
  }
}

/**
 * Install the pinned upstream CLI into the target repository and use that local
 * binary to generate the standard Codex/Docker/GitHub Issues harness.
 * @param {object} options
 * @param {string} options.cwd
 * @param {(path: string) => Promise<unknown>} [options.accessFile]
 * @param {(file: string, args: string[], options: {cwd: string}) => Promise<unknown>} [options.exec]
 */
export async function initializeUpstreamSandcastle({
  cwd,
  accessFile = access,
  exec = runStreamingCommand,
}) {
  await assertInitializationTarget({ cwd, accessFile });

  const createdPackageJson = !(await exists(join(cwd, "package.json"), accessFile));
  if (createdPackageJson) {
    await exec("npm", ["init", "--yes"], { cwd });
  }

  await exec(
    "npm",
    [
      "install",
      "--save-dev",
      "--save-exact",
      `@ai-hero/sandcastle@${UPSTREAM_SANDCASTLE_VERSION}`,
      ...TEMPLATE_DEPENDENCIES,
    ],
    { cwd },
  );

  await exec(
    "npm",
    [
      "exec",
      "--",
      "sandcastle",
      "init",
      "--agent",
      "codex",
      "--sandbox",
      "docker",
      "--issue-tracker",
      "github-issues",
      "--template",
      "parallel-planner-with-review",
      "--create-label",
      "false",
      "--install-template-deps",
      "false",
      "--build-image",
      "false",
    ],
    { cwd },
  );

  return { createdPackageJson, version: UPSTREAM_SANDCASTLE_VERSION };
}
