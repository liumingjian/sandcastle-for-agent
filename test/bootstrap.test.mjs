import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  assertConfigurationTarget,
  assertInitializationTarget,
  initializeUpstreamSandcastle,
  preflightInitializer,
} from "../src/bootstrap.mjs";
import { UPSTREAM_SANDCASTLE_VERSION } from "../src/constants.mjs";

test("initialization installs and invokes the pinned upstream Harness", async () => {
  /** @type {{file: string, args: string[]}[]} */
  const calls = [];
  /** @param {string} file @param {string[]} args */
  const exec = async (file, args) => {
    calls.push({ file, args });
  };
  const accessFile = async () => {
    const error = new Error("missing");
    // @ts-expect-error Test fixture models an ENOENT error.
    error.code = "ENOENT";
    throw error;
  };

  const result = await initializeUpstreamSandcastle({
    cwd: "/repo",
    accessFile,
    exec,
  });

  assert.deepEqual(result, {
    createdPackageJson: true,
    version: UPSTREAM_SANDCASTLE_VERSION,
  });
  assert.deepEqual(calls[0], { file: "npm", args: ["init", "--yes"] });
  assert.deepEqual(calls[1]?.args.slice(0, 4), [
    "install",
    "--save-dev",
    "--save-exact",
    `@ai-hero/sandcastle@${UPSTREAM_SANDCASTLE_VERSION}`,
  ]);
  assert.deepEqual(calls[2], {
    file: "npm",
    args: [
      "exec",
      "--",
      "sandcastle",
      "init",
      "--agent",
      "codex",
      "--sandbox",
      "docker",
      "--issue-tracker",
      "github-issues",
      "--template",
      "parallel-planner-with-review",
      "--create-label",
      "false",
      "--install-template-deps",
      "false",
      "--build-image",
      "false",
    ],
  });
});

test("initialization keeps an existing package.json and rejects an existing Harness", async () => {
  /** @param {string} path */
  const existingPackage = async (path) => {
    if (path === join("/repo", "package.json")) return;
    throw new Error("missing");
  };
  /** @type {string[][]} */
  const calls = [];
  await initializeUpstreamSandcastle({
    cwd: "/repo",
    accessFile: existingPackage,
    exec: async (_file, args) => calls.push(args),
  });
  assert.equal(calls.some((args) => args[0] === "init"), false);

  /** @param {string} path */
  const existingHarness = async (path) => {
    if (path === join("/repo", ".sandcastle")) return;
    throw new Error("missing");
  };
  await assert.rejects(
    () => assertInitializationTarget({ cwd: "/repo", accessFile: existingHarness }),
    /already exists/,
  );
  await assert.doesNotReject(() =>
    assertConfigurationTarget({ cwd: "/repo", accessFile: existingHarness }),
  );
});

test("initializer preflight checks local auth, npm, Docker, gh and Codex", async () => {
  /** @type {string[]} */
  const calls = [];
  /** @type {string[]} */
  const checked = [];
  await preflightInitializer({
    cwd: "/repo",
    home: "/home/test",
    accessFile: async (path) => {
      checked.push(path);
    },
    exec: async (file) => {
      calls.push(file);
      return {};
    },
  });
  assert.deepEqual(checked, [
    "/home/test/.codex/config.toml",
    "/home/test/.codex/auth.json",
  ]);
  assert.deepEqual(calls, ["npm", "docker", "gh", "codex"]);
});
