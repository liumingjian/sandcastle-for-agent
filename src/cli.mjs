#!/usr/bin/env node

import { parseArgs } from "node:util";
import * as clack from "@clack/prompts";
import { buildImage } from "./build.mjs";
import {
  createProjectConfig,
  getWorkflow,
  loadProjectConfig,
} from "./config.mjs";
import {
  DEFAULT_BASE_URL,
  EFFORTS,
  MODEL_PRESETS,
  PACKAGE_NAME,
  WORKFLOWS,
} from "./constants.mjs";
import { ensureReadyLabel } from "./github.mjs";
import {
  loadProjectEnv,
  projectName,
  resolveGitRoot,
} from "./project.mjs";
import { runConfiguredProject } from "./run.mjs";
import { scaffoldProject } from "./scaffold.mjs";

const VERSION = "0.1.0";
const isInteractive = process.stdin.isTTY === true && process.stdout.isTTY === true;

/** @type {Record<string, {type: "string" | "boolean", short?: string}>} */
const optionDefinitions = {
  workflow: { type: "string" },
  preset: { type: "string" },
  "global-agents": { type: "boolean" },
  "no-global-agents": { type: "boolean" },
  "base-url": { type: "string" },
  "image-name": { type: "string" },
  "max-cycles": { type: "string" },
  "implementer-max-iterations": { type: "string" },
  "planner-model": { type: "string" },
  "planner-effort": { type: "string" },
  "implementer-model": { type: "string" },
  "implementer-effort": { type: "string" },
  "reviewer-model": { type: "string" },
  "reviewer-effort": { type: "string" },
  "merger-model": { type: "string" },
  "merger-effort": { type: "string" },
  "create-label": { type: "boolean" },
  "no-create-label": { type: "boolean" },
  build: { type: "boolean" },
  "no-build": { type: "boolean" },
  help: { type: "boolean", short: "h" },
  version: { type: "boolean", short: "v" },
};

function printHelp() {
  console.log(`
${PACKAGE_NAME} ${VERSION}

Usage:
  sandcastle-for-agent init [options]
  sandcastle-for-agent configure [options]
  sandcastle-for-agent build
  sandcastle-for-agent run

Commands:
  init        Create a guided host-Codex configuration in the current Git repo
  configure   Replace managed prompts and update an existing configuration
  build       Build the configured Docker image
  run         Validate host Codex, GitHub label and image, then run the workflow

Options:
  --workflow <name>             ${Object.keys(WORKFLOWS).join(" | ")}
  --preset <name>               ${Object.keys(MODEL_PRESETS).join(" | ")} | custom
  --global-agents               Mount ~/.codex/AGENTS.md
  --no-global-agents            Do not mount the global AGENTS.md
  --base-url <url>              Container-safe Codex provider URL
  --<stage>-model <model>        Override planner/implementer/reviewer/merger
  --<stage>-effort <effort>      ${EFFORTS.join(" | ")}
  --create-label                 Create ready-for-agent when missing
  --no-create-label              Skip label creation
  --build / --no-build           Build the Docker image after configuration
  -h, --help                     Show help
  -v, --version                  Show version

The package always uses the host ~/.codex/auth.json. It never configures an
OpenAI API key and only processes open issues labeled ready-for-agent.
`);
}

/** @template T @param {T | symbol} value @returns {T} */
function unwrapPrompt(value) {
  if (clack.isCancel(value)) {
    clack.cancel("Cancelled.");
    process.exit(0);
  }
  return /** @type {T} */ (value);
}

