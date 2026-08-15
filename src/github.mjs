import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ISSUE_LABEL } from "./constants.mjs";

const execFileAsync = promisify(execFile);

/** @param {NodeJS.ProcessEnv} env */
function githubEnv(env) {
  return { ...env, GH_TOKEN: env.GH_TOKEN, GITHUB_TOKEN: env.GH_TOKEN };
}

/**
 * @param {object} options
 * @param {string} options.cwd
 * @param {NodeJS.ProcessEnv} options.env
 * @param {(file: string, args: string[], options: object) => Promise<{stdout?: string}>} [options.exec]
 */
export async function hasReadyLabel({ cwd, env, exec = execFileAsync }) {
  const result = await exec("gh", ["label", "list", "--limit", "1000", "--json", "name"], {
    cwd,
    env: githubEnv(env),
  });
  const labels = /** @type {{name?: string}[]} */ (
    JSON.parse(result.stdout || "[]")
  );
  return labels.some(
    (entry) => typeof entry?.name === "string" && entry.name.toLowerCase() === ISSUE_LABEL,
  );
}

/** @param {Parameters<typeof hasReadyLabel>[0]} options */
export async function assertReadyLabel(options) {
  if (!(await hasReadyLabel(options))) {
    throw new Error(
      `GitHub label '${ISSUE_LABEL}' does not exist. Run 'sandcastle-for-agent configure --create-label'.`,
    );
  }
}

/**
 * @param {object} options
 * @param {string} options.cwd
 * @param {NodeJS.ProcessEnv} options.env
 * @param {(file: string, args: string[], options: object) => Promise<{stdout?: string}>} [options.exec]
 */
export async function ensureReadyLabel({ cwd, env, exec = execFileAsync }) {
  if (await hasReadyLabel({ cwd, env, exec })) return false;
  await exec(
    "gh",
    [
      "label",
      "create",
      ISSUE_LABEL,
      "--description",
      "Ready for autonomous agent implementation",
      "--color",
      "0E8A16",
    ],
    { cwd, env: githubEnv(env) },
  );
  return true;
}
