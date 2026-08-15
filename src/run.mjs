import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { assertImageExists } from "./build.mjs";
import { preflightHostCodex, createHostCodexRuntime } from "./codex-host.mjs";
import { loadProjectConfig } from "./config.mjs";
import { CONFIG_DIR } from "./constants.mjs";
import { assertReadyLabel } from "./github.mjs";
import {
  detectProjectSetup,
  loadProjectEnv,
  requireGhToken,
  resolveGitRoot,
} from "./project.mjs";
import { runWorkflow } from "./workflows.mjs";

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

/** @param {string} startDirectory */
export async function runConfiguredProject(startDirectory) {
  const cwd = await resolveGitRoot(startDirectory);
  const config = await loadProjectConfig(cwd);
  await assertNoProjectApiKeys(cwd);
  const ghToken = await requireGhToken(cwd);
  const env = await loadProjectEnv(cwd);

  await Promise.all([
    preflightHostCodex({ cwd, config }),
    assertReadyLabel({ cwd, env: { ...env, GH_TOKEN: ghToken } }),
    assertImageExists({ cwd, config }),
  ]);

  const setup = await detectProjectSetup(cwd);
  const runtime = createHostCodexRuntime({ cwd, config, ghToken });
  return runWorkflow({ cwd, config, runtime, setup });
}
