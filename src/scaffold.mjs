import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONFIG_DIR, CONFIG_FILE } from "./constants.mjs";
import { syncHostCodexConfig } from "./codex-host.mjs";
import { saveProjectConfig } from "./config.mjs";

const assetsDir = fileURLToPath(new URL("../assets", import.meta.url));

/** @type {Record<string, Record<string, string>>} */
const workflowFiles = {
  "simple-loop": { "worker.md": "prompt.md" },
  "sequential-reviewer": {
    "worker.md": "implement-prompt.md",
    "review.md": "review-prompt.md",
  },
  "parallel-planner": {
    "plan.md": "plan-prompt.md",
    "implement.md": "implement-prompt.md",
    "merge.md": "merge-prompt.md",
  },
  "parallel-planner-with-review": {
    "plan.md": "plan-prompt.md",
    "implement.md": "implement-prompt.md",
    "review.md": "review-prompt.md",
    "merge.md": "merge-prompt.md",
  },
};

/** @param {string} path */
async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {object} options
 * @param {string} options.cwd
 * @param {import("./config.mjs").ProjectConfig} options.config
 * @param {boolean} [options.allowExisting]
 * @param {string} [options.home]
 */
export async function scaffoldProject({
  cwd,
  config,
  allowExisting = false,
  home = homedir(),
}) {
  const configDir = join(cwd, CONFIG_DIR);
  if (!allowExisting && (await exists(configDir))) {
    throw new Error(
      `${CONFIG_DIR} already exists. Use 'sandcastle-for-agent configure' to update it.`,
    );
  }
  await mkdir(configDir, { recursive: true });

  await copyFile(
    join(assetsDir, "CODING_STANDARDS.md"),
    join(configDir, "CODING_STANDARDS.md"),
  );

  const files = workflowFiles[config.workflow];
  if (!files) throw new Error(`No prompt assets for workflow '${config.workflow}'.`);
  for (const [source, destination] of Object.entries(files)) {
    await copyFile(
      join(assetsDir, "prompts", source),
      join(configDir, destination),
    );
  }

  await writeFile(
    join(configDir, ".env.example"),
    "# Fine-grained GitHub token: Issues (read/write), Metadata (read)\nGH_TOKEN=\n",
  );
  await writeFile(
    join(configDir, ".gitignore"),
    ".env\nnode_modules/\ncodex-config.toml\nlogs/\nworktrees/\npatches/\ntools/\n",
  );
  await syncHostCodexConfig({ cwd, home });
  await saveProjectConfig(cwd, config);

  return {
    configPath: join(configDir, CONFIG_FILE),
    configDir,
  };
}
