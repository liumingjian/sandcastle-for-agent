import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ISSUE_LABEL } from "./constants.mjs";

const execFileAsync = promisify(execFile);

/** @param {NodeJS.ProcessEnv} env */
function githubEnv(env) {
  const result = { ...env };
  if (env.GH_TOKEN) {
    result.GH_TOKEN = env.GH_TOKEN;
    result.GITHUB_TOKEN = env.GH_TOKEN;
  } else {
    delete result.GH_TOKEN;
  }
  return result;
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
      `GitHub label '${ISSUE_LABEL}' does not exist. Create it in the repository before initialization.`,
    );
  }
}
