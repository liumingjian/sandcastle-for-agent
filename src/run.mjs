import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertImageExists } from "./build.mjs";
import {
  preflightHostCodex,
  syncHostCodexConfig,
} from "./codex-host.mjs";
import { runStreamingCommand } from "./command.mjs";
import { loadProjectConfig } from "./config.mjs";
import { CONFIG_DIR } from "./constants.mjs";
import { assertReadyLabel } from "./github.mjs";
import {
  assertGitHead,
  loadProjectEnv,
  requireGhToken,
  resolveGitRoot,
} from "./project.mjs";

/** @param {string} cwd */
async function assertNoProjectApiKeys(cwd) {
  let source = "";
  try {
    source = await readFile(join(cwd, CONFIG_DIR, ".env"), "utf8");
  } catch {
    return;
  }
  if (/^\s*(OPENAI_API_KEY|OPENAI_KEY|CODEX_API_KEY)\s*=/m.test(source)) {
    throw new Error(
      `${CONFIG_DIR}/.env must not declare OpenAI API keys. This package uses the host Codex login only.`,
    );
  }
}

/**
 * Execute the generated upstream entrypoint with the Harness-local TypeScript
 * runner. Keeping this command separate makes the execution boundary explicit:
 * this package validates the project, then hands control to main.mts.
 * @param {object} options
 * @param {string} options.cwd
 * @param {(file: string, args: string[], options: {cwd: string, env: NodeJS.ProcessEnv}) => Promise<unknown>} [options.exec]
 */
export async function executeGeneratedMain({
  cwd,
  exec = runStreamingCommand,
}) {
  const tsxName = process.platform === "win32" ? "tsx.cmd" : "tsx";
  const tsxPath = join(cwd, CONFIG_DIR, "node_modules", ".bin", tsxName);
  try {
    await access(tsxPath);
  } catch {
    throw new Error(
      `Harness dependencies are missing. Run 'sandcastle-for-agent configure' before running.`,
    );
  }
  return exec(
    tsxPath,
    [join(cwd, CONFIG_DIR, "main.mts")],
    { cwd, env: process.env },
  );
}

/** @param {string} startDirectory */
export async function runConfiguredProject(startDirectory) {
  const cwd = await resolveGitRoot(startDirectory);
  await assertGitHead(cwd);
  const config = await loadProjectConfig(cwd);
  await assertNoProjectApiKeys(cwd);
  await syncHostCodexConfig({ cwd });
  const ghToken = await requireGhToken(cwd);
  const env = await loadProjectEnv(cwd);

  await Promise.all([
    preflightHostCodex({ cwd, config }),
    assertReadyLabel({ cwd, env: { ...env, GH_TOKEN: ghToken } }),
    assertImageExists({ cwd, config }),
  ]);

  return executeGeneratedMain({ cwd });
}
