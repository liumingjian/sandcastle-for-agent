import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CONFIG_DIR,
  CONFIG_FILE,
  CONFIG_VERSION,
  DEFAULT_IMPLEMENTER_MAX_ITERATIONS,
  DEFAULT_MAX_CYCLES,
  DEFAULT_MAX_PARALLEL,
  EFFORTS,
  MODEL_PRESETS,
  WORKFLOWS,
} from "./constants.mjs";

/** @typedef {keyof typeof WORKFLOWS} WorkflowName */
/** @typedef {"planner" | "implementer" | "reviewer" | "merger"} StageName */
/** @typedef {"low" | "medium" | "high" | "xhigh" | "max"} ReasoningEffort */
/** @typedef {{model: string, effort: ReasoningEffort}} StageConfig */
/**
 * @typedef {object} ProjectConfig
 * @property {1} version
 * @property {WorkflowName} workflow
 * @property {boolean} loadGlobalAgents
 * @property {string} imageName
 * @property {number} maxCycles
 * @property {number} maxParallel
 * @property {number} implementerMaxIterations
 * @property {Record<StageName, StageConfig>} stages
 */

export class ConfigError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

/** @param {string} value */
export function normalizeImageName(value) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `sandcastle:${normalized || "repo"}`;
}

/** @param {string} workflow */
export function getWorkflow(workflow) {
  if (!(workflow in WORKFLOWS)) {
    throw new ConfigError(
      `Unknown workflow '${workflow}'. Expected one of: ${Object.keys(WORKFLOWS).join(", ")}.`,
    );
  }
  return WORKFLOWS[/** @type {WorkflowName} */ (workflow)];
}

/**
 * @param {object} input
 * @param {string} input.workflow
 * @param {string} input.projectName
 * @param {keyof typeof MODEL_PRESETS} [input.preset]
 * @param {Partial<Record<StageName, StageConfig>>} [input.stages]
 * @param {boolean} [input.loadGlobalAgents]
 * @param {string} [input.imageName]
 * @param {number} [input.maxCycles]
 * @param {number} [input.maxParallel]
 * @param {number} [input.implementerMaxIterations]
 * @returns {ProjectConfig}
 */
export function createProjectConfig(input) {
  getWorkflow(input.workflow);
  const presetName = input.preset ?? "balanced";
  const preset = MODEL_PRESETS[presetName];
  if (!preset) {
    throw new ConfigError(`Unknown model preset '${presetName}'.`);
  }

  const stages = structuredClone(preset);
  for (const [stage, value] of Object.entries(input.stages ?? {})) {
    stages[/** @type {StageName} */ (stage)] = /** @type {StageConfig} */ (value);
  }

  return validateProjectConfig({
    version: CONFIG_VERSION,
    workflow: input.workflow,
    loadGlobalAgents: input.loadGlobalAgents ?? false,
    imageName: input.imageName ?? normalizeImageName(input.projectName),
    maxCycles: input.maxCycles ?? DEFAULT_MAX_CYCLES,
    maxParallel: input.maxParallel ?? DEFAULT_MAX_PARALLEL,
    implementerMaxIterations:
      input.implementerMaxIterations ?? DEFAULT_IMPLEMENTER_MAX_ITERATIONS,
    stages,
  });
}

/** @param {unknown} value @returns {ProjectConfig} */
export function validateProjectConfig(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ConfigError("Project config must be a JSON object.");
  }
  const config = /** @type {Record<string, unknown>} */ (value);
  if (config.version !== CONFIG_VERSION) {
    throw new ConfigError(`Unsupported config version '${String(config.version)}'.`);
  }
  const workflowName = String(config.workflow ?? "");
  const workflow = getWorkflow(workflowName);
  if (typeof config.loadGlobalAgents !== "boolean") {
    throw new ConfigError("loadGlobalAgents must be true or false.");
  }
  if (typeof config.imageName !== "string" || !config.imageName.trim()) {
    throw new ConfigError("imageName must be a non-empty string.");
  }
  // `maxParallel` was added after the first config format shipped. Normalize
  // older files so they remain runnable without a configure step.
  if (config.maxParallel === undefined) config.maxParallel = DEFAULT_MAX_PARALLEL;
  for (const key of ["maxCycles", "maxParallel", "implementerMaxIterations"]) {
    const number = config[key];
    if (!Number.isInteger(number) || Number(number) < 1) {
      throw new ConfigError(`${key} must be a positive integer.`);
    }
  }
  if (!config.stages || typeof config.stages !== "object" || Array.isArray(config.stages)) {
    throw new ConfigError("stages must be an object.");
  }
  const stages = /** @type {Record<string, unknown>} */ (config.stages);
  for (const stageName of workflow.stages) {
    const stage = /** @type {Record<string, unknown> | undefined} */ (stages[stageName]);
    if (!stage || typeof stage.model !== "string" || !stage.model.trim()) {
      throw new ConfigError(`stages.${stageName}.model must be a non-empty string.`);
    }
    if (!EFFORTS.includes(String(stage.effort))) {
      throw new ConfigError(
        `stages.${stageName}.effort must be one of: ${EFFORTS.join(", ")}.`,
      );
    }
  }
  return /** @type {ProjectConfig} */ (config);
}

/** @param {string} cwd */
export async function loadProjectConfig(cwd) {
  const path = join(cwd, CONFIG_DIR, CONFIG_FILE);
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch {
    throw new ConfigError(
      `Missing ${CONFIG_DIR}/${CONFIG_FILE}. Run 'sandcastle-for-agent init' first.`,
    );
  }
  try {
    return validateProjectConfig(JSON.parse(source));
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError(`Invalid JSON in ${CONFIG_DIR}/${CONFIG_FILE}.`);
  }
}

/** @param {string} cwd @param {ProjectConfig} config */
export async function saveProjectConfig(cwd, config) {
  const path = join(cwd, CONFIG_DIR, CONFIG_FILE);
  await writeFile(path, `${JSON.stringify(validateProjectConfig(config), null, 2)}\n`);
  return path;
}
