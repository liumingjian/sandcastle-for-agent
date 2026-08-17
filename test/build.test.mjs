import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildImage } from "../src/build.mjs";
import { createProjectConfig } from "../src/config.mjs";

test("Docker build preserves upstream Dockerfile and adds a temporary Codex layer", async () => {
  /** @type {{file: string, args: string[], options: {cwd: string}}[]} */
  const invocations = [];
  let temporaryDockerfileContents = "";
  const config = createProjectConfig({
    workflow: "simple-loop",
    projectName: "fixture",
  });

  await buildImage({
    cwd: "/repo",
    config,
    exec: async (file, args, options) => {
      invocations.push({ file, args, options });
      if (args[0] === "build" && args.includes("-f")) {
        temporaryDockerfileContents = await readFile(
          args[args.indexOf("-f") + 1],
          "utf8",
        );
      }
    },
  });

  assert.equal(invocations.length, 3);
  const baseBuild = invocations[0];
  const finalBuild = invocations[1];
  const cleanup = invocations[2];
  assert.ok(baseBuild);
  assert.ok(finalBuild);
  assert.ok(cleanup);
  assert.equal(baseBuild.file, "docker");
  assert.deepEqual(baseBuild.args.slice(0, 2), ["build", "-t"]);
  const intermediateTag = baseBuild.args[2];
  assert.match(intermediateTag, /^sandcastle-for-agent-base-\d+-\d+$/);
  assert.notEqual(intermediateTag, "sandcastle:fixture");
  assert.equal(baseBuild.args.at(-1), "/repo/.sandcastle");
  assert.equal(baseBuild.options.cwd, "/repo");

  assert.equal(finalBuild.file, "docker");
  assert.deepEqual(finalBuild.args.slice(0, 3), [
    "build",
    "-t",
    "sandcastle:fixture",
  ]);
  assert.ok(finalBuild.args.includes(`AGENT_UID=${process.getuid?.() ?? 1000}`));
  assert.ok(finalBuild.args.includes(`AGENT_GID=${process.getgid?.() ?? 1000}`));
  assert.ok(finalBuild.args.includes("-f"));
  assert.equal(finalBuild.args.at(-1), "/repo/.sandcastle");
  assert.equal(finalBuild.options.cwd, "/repo");

  assert.match(temporaryDockerfileContents, new RegExp(`^FROM ${intermediateTag}$`, "m"));
  assert.match(temporaryDockerfileContents, /install -d -o \$AGENT_UID -g \$AGENT_GID/);
  assert.match(temporaryDockerfileContents, /if \[ ! -f "\$codex_root\/package\.json" \]/);
  assert.match(temporaryDockerfileContents, /npm install --prefix "\$codex_root"/);
  assert.match(temporaryDockerfileContents, /@openai\/codex-\$codex_platform@npm:@openai\/codex@\$codex_version-\$codex_platform/);
  assert.match(temporaryDockerfileContents, /&& codex --version/);

  assert.equal(cleanup.file, "docker");
  assert.deepEqual(cleanup.args, ["image", "rm", intermediateTag]);
});

test("legacy package Dockerfile is sanitized only in a temporary build file", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sandcastle-for-agent-legacy-build-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, ".sandcastle"));
  const legacyDockerfile = [
    "FROM node:22-bookworm",
    "RUN groupmod -o -g $AGENT_GID node && install -d -o $AGENT_UID -g $AGENT_GID /home/agent/.codex",
    "RUN npm install --include=optional -g @openai/codex \\",
    "  && codex --version",
    "USER ${AGENT_UID}:${AGENT_GID}",
    "",
  ].join("\n");
  await writeFile(join(cwd, ".sandcastle", "Dockerfile"), legacyDockerfile);
  const config = createProjectConfig({
    workflow: "simple-loop",
    projectName: "legacy-fixture",
  });
  /** @type {{file: string, args: string[], options: {cwd: string}}[]} */
  const invocations = [];
  let baseDockerfileContents = "";

  await buildImage({
    cwd,
    config,
    exec: async (file, args, options) => {
      invocations.push({ file, args, options });
      if (args[0] === "build" && args.includes("-f") && invocations.length === 1) {
        baseDockerfileContents = await readFile(
          args[args.indexOf("-f") + 1],
          "utf8",
        );
      }
    },
  });

  assert.equal(await readFile(join(cwd, ".sandcastle", "Dockerfile"), "utf8"), legacyDockerfile);
  assert.match(baseDockerfileContents, /temporary layer/);
  assert.doesNotMatch(baseDockerfileContents, /npm install[^\n]*@openai\/codex/);
  assert.equal(invocations[0].args.at(-1), join(cwd, ".sandcastle"));
  assert.equal(invocations[1].args.at(-1), join(cwd, ".sandcastle"));
});
