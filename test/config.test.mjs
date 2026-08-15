import assert from "node:assert/strict";
import test from "node:test";
import {
  ConfigError,
  createProjectConfig,
  normalizeImageName,
  validateProjectConfig,
} from "../src/config.mjs";

test("balanced config contains stage-specific model defaults", () => {
  const config = createProjectConfig({
    workflow: "parallel-planner-with-review",
    projectName: "My Project",
  });

  assert.equal(config.imageName, "sandcastle:my-project");
  assert.deepEqual(config.stages.planner, {
    model: "gpt-5.6-sol",
    effort: "xhigh",
  });
  assert.deepEqual(config.stages.implementer, {
    model: "gpt-5.5",
    effort: "high",
  });
});

test("custom active-stage settings override a preset", () => {
  const config = createProjectConfig({
    workflow: "simple-loop",
    projectName: "repo",
    stages: {
      implementer: { model: "local-model", effort: "medium" },
    },
  });

  assert.deepEqual(config.stages.implementer, {
    model: "local-model",
    effort: "medium",
  });
});

test("validation rejects invalid active stages and provider URLs", () => {
  const config = createProjectConfig({
    workflow: "sequential-reviewer",
    projectName: "repo",
  });

  assert.throws(
    () =>
      validateProjectConfig({
        ...config,
        stages: { ...config.stages, reviewer: { model: "", effort: "high" } },
      }),
    ConfigError,
  );
  assert.throws(
    () => validateProjectConfig({ ...config, baseUrl: "file:///tmp/provider" }),
    /http or https/,
  );
  assert.equal(normalizeImageName("---"), "sandcastle:repo");
});
