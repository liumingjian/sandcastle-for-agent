export const PACKAGE_NAME = "sandcastle-for-agent";
export const UPSTREAM_SANDCASTLE_VERSION = "0.12.0";
export const CONFIG_VERSION = 1;
export const ISSUE_LABEL = "ready-for-agent";
export const CONFIG_DIR = ".sandcastle";
export const CONFIG_FILE = "for-agent.json";
export const DEFAULT_MAX_CYCLES = 50;
export const DEFAULT_MAX_PARALLEL = 5;
export const DEFAULT_IMPLEMENTER_MAX_ITERATIONS = 100;

/** @typedef {"planner" | "implementer" | "reviewer" | "merger"} StageName */
/** @typedef {"low" | "medium" | "high" | "xhigh" | "max"} ReasoningEffort */
/** @typedef {{model: string, effort: ReasoningEffort}} StageConfig */

/** @type {Record<string, {label: string, hint: string, stages: StageName[]}>} */
export const WORKFLOWS = {
  "simple-loop": {
    label: "Simple loop",
    hint: "One Codex agent implements ready issues sequentially.",
    stages: ["implementer"],
  },
  "sequential-reviewer": {
    label: "Sequential reviewer",
    hint: "Implement one issue, then review it in the same sandbox.",
    stages: ["implementer", "reviewer"],
  },
  "parallel-planner": {
    label: "Parallel planner",
    hint: "Plan dependencies, implement unblocked issues in parallel, then merge.",
    stages: ["planner", "implementer", "merger"],
  },
  "parallel-planner-with-review": {
    label: "Parallel planner with review",
    hint: "Plan, implement and review in parallel branches, then merge.",
    stages: ["planner", "implementer", "reviewer", "merger"],
  },
};

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/** @type {Record<StageName, StageConfig>} */
const balanced = {
  planner: { model: "gpt-5.6-sol", effort: "xhigh" },
  implementer: { model: "gpt-5.6-luna", effort: "max" },
  reviewer: { model: "gpt-5.6-sol", effort: "xhigh" },
  merger: { model: "gpt-5.6-luna", effort: "max" },
};

/** @type {Record<StageName, StageConfig>} */
const quality = {
  planner: { model: "gpt-5.6-sol", effort: "xhigh" },
  implementer: { model: "gpt-5.6-sol", effort: "xhigh" },
  reviewer: { model: "gpt-5.6-sol", effort: "xhigh" },
  merger: { model: "gpt-5.6-sol", effort: "xhigh" },
};

/** @type {Record<"balanced" | "quality", Record<StageName, StageConfig>>} */
export const MODEL_PRESETS = { balanced, quality };