/** @param {string | undefined} value @param {number} fallback @param {string} name */
function positiveInteger(value, fallback, name) {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

/** @param {Record<string, unknown>} values @param {string} yes @param {string} no */
function booleanChoice(values, yes, no) {
  if (values[yes] === true && values[no] === true) {
    throw new Error(`--${yes} and --${no} cannot be used together.`);
  }
  if (values[yes] === true) return true;
  if (values[no] === true) return false;
  return undefined;
}

/**
 * @param {Record<string, unknown>} values
 * @param {import("./config.mjs").ProjectConfig | undefined} existing
 * @param {string} cwd
 */
async function resolveConfiguration(values, existing, cwd) {
  const workflow = String(
    values.workflow ??
      (isInteractive
        ? unwrapPrompt(
            await clack.select({
              message: "Select a workflow",
              initialValue: existing?.workflow ?? "parallel-planner-with-review",
              options: Object.entries(WORKFLOWS).map(([value, item]) => ({
                value,
                label: item.label,
                hint: item.hint,
              })),
            }),
          )
        : existing?.workflow ?? "parallel-planner-with-review"),
  );
  const workflowInfo = getWorkflow(workflow);

  const preset = String(
    values.preset ??
      (isInteractive
        ? unwrapPrompt(
            await clack.select({
              message: "Select a stage model preset",
              initialValue: existing ? "existing" : "balanced",
              options: [
                ...(existing
                  ? [
                      {
                        value: "existing",
                        label: "Keep current models",
                        hint: "Preserve the existing stage configuration",
                      },
                    ]
                  : []),
                { value: "balanced", label: "Balanced", hint: "Current repository defaults" },
                { value: "quality", label: "Quality", hint: "GPT-5.6 Sol xhigh for every stage" },
                { value: "custom", label: "Custom", hint: "Choose every active stage" },
              ],
            }),
          )
        : existing
          ? "existing"
          : "balanced"),
  );
  if (preset !== "custom" && preset !== "existing" && !(preset in MODEL_PRESETS)) {
    throw new Error(`Unknown model preset '${preset}'.`);
  }

  const defaultStages = existing?.stages ?? MODEL_PRESETS.balanced;
  /** @type {Partial<Record<import("./config.mjs").StageName, import("./config.mjs").StageConfig>>} */
  const stages = {};
  for (const stage of workflowInfo.stages) {
    const modelFlag = values[`${stage}-model`];
    const effortFlag = values[`${stage}-effort`];
    const selectedPreset =
      preset === "custom" || preset === "existing"
        ? defaultStages
        : MODEL_PRESETS[/** @type {"balanced" | "quality"} */ (preset)];
    if (
      preset === "custom" &&
      !isInteractive &&
      (modelFlag === undefined || effortFlag === undefined)
    ) {
      throw new Error(
        `Custom preset requires --${stage}-model and --${stage}-effort in non-interactive mode.`,
      );
    }
    let model = modelFlag ?? selectedPreset[stage].model;
    let effort = effortFlag ?? selectedPreset[stage].effort;
    if (preset === "custom" && isInteractive && modelFlag === undefined) {
      model = unwrapPrompt(
        await clack.text({
          message: `${stage} model`,
          initialValue: String(model),
          validate: (value) =>
            (value ?? "").trim() ? undefined : "Model is required",
        }),
      );
    }
    if (preset === "custom" && isInteractive && effortFlag === undefined) {
      effort = unwrapPrompt(
        await clack.select({
          message: `${stage} reasoning effort`,
          initialValue: effort,
          options: EFFORTS.map((value) => ({ value, label: value })),
        }),
      );
    }
    stages[stage] = {
      model: String(model),
      effort: /** @type {import("./config.mjs").ReasoningEffort} */ (
        String(effort)
      ),
    };
  }

  const agentsChoice = booleanChoice(values, "global-agents", "no-global-agents");
  const loadGlobalAgents =
    agentsChoice ??
    (isInteractive
      ? unwrapPrompt(
          await clack.confirm({
            message: "Mount ~/.codex/AGENTS.md into every sandbox?",
            initialValue: existing?.loadGlobalAgents ?? false,
          }),
        )
      : existing?.loadGlobalAgents ?? false);

  const baseUrl = String(
    values["base-url"] ??
      (isInteractive
        ? unwrapPrompt(
            await clack.text({
              message: "Codex provider URL visible from Docker",
              initialValue: existing?.baseUrl ?? DEFAULT_BASE_URL,
              validate: (value) =>
                (value ?? "").trim() ? undefined : "URL is required",
            }),
          )
        : existing?.baseUrl ?? DEFAULT_BASE_URL),
  );

  return createProjectConfig({
    workflow,
    projectName: projectName(cwd),
    preset: /** @type {"balanced" | "quality"} */ (
      preset === "custom" || preset === "existing" ? "balanced" : preset
    ),
    stages,
    loadGlobalAgents: Boolean(loadGlobalAgents),
    baseUrl,
    imageName: values["image-name"]
      ? String(values["image-name"])
      : existing?.imageName,
    maxCycles: positiveInteger(
      values["max-cycles"]?.toString(),
      existing?.maxCycles ?? 50,
      "max-cycles",
    ),
    implementerMaxIterations: positiveInteger(
      values["implementer-max-iterations"]?.toString(),
      existing?.implementerMaxIterations ?? 100,
      "implementer-max-iterations",
    ),
  });
}

/** @param {"init" | "configure"} command @param {Record<string, unknown>} values */
async function configure(command, values) {
  const cwd = await resolveGitRoot(process.cwd());
  let existing;
  if (command === "configure") {
    try {
      existing = await loadProjectConfig(cwd);
    } catch {
      existing = undefined;
    }
  }
  if (isInteractive) {
    clack.intro(`${PACKAGE_NAME}: host Codex + GitHub Issues`);
    clack.note(
      "Agent: Codex (host login)\nIssue tracker: GitHub Issues\nRequired label: ready-for-agent",
      "Fixed integration",
    );
  }
  const config = await resolveConfiguration(values, existing, cwd);
  await scaffoldProject({ cwd, config, allowExisting: command === "configure" });

  const createLabelChoice = booleanChoice(values, "create-label", "no-create-label");
  const shouldCreateLabel =
    createLabelChoice ??
    (isInteractive
      ? unwrapPrompt(
          await clack.confirm({
            message: "Create the ready-for-agent GitHub label if it is missing?",
            initialValue: true,
          }),
        )
      : false);
  if (shouldCreateLabel) {
    const env = await loadProjectEnv(cwd);
    const created = await ensureReadyLabel({ cwd, env });
    if (isInteractive) {
      clack.log.success(created ? "Created ready-for-agent." : "ready-for-agent already exists.");
    }
  }

  const buildChoice = booleanChoice(values, "build", "no-build");
  const shouldBuild =
    buildChoice ??
    (isInteractive
      ? unwrapPrompt(
          await clack.confirm({
            message: `Build Docker image ${config.imageName} now?`,
            initialValue: true,
          }),
        )
      : false);
  if (shouldBuild) await buildImage({ cwd, config });

  if (isInteractive) {
    clack.outro(
      `Configured ${config.workflow}. Set GH_TOKEN in .sandcastle/.env, then run npx ${PACKAGE_NAME} run.`,
    );
  } else {
    console.log(`Configured ${config.workflow} in ${cwd}`);
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const hasCommand = rawArgs[0] !== undefined && !rawArgs[0].startsWith("-");
  const command = hasCommand ? rawArgs[0] : "help";
  const args = hasCommand ? rawArgs.slice(1) : rawArgs;
  const { values } = parseArgs({
    args,
    options: optionDefinitions,
    strict: true,
    allowPositionals: false,
  });
  if (values.version || command === "version") {
    console.log(VERSION);
    return;
  }
  if (values.help || command === "help") {
    printHelp();
    return;
  }

  switch (command) {
    case "init":
    case "configure":
      await configure(command, values);
      break;
    case "build": {
      const cwd = await resolveGitRoot(process.cwd());
      await buildImage({ cwd, config: await loadProjectConfig(cwd) });
      console.log("Docker image built.");
      break;
    }
    case "run":
      await runConfiguredProject(process.cwd());
      break;
    default:
      throw new Error(`Unknown command '${command}'. Run '${PACKAGE_NAME} --help'.`);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (isInteractive) clack.log.error(message);
  else console.error(message);
  process.exitCode = 1;
});
