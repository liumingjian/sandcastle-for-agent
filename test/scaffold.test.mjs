import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createProjectConfig } from "../src/config.mjs";
import { scaffoldProject } from "../src/scaffold.mjs";

test("scaffold writes package-owned assets and fixed issue filtering", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sandcastle-for-agent-scaffold-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const config = createProjectConfig({
    workflow: "parallel-planner-with-review",
    projectName: "fixture",
    loadGlobalAgents: true,
  });

  await scaffoldProject({ cwd, config });
  const plan = await readFile(join(cwd, ".sandcastle", "plan-prompt.md"), "utf8");
  const codex = await readFile(join(cwd, ".sandcastle", "codex-config.toml"), "utf8");
  const dockerfile = await readFile(join(cwd, ".sandcastle", "Dockerfile"), "utf8");
  const env = await readFile(join(cwd, ".sandcastle", ".env.example"), "utf8");
  const saved = JSON.parse(
    await readFile(join(cwd, ".sandcastle", "for-agent.json"), "utf8"),
  );

  assert.match(plan, /gh issue list --state open --label ready-for-agent/);
  assert.doesNotMatch(plan, /gh issue list(?![^\n]*--label ready-for-agent)/);
  assert.doesNotMatch(codex, /^model\s*=/m);
  assert.match(dockerfile, /install -d[^\n]*\/home\/agent\/\.codex/);
  assert.equal(env.trim().split("\n").at(-1), "GH_TOKEN=");
  assert.equal(saved.loadGlobalAgents, true);

  await assert.rejects(() => scaffoldProject({ cwd, config }), /already exists/);
  await scaffoldProject({ cwd, config, allowExisting: true });
});

test("every prompt that enumerates issues applies the ready-for-agent label", async () => {
  for (const file of ["worker.md", "plan.md"]) {
    const source = await readFile(
      new URL(`../assets/prompts/${file}`, import.meta.url),
      "utf8",
    );
    for (const line of source.split("\n").filter((item) => item.includes("gh issue list"))) {
      assert.match(line, /--state open --label ready-for-agent/);
    }
  }
});
