import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ensureRunScript,
  resolveRunScript,
} from "../src/project-script.mjs";

test("build adds only the Harness script to an existing project package", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sandcastle-for-agent-script-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const original = {
    name: "project",
    dependencies: { example: "1.0.0" },
    scripts: { test: "node test.mjs" },
  };
  await writeFile(join(cwd, "package.json"), `${JSON.stringify(original)}\n`);
  await writeFile(join(cwd, "package-lock.json"), '{"lockfileVersion":3}\n');

  const command = await ensureRunScript(cwd, "main.ts");
  assert.deepEqual(command, {
    command: "npm",
    args: ["run", "sandcastle-for-agent"],
    cwd,
  });
  const packageJson = JSON.parse(await readFile(join(cwd, "package.json"), "utf8"));
  assert.deepEqual(packageJson.dependencies, original.dependencies);
  assert.equal(packageJson.scripts.test, original.scripts.test);
  assert.equal(packageJson.scripts["sandcastle-for-agent"], "npx tsx .sandcastle/main.ts");
  assert.equal(await readFile(join(cwd, "package-lock.json"), "utf8"), '{"lockfileVersion":3}\n');
  assert.deepEqual(await resolveRunScript(cwd, "main.ts"), command);
});

test("build does not overwrite a conflicting project script", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sandcastle-for-agent-script-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(
    join(cwd, "package.json"),
    `${JSON.stringify({ scripts: { "sandcastle-for-agent": "custom-command" } })}\n`,
  );

  await assert.rejects(
    ensureRunScript(cwd, "main.ts"),
    /already defines 'sandcastle-for-agent' with a different command/,
  );
  assert.equal(
    JSON.parse(await readFile(join(cwd, "package.json"), "utf8")).scripts[
      "sandcastle-for-agent"
    ],
    "custom-command",
  );
});

test("build keeps the run script isolated when the project has no package", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sandcastle-for-agent-script-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, ".sandcastle"), { recursive: true });

  const command = await ensureRunScript(cwd, "main.mts");
  assert.deepEqual(command, {
    command: "npm",
    args: ["--prefix", ".sandcastle", "run", "sandcastle-for-agent"],
    cwd,
  });
  const packageJson = JSON.parse(
    await readFile(join(cwd, ".sandcastle", "package.json"), "utf8"),
  );
  assert.equal(packageJson.scripts["sandcastle-for-agent"], "npx tsx main.mts");
  assert.deepEqual(await resolveRunScript(cwd, "main.mts"), command);
});
