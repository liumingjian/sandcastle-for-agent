import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { CONFIG_DIR } from "./constants.mjs";

const execFileAsync = promisify(execFile);

/** @param {string} cwd */
export async function resolveGitRoot(cwd) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd },
    );
    return resolve(stdout.trim());
  } catch {
    throw new Error(`Not inside a Git repository: ${cwd}`);
  }
}

/** @param {string} source */
export function parseEnv(source) {
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

/** @param {string} cwd */
export async function loadProjectEnv(cwd) {
  /** @type {Record<string, string>} */
  let fileEnv = {};
  try {
    fileEnv = parseEnv(await readFile(join(cwd, CONFIG_DIR, ".env"), "utf8"));
  } catch {
    // Process environment remains a supported source.
  }
  return { ...process.env, ...fileEnv };
}

/** @param {string} cwd */
export async function requireGhToken(cwd) {
  const env = await loadProjectEnv(cwd);
  const token = env.GH_TOKEN;
  if (!token) {
    throw new Error(
      `GH_TOKEN is missing. Set it in ${CONFIG_DIR}/.env or the process environment.`,
    );
  }
  return token;
}

/** @param {string} cwd */
export function projectName(cwd) {
  return basename(resolve(cwd));
}

/** @param {string} cwd */
export async function detectProjectSetup(cwd) {
  /** @param {string} name */
  const exists = async (name) => {
    try {
      await readFile(join(cwd, name));
      return true;
    } catch {
      return false;
    }
  };
  if (!(await exists("package.json"))) return {};

  let command = "npm install";
  if (await exists("pnpm-lock.yaml")) command = "corepack pnpm install";
  else if (await exists("yarn.lock")) command = "corepack yarn install";
  else if (await exists("bun.lock")) command = "";

  const nodeModules = await (async () => {
    try {
      await access(join(cwd, "node_modules"));
      return true;
    } catch {
      return false;
    }
  })();

  return {
    hooks: command
      ? { sandbox: { onSandboxReady: [{ command }] } }
      : undefined,
    copyToWorktree: nodeModules ? ["node_modules"] : undefined,
  };
}
