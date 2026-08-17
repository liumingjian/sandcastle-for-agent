import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { UPSTREAM_SANDCASTLE_VERSION } from "../src/constants.mjs";

const exec = promisify(execFile);
const packageRoot = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
const cli = join(packageRoot, "src", "cli.mjs");

test("CLI help works without an explicit command", async () => {
  const { stdout } = await exec(process.execPath, [cli, "--help"]);
  assert.match(stdout, /sandcastle-for-agent init/);
  assert.match(stdout, /only processes open issues labeled ready-for-agent/);
  assert.doesNotMatch(stdout, /--create-label/);
  assert.doesNotMatch(stdout, /--base-url/);
});

test("CLI reports the pinned release version", async () => {
  const { stdout } = await exec(process.execPath, [cli, "--version"]);
  assert.equal(stdout.trim(), UPSTREAM_SANDCASTLE_VERSION);
});

test("configure overlays an existing Harness and preserves custom models", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sandcastle-for-agent-cli-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await exec("git", ["init", "--quiet"], { cwd });
  await mkdir(join(cwd, ".sandcastle"));
  await writeFile(join(cwd, ".sandcastle", "main.mts"), "// upstream\n");

  await exec(
    process.execPath,
    [
      cli,
      "configure",
      "--workflow",
      "parallel-planner-with-review",
      "--preset",
      "custom",
      "--planner-model",
      "planner-local",
      "--planner-effort",
      "xhigh",
      "--implementer-model",
      "implementer-local",
      "--implementer-effort",
      "high",
      "--reviewer-model",
      "reviewer-local",
      "--reviewer-effort",
      "medium",
      "--merger-model",
      "merger-local",
      "--merger-effort",
      "low",
      "--no-global-agents",
      "--no-build",
    ],
    { cwd },
  );

  const configPath = join(cwd, ".sandcastle", "for-agent.json");
  const initial = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(initial.stages.planner.model, "planner-local");
  assert.equal(initial.stages.merger.effort, "low");

  await exec(
    process.execPath,
    [cli, "configure", "--no-build"],
    { cwd },
  );
  const configured = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(configured.stages, initial.stages);
  assert.equal(
    await readFile(join(cwd, ".sandcastle", "main.mts"), "utf8"),
    "// upstream\n",
  );
});

test("non-interactive custom preset requires every active stage", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sandcastle-for-agent-custom-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await exec("git", ["init", "--quiet"], { cwd });

  await assert.rejects(
    () =>
      exec(
        process.execPath,
        [cli, "init", "--workflow", "simple-loop", "--preset", "custom"],
        { cwd },
      ),
    /Custom preset requires --implementer-model/,
  );
});
