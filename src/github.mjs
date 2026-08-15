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
export async function getReadyLabelWarning(options) {
  try {
    if (await hasReadyLabel(options)) return undefined;
    return `GitHub label '${ISSUE_LABEL}' does not exist. Initialization will continue; create the label and apply it to the open issues you want processed before running.`;
  } catch {
    return `Could not verify GitHub label '${ISSUE_LABEL}'. Initialization will continue; make sure the label exists and is applied to the open issues you want processed before running.`;
  }
}

/** @param {Parameters<typeof hasReadyLabel>[0]} options */
export async function assertReadyLabel(options) {
  if (!(await hasReadyLabel(options))) {
    throw new Error(
      `GitHub label '${ISSUE_LABEL}' does not exist. Create it in the repository before running.`,
    );
  }
}
