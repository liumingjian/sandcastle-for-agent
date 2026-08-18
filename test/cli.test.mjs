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
  await writeFile(
    join(cwd, ".sandcastle", "main.mts"),
    [
      'import * as sandcastle from "@ai-hero/sandcastle";',
      'import { docker } from "@ai-hero/sandcastle/sandboxes/docker";',
      "await sandcastle.run({ sandbox: docker(), agent: sandcastle.codex(\"planner\"), maxIterations: 1 });",
      "await sandcastle.run({ sandbox: docker(), agent: sandcastle.codex(\"implementer\"), maxIterations: 100 });",
      "await sandcastle.run({ sandbox: docker(), agent: sandcastle.codex(\"reviewer\"), maxIterations: 1 });",
      "await sandcastle.run({ sandbox: docker(), agent: sandcastle.codex(\"merger\"), maxIterations: 1 });",
      "",
    ].join("\n"),
  );
  await mkdir(join(cwd, ".sandcastle", "node_modules", ".bin"), { recursive: true });
  await writeFile(join(cwd, ".sandcastle", "node_modules", ".bin", "tsx"), "");
  for (const packageName of [
    join("@ai-hero", "sandcastle"),
    "smol-toml",
    "tsx",
    "zod",
  ]) {
    await mkdir(join(cwd, ".sandcastle", "node_modules", packageName), {
      recursive: true,
    });
    const versions = {
      [join("@ai-hero", "sandcastle")]: "0.12.0",
      "smol-toml": "1.8.0",
      tsx: "4.21.0",
      zod: "4.4.3",
    };
    await writeFile(
      join(cwd, ".sandcastle", "node_modules", packageName, "package.json"),
      `${JSON.stringify({ version: versions[packageName] })}\n`,
    );
  }

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
      "--max-cycles",
      "12",
      "--max-parallel",
      "3",
      "--no-global-agents",
      "--no-build",
    ],
    { cwd },
  );

  const configPath = join(cwd, ".sandcastle", "for-agent.json");
  const initial = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(initial.stages.planner.model, "planner-local");
  assert.equal(initial.stages.merger.effort, "low");
  assert.equal(initial.maxCycles, 12);
  assert.equal(initial.maxParallel, 3);

  await exec(
    process.execPath,
    [cli, "configure", "--no-build"],
    { cwd },
  );
  const configured = JSON.parse(await readFile(configPath, "utf8"));
  assert.deepEqual(configured.stages, initial.stages);
  assert.match(
    await readFile(join(cwd, ".sandcastle", "main.mts"), "utf8"),
    /sandcastle\.codex\("planner"\)/,
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
