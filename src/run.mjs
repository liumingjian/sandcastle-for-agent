import { readFile } from "node:fs/promises";
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
import { assertMainEntryReady, resolveMainEntry } from "./main-rewrite.mjs";
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
 * Execute the generated upstream entrypoint directly. Keeping this command
 * separate makes the execution boundary explicit: this package validates the
 * project, then hands control to the upstream main entrypoint.
 * @param {object} options
 * @param {string} options.cwd
 * @param {(file: string, args: string[], options: {cwd: string, env: NodeJS.ProcessEnv}) => Promise<unknown>} [options.exec]
 */
export async function executeGeneratedMain({
  cwd,
  exec = runStreamingCommand,
}) {
  const mainEntry = await resolveMainEntry(cwd);
  const npx = process.platform === "win32" ? "npx.cmd" : "npx";
  return exec(
    npx,
    ["tsx", join(CONFIG_DIR, mainEntry.filename)],
    { cwd, env: process.env },
  );
}

/** @param {string} startDirectory */
export async function runConfiguredProject(startDirectory) {
  const cwd = await resolveGitRoot(startDirectory);
  await assertGitHead(cwd);
  const config = await loadProjectConfig(cwd);
  await assertMainEntryReady(cwd, config.workflow);
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
