import { join } from "node:path";
import * as sandcastle from "@ai-hero/sandcastle";
import { z } from "zod";
import { CONFIG_DIR } from "./constants.mjs";

const planSchema = z.object({
  issues: z.array(
    z.object({ id: z.string(), title: z.string(), branch: z.string() }),
  ),
});

/** @param {string} cwd @param {string} name */
const promptPath = (cwd, name) => join(cwd, CONFIG_DIR, name);

/** @param {{hooks?: import("@ai-hero/sandcastle").SandboxHooks, copyToWorktree?: string[]}} value */
function withSetup(value) {
  return {
    ...(value.hooks ? { hooks: value.hooks } : {}),
    ...(value.copyToWorktree
      ? { copyToWorktree: value.copyToWorktree }
      : {}),
  };
}

/**
 * @typedef {object} WorkflowContext
 * @property {string} cwd
 * @property {import("./config.mjs").ProjectConfig} config
 * @property {{sandbox: () => import("@ai-hero/sandcastle").SandboxProvider, agent: (stage: import("./config.mjs").StageName) => import("@ai-hero/sandcastle").AgentProvider}} runtime
 * @property {{hooks?: import("@ai-hero/sandcastle").SandboxHooks, copyToWorktree?: string[]}} setup
 */

/** @param {WorkflowContext} context */
async function runSimpleLoop({ cwd, config, runtime, setup }) {
  return sandcastle.run({
    cwd,
    name: "implementer",
    sandbox: runtime.sandbox(),
    agent: runtime.agent("implementer"),
    promptFile: promptPath(cwd, "prompt.md"),
    maxIterations: config.maxCycles,
    branchStrategy: { type: "merge-to-head" },
    ...withSetup(setup),
  });
}

/** @param {WorkflowContext} context */
async function runSequentialReviewer({ cwd, config, runtime, setup }) {
  for (let iteration = 1; iteration <= config.maxCycles; iteration++) {
    console.log(`\n=== Iteration ${iteration}/${config.maxCycles} ===\n`);
    const branch = `sandcastle/sequential-reviewer/${Date.now()}-${iteration}`;
    const sandbox = await sandcastle.createSandbox({
      cwd,
      branch,
      sandbox: runtime.sandbox(),
      ...withSetup(setup),
    });
    try {
      const implement = await sandbox.run({
        name: "implementer",
        maxIterations: 1,
        agent: runtime.agent("implementer"),
        promptFile: promptPath(cwd, "implement-prompt.md"),
      });
      if (!implement.commits.length) {
        console.log("Implementation agent made no commits. Stopping.");
        break;
      }
      await sandbox.run({
        name: "reviewer",
        maxIterations: 1,
        agent: runtime.agent("reviewer"),
        promptFile: promptPath(cwd, "review-prompt.md"),
        promptArgs: { BRANCH: branch },
      });
    } finally {
      await sandbox.close();
    }
  }
}

/** @param {WorkflowContext} context @param {boolean} withReview */
async function runParallel(context, withReview) {
  const { cwd, config, runtime, setup } = context;
  for (let iteration = 1; iteration <= config.maxCycles; iteration++) {
    console.log(`\n=== Iteration ${iteration}/${config.maxCycles} ===\n`);
    const plan = await sandcastle.run({
      cwd,
      ...withSetup({ hooks: setup.hooks }),
      sandbox: runtime.sandbox(),
      name: "planner",
      maxIterations: 1,
      agent: runtime.agent("planner"),
      promptFile: promptPath(cwd, "plan-prompt.md"),
      output: sandcastle.Output.object({ tag: "plan", schema: planSchema }),
    });
    const issues = /** @type {{id: string, title: string, branch: string}[]} */ (
      plan.output.issues
    );
    if (!issues.length) {
      console.log("No ready, unblocked issues. Stopping.");
      break;
    }

    const settled = await Promise.allSettled(
      issues.map(async (issue) => {
        if (!withReview) {
          return sandcastle.run({
            cwd,
            ...withSetup(setup),
            sandbox: runtime.sandbox(),
            branchStrategy: { type: "branch", branch: issue.branch },
            name: "implementer",
            maxIterations: config.implementerMaxIterations,
            agent: runtime.agent("implementer"),
            promptFile: promptPath(cwd, "implement-prompt.md"),
            promptArgs: {
              TASK_ID: issue.id,
              ISSUE_TITLE: issue.title,
              BRANCH: issue.branch,
            },
          });
        }

        const sandbox = await sandcastle.createSandbox({
          cwd,
          branch: issue.branch,
          sandbox: runtime.sandbox(),
          ...withSetup(setup),
        });
        try {
          const implement = await sandbox.run({
            name: "implementer",
            maxIterations: config.implementerMaxIterations,
            agent: runtime.agent("implementer"),
            promptFile: promptPath(cwd, "implement-prompt.md"),
            promptArgs: {
              TASK_ID: issue.id,
              ISSUE_TITLE: issue.title,
              BRANCH: issue.branch,
            },
          });
          if (!implement.commits.length) return implement;
          const review = await sandbox.run({
            name: "reviewer",
            maxIterations: 1,
            agent: runtime.agent("reviewer"),
            promptFile: promptPath(cwd, "review-prompt.md"),
            promptArgs: { BRANCH: issue.branch },
          });
          return {
            ...review,
            commits: [...implement.commits, ...review.commits],
          };
        } finally {
          await sandbox.close();
        }
      }),
    );

    for (const [index, outcome] of settled.entries()) {
      if (outcome.status === "rejected") {
        console.error(
          `${issues[index]?.id ?? "unknown"} failed: ${String(outcome.reason)}`,
        );
      }
    }

    /** @type {{id: string, title: string, branch: string}[]} */
    const completedIssues = [];
    for (const [index, outcome] of settled.entries()) {
      const issue = issues[index];
      if (
        issue &&
        outcome.status === "fulfilled" &&
        outcome.value.commits.length > 0
      ) {
        completedIssues.push(issue);
      }
    }
    if (!completedIssues.length) {
      console.log("No commits were produced. Continuing to the next cycle.");
      continue;
    }

    await sandcastle.run({
      cwd,
      ...withSetup({ hooks: setup.hooks }),
      sandbox: runtime.sandbox(),
      name: "merger",
      maxIterations: 1,
      agent: runtime.agent("merger"),
      promptFile: promptPath(cwd, "merge-prompt.md"),
      promptArgs: {
        BRANCHES: completedIssues.map((issue) => `- ${issue.branch}`).join("\n"),
        ISSUES: completedIssues
          .map((issue) => `- ${issue.id}: ${issue.title}`)
          .join("\n"),
      },
    });
  }
}

/** @param {WorkflowContext} context */
export async function runWorkflow(context) {
  switch (context.config.workflow) {
    case "simple-loop":
      return runSimpleLoop(context);
    case "sequential-reviewer":
      return runSequentialReviewer(context);
    case "parallel-planner":
      return runParallel(context, false);
    case "parallel-planner-with-review":
      return runParallel(context, true);
    default:
      throw new Error(`Unsupported workflow '${context.config.workflow}'.`);
  }
}
