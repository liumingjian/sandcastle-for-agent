import { copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runStreamingCommand } from "./command.mjs";
import { resolveUpstreamCliPath } from "./bootstrap.mjs";
import { CONFIG_DIR } from "./constants.mjs";
import { getWorkflow } from "./config.mjs";

const assetsDir = fileURLToPath(new URL("../assets", import.meta.url));
const MANAGED_MARKER = "// sandcastle-for-agent managed main.mts";
const WORKFLOW_MARKER = "// sandcastle-for-agent workflow: ";

/** @param {string} source */
function managedWorkflow(source) {
  return source.match(/^\/\/ sandcastle-for-agent workflow: (.+)$/m)?.[1];
}

/** @param {string} source @param {string} workflow */
export function adaptUpstreamMain(source, workflow) {
  const stages = getWorkflow(workflow).stages;
  if (source.includes(MANAGED_MARKER)) {
    if (managedWorkflow(source) === workflow) return source;
    throw new Error(`Managed ${CONFIG_DIR}/main.mts belongs to another workflow.`);
  }

  let content = source
    .replace(
      'import { run, codex } from "@ai-hero/sandcastle";\n',
      'import { run } from "@ai-hero/sandcastle";\n',
    )
    .replace(
      /import \{ docker \} from "@ai-hero\/sandcastle\/sandboxes\/docker";\n/g,
      "",
    )
    .replace(/\bdocker\(\)/g, "runtime.sandbox()");

  content = content
    .replace(
      /const hooks = \{\n  sandbox: \{ onSandboxReady: \[\{ command: "npm install" \}\] \},\n\};/g,
      "const hooks = setup.hooks;",
    )
    .replace(
      /const copyToWorktree = \["node_modules"\];/g,
      "const copyToWorktree = setup.copyToWorktree;",
    )
    .replace(
      /hooks:\s*\{\s*sandbox:\s*\{[\s\S]*?onSandboxReady:\s*\[\{ command: "npm install" \}\],\s*\},\s*\},/g,
      "hooks: setup.hooks,",
    )
    .replace(
      /copyToWorktree: \["node_modules"\],/g,
      "...(setup.copyToWorktree ? { copyToWorktree: setup.copyToWorktree } : {}),",
    );

  let stageIndex = 0;
  content = content.replace(
    /(?:sandcastle\.)?codex\(\s*["'][^"']*["']\s*\)/g,
    () => {
      const stage = stages[stageIndex++];
      if (!stage) {
        throw new Error(
          `Upstream ${CONFIG_DIR}/main.mts has more Codex calls than workflow '${workflow}'.`,
        );
      }
      return `runtime.agent("${stage}")`;
    },
  );
  if (stageIndex !== stages.length) {
    throw new Error(
      `Upstream ${CONFIG_DIR}/main.mts has ${stageIndex} Codex calls; workflow '${workflow}' requires ${stages.length}.`,
    );
  }

  if (workflow === "simple-loop") {
    content = content.replace(/maxIterations:\s*\d+\b/, "maxIterations: config.maxCycles");
  } else {
    content = content.replace(
      /const MAX_ITERATIONS = \d+;/,
      "const MAX_ITERATIONS = config.maxCycles;",
    );
    content = content.replace(
      /maxIterations:\s*100\b/g,
      "maxIterations: config.implementerMaxIterations",
    );
  }

  const lines = content.split("\n");
  const lastImport = lines.reduce(
    (index, line, current) => (line.startsWith("import ") ? current : index),
    -1,
  );
  if (lastImport < 0) {
    throw new Error(`Could not find imports in ${CONFIG_DIR}/main.mts.`);
  }
  lines.splice(
    lastImport + 1,
    0,
    'import { createHostCodexRuntime } from "./for-agent-runtime.mjs";',
    "",
    "const { config, runtime, setup } = await createHostCodexRuntime({ cwd: process.cwd() });",
    "",
  );

  return `${MANAGED_MARKER}\n${WORKFLOW_MARKER}${workflow}\n// The orchestration below remains the upstream Sandcastle template.\n${lines.join("\n")}`;
}

/**
 * @param {object} options
 * @param {string} options.workflow
 * @param {(file: string, args: string[], options: {cwd: string}) => Promise<unknown>} options.exec
 */
async function loadFreshUpstreamMain({ workflow, exec }) {
  const temporaryRepo = await mkdtemp(join(tmpdir(), "sandcastle-for-agent-main-"));
  try {
    await exec(
      process.execPath,
      [
        resolveUpstreamCliPath(),
        "init",
        "--agent",
        "codex",
        "--sandbox",
        "docker",
        "--issue-tracker",
        "github-issues",
        "--template",
        workflow,
        "--create-label",
        "false",
        "--install-template-deps",
        "false",
        "--build-image",
        "false",
      ],
      { cwd: temporaryRepo },
    );
    return await readFile(join(temporaryRepo, CONFIG_DIR, "main.mts"), "utf8");
  } finally {
    await rm(temporaryRepo, { recursive: true, force: true });
  }
}

/**
 * Replace the generated upstream entrypoint with a thin host-Codex adapter,
 * while leaving its orchestration and sandbox lifecycle intact.
 * @param {object} options
 * @param {string} options.cwd
 * @param {string} options.workflow
 * @param {boolean} [options.refresh]
 * @param {(file: string, args: string[], options: {cwd: string}) => Promise<unknown>} [options.exec]
 */
export async function rewriteMainMts({
  cwd,
  workflow,
  refresh = false,
  exec = runStreamingCommand,
}) {
  const configDir = join(cwd, CONFIG_DIR);
  const mainPath = join(configDir, "main.mts");
  const current = await readFile(mainPath, "utf8");
  const source =
    refresh ||
    (current.includes(MANAGED_MARKER) && managedWorkflow(current) !== workflow)
      ? await loadFreshUpstreamMain({ workflow, exec })
      : current;
  await writeFile(mainPath, adaptUpstreamMain(source, workflow), "utf8");
  await copyFile(
    join(assetsDir, "for-agent-runtime.mjs"),
    join(configDir, "for-agent-runtime.mjs"),
  );
  return mainPath;
}
