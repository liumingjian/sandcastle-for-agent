import assert from "node:assert/strict";
import test from "node:test";
import { buildImage } from "../src/build.mjs";
import { createProjectConfig } from "../src/config.mjs";

test("Docker build uses the configured image and host identity", async () => {
  /** @type {{file: string, args: string[], options: {cwd: string}}[]} */
  const invocations = [];
  const config = createProjectConfig({
    workflow: "simple-loop",
    projectName: "fixture",
  });

  await buildImage({
    cwd: "/repo",
    config,
    exec: async (file, args, options) => {
      invocations.push({ file, args, options });
    },
  });

  const invocation = invocations[0];
  assert.ok(invocation);
  assert.equal(invocation.file, "docker");
  assert.deepEqual(invocation.args.slice(0, 3), [
    "build",
    "-t",
    "sandcastle:fixture",
  ]);
  assert.ok(invocation.args.includes(`AGENT_UID=${process.getuid?.() ?? 1000}`));
  assert.ok(invocation.args.includes(`AGENT_GID=${process.getgid?.() ?? 1000}`));
  assert.equal(invocation.args.at(-1), "/repo/.sandcastle");
  assert.equal(invocation.options.cwd, "/repo");
});
