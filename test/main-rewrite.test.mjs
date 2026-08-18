import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  adaptUpstreamMain,
  assertMainEntryReady,
  resolveMainEntry,
  rewriteMainEntry,
} from "../src/main-rewrite.mjs";

test("rewrites the upstream simple loop without replacing its execution flow", () => {
  const source = [
    'import { run, codex } from "@ai-hero/sandcastle";',
    'import { docker } from "@ai-hero/sandcastle/sandboxes/docker";',
    "",
    "await run({",
    "  sandbox: docker(),",
    '  agent: codex("gpt-5.4"),',
    "  maxIterations: 3,",
    "});",
    "",
  ].join("\n");

  const rewritten = adaptUpstreamMain(source, "simple-loop");
  assert.match(rewritten, /sandcastle-for-agent managed main entry/);
  assert.match(rewritten, /loadHostCodexContext/);
  assert.match(rewritten, /const mounts = \[/);
  assert.match(rewritten, /sandbox: createDockerSandbox\(\)/);
  assert.match(rewritten, /agent: agent\("implementer"\)/);
  assert.match(rewritten, /docker\(\{[\s\S]*mounts/);
  assert.match(rewritten, /codex\(stageConfig\.model, \{ effort: stageConfig\.effort \}\)/);
  assert.match(rewritten, /maxIterations: config\.maxCycles/);
  assert.doesNotMatch(rewritten, /docker\(\)|codex\("gpt-5\.4"\)/);
});

test("rewrites all stages in the upstream parallel planner template", () => {
  const source = [
    'import * as sandcastle from "@ai-hero/sandcastle";',
    'import { docker } from "@ai-hero/sandcastle/sandboxes/docker";',
    "",
    "const MAX_ITERATIONS = 10;",
    "const MAX_PARALLEL = 5;",
    "await sandcastle.run({ sandbox: docker(), agent: sandcastle.codex(\"planner\"), maxIterations: 1 });",
    "await sandcastle.run({ sandbox: docker(), agent: sandcastle.codex(\"implementer\"), maxIterations: 100 });",
    "await sandcastle.run({ sandbox: docker(), agent: sandcastle.codex(\"reviewer\"), maxIterations: 1 });",
    "await sandcastle.run({ sandbox: docker(), agent: sandcastle.codex(\"merger\"), maxIterations: 1 });",
    "",
  ].join("\n");

  const rewritten = adaptUpstreamMain(source, "parallel-planner-with-review");
  assert.match(rewritten, /const MAX_ITERATIONS = config\.maxCycles/);
  assert.match(rewritten, /const MAX_PARALLEL = config\.maxParallel/);
  assert.match(rewritten, /agent\("planner"\)/);
  assert.match(rewritten, /agent\("implementer"\)/);
  assert.match(rewritten, /agent\("reviewer"\)/);
  assert.match(rewritten, /agent\("merger"\)/);
  assert.match(rewritten, /maxIterations: config\.implementerMaxIterations/);
  assert.equal((rewritten.match(/createDockerSandbox\(\)/g) ?? []).length, 4);
  assert.doesNotMatch(
    rewritten,
    /const sandbox = await sandcastle\.createSandbox\([\s\S]*sandbox: sandbox\(\)/,
  );
});

test("writes the host adapter beside the generated main.mts", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sandcastle-for-agent-main-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, ".sandcastle"));
  await writeFile(
    join(cwd, ".sandcastle", "main.mts"),
    [
      'import { run, codex } from "@ai-hero/sandcastle";',
      'import { docker } from "@ai-hero/sandcastle/sandboxes/docker";',
      "await run({ sandbox: docker(), agent: codex(\"gpt-5.4\"), maxIterations: 3 });",
      "",
    ].join("\n"),
  );

  await rewriteMainEntry({ cwd, workflow: "simple-loop" });
  assert.match(
    await readFile(join(cwd, ".sandcastle", "main.mts"), "utf8"),
    /agent\("implementer"\)/,
  );
  assert.match(
    await readFile(join(cwd, ".sandcastle", "for-agent-runtime.mjs"), "utf8"),
    /loadHostCodexContext/,
  );
});

test("refreshes from a new upstream template when the workflow changes", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sandcastle-for-agent-refresh-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, ".sandcastle"));
  await writeFile(
    join(cwd, ".sandcastle", "main.mts"),
    [
      "// sandcastle-for-agent managed main entry",
      "// sandcastle-for-agent workflow: simple-loop",
      'import { run } from "@ai-hero/sandcastle";',
      'await run({ agent: runtime.agent("implementer") });',
      "",
    ].join("\n"),
  );

  await rewriteMainEntry({
    cwd,
    workflow: "parallel-planner-with-review",
    refresh: true,
    exec: async (_file, _args, options) => {
      await mkdir(join(options.cwd, ".sandcastle"), { recursive: true });
      await writeFile(
        join(options.cwd, ".sandcastle", "main.mts"),
        [
          'import * as sandcastle from "@ai-hero/sandcastle";',
          'import { docker } from "@ai-hero/sandcastle/sandboxes/docker";',
          "const MAX_ITERATIONS = 4;",
          'await sandcastle.run({ sandbox: docker(), agent: sandcastle.codex("planner"), maxIterations: 1 });',
          'await sandcastle.run({ sandbox: docker(), agent: sandcastle.codex("implementer"), maxIterations: 100 });',
          'await sandcastle.run({ sandbox: docker(), agent: sandcastle.codex("reviewer"), maxIterations: 1 });',
          'await sandcastle.run({ sandbox: docker(), agent: sandcastle.codex("merger"), maxIterations: 1 });',
          "",
        ].join("\n"),
      );
    },
  });

  const rewritten = await readFile(join(cwd, ".sandcastle", "main.mts"), "utf8");
  assert.match(rewritten, /workflow: parallel-planner-with-review/);
  assert.match(rewritten, /agent\("merger"\)/);
  assert.match(rewritten, /const mounts = \[/);
  assert.doesNotMatch(rewritten, /runtime\.agent/);
});

test("follows upstream main.ts selection for module projects", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sandcastle-for-agent-main-ts-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, ".sandcastle"));
  await writeFile(join(cwd, "package.json"), '{"type":"module"}\n');
  await writeFile(
    join(cwd, ".sandcastle", "main.ts"),
    [
      'import { run, codex } from "@ai-hero/sandcastle";',
      'import { docker } from "@ai-hero/sandcastle/sandboxes/docker";',
      'await run({ sandbox: docker(), agent: codex("gpt-5.4") });',
      "",
    ].join("\n"),
  );

  const entry = await resolveMainEntry(cwd);
  assert.equal(entry.filename, "main.ts");
  await rewriteMainEntry({ cwd, workflow: "simple-loop" });
  assert.match(await readFile(entry.path, "utf8"), /agent\("implementer"\)/);
  assert.equal((await assertMainEntryReady(cwd, "simple-loop")).filename, "main.ts");
});
