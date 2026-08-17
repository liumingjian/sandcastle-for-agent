import { access, copyFile, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runStreamingCommand } from "./command.mjs";
import { resolveUpstreamCliPath } from "./bootstrap.mjs";
import { CONFIG_DIR } from "./constants.mjs";
import { getWorkflow } from "./config.mjs";

const assetsDir = fileURLToPath(new URL("../assets", import.meta.url));
const MANAGED_MARKER = "// sandcastle-for-agent managed main entry";
const WORKFLOW_MARKER = "// sandcastle-for-agent workflow: ";
const ADAPTER_MARKER = "// sandcastle-for-agent inline host adapter: v1";
const MAIN_FILENAMES = ["main.ts", "main.mts"];

/** @param {string} source */
function managedWorkflow(source) {
  return source.match(/^\/\/ sandcastle-for-agent workflow: (.+)$/m)?.[1];
}

/** @param {string} source @param {string} workflow */
export function adaptUpstreamMain(source, workflow) {
  const stages = getWorkflow(workflow).stages;
  if (source.includes(MANAGED_MARKER)) {
    if (
      source.includes(ADAPTER_MARKER) &&
      managedWorkflow(source) === workflow
    ) {
      return source;
    }
    throw new Error(
      `Managed ${CONFIG_DIR}/main entry is stale. Run 'sandcastle-for-agent build' to regenerate it.`,
    );
  }

  const codexFactory = source.includes("import * as sandcastle")
    ? "sandcastle.codex"
    : "codex";
  let content = source.replace(/\bdocker\(\)/g, "sandbox()");

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
      return `agent("${stage}")`;
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
    'import { loadHostCodexContext } from "./for-agent-runtime.mjs";',
    "",
    "const { config, ghToken, hostFiles, setup } = await loadHostCodexContext({ cwd: process.cwd() });",
    "",
    "const mounts = [",
    "  { hostPath: hostFiles.codexConfig, sandboxPath: \"~/.codex/config.toml\", readonly: true },",
    "  { hostPath: hostFiles.auth, sandboxPath: \"~/.codex/auth.json\", readonly: true },",
    "  ...(hostFiles.agents ? [{ hostPath: hostFiles.agents, sandboxPath: \"~/.codex/AGENTS.md\", readonly: true }] : []),",
    "];",
    "",
    "const sandbox = () => docker({",
    "  imageName: config.imageName,",
    "  mounts,",
    "  env: { GH_TOKEN: ghToken },",
    "});",
    "",
    "const agent = (stage) => {",
    "  const stageConfig = config.stages?.[stage];",
    "  if (!stageConfig) throw new Error(`No model configured for stage '${stage}'.`);",
    `  return ${codexFactory}(stageConfig.model, { effort: stageConfig.effort });`,
    "};",
    "",
  );

  return `${MANAGED_MARKER}\n${WORKFLOW_MARKER}${workflow}\n${ADAPTER_MARKER}\n// The orchestration below remains the upstream Sandcastle template.\n${lines.join("\n")}`;
}

/** @param {string} cwd */
async function preferredMainFilename(cwd) {
  try {
    const packageJson = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
    return packageJson.type === "module" ? "main.ts" : "main.mts";
  } catch {
    return "main.mts";
  }
}

/** @param {string} cwd */
export async function resolveMainEntry(cwd) {
  const preferred = await preferredMainFilename(cwd);
  const candidates = [preferred, ...MAIN_FILENAMES.filter((name) => name !== preferred)];
  for (const filename of candidates) {
    const path = join(cwd, CONFIG_DIR, filename);
    try {
      await access(path);
      return { filename, path };
    } catch {
      // Try the other filename used by the upstream scaffold.
    }
  }
  throw new Error(
    `Missing ${CONFIG_DIR}/main.ts or ${CONFIG_DIR}/main.mts. Run 'sandcastle-for-agent init' first.`,
  );
}

/** @param {string} cwd @param {string} workflow */
export async function assertMainEntryReady(cwd, workflow) {
  const entry = await resolveMainEntry(cwd);
  const source = await readFile(entry.path, "utf8");
  if (
    !source.includes(ADAPTER_MARKER) ||
    managedWorkflow(source) !== workflow
  ) {
    throw new Error(
      `The generated ${CONFIG_DIR}/${entry.filename} is not built for workflow '${workflow}'. Run 'sandcastle-for-agent build' first.`,
    );
  }
  return entry;
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
export async function rewriteMainEntry({
  cwd,
  workflow,
  refresh = false,
  exec = runStreamingCommand,
}) {
  const configDir = join(cwd, CONFIG_DIR);
  const mainEntry = await resolveMainEntry(cwd);
  const current = await readFile(mainEntry.path, "utf8");
  const source =
    refresh ? await loadFreshUpstreamMain({ workflow, exec }) : current;
  await writeFile(mainEntry.path, adaptUpstreamMain(source, workflow), "utf8");
  await copyFile(
    join(assetsDir, "for-agent-runtime.mjs"),
    join(configDir, "for-agent-runtime.mjs"),
  );
  return mainEntry;
}
