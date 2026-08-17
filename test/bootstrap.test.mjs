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

test("initialization invokes the pinned upstream Harness", async () => {
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
    version: UPSTREAM_SANDCASTLE_VERSION,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.file, process.execPath);
  assert.ok(calls[0]?.args[0]?.endsWith(
    "/node_modules/@ai-hero/sandcastle/dist/main.js",
  ));
  assert.deepEqual(calls[0]?.args.slice(1), [
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
  ]);
});

test("initialization resolves a hoisted upstream dependency from the npx root", async () => {
  /** @type {string[][]} */
  const calls = [];
  const hoistedCliPath =
    "/npx-root/node_modules/@ai-hero/sandcastle/dist/main.js";
  const hoistedPackageEntry =
    "/npx-root/node_modules/@ai-hero/sandcastle/dist/index.js";

  await initializeUpstreamSandcastle({
    cwd: "/repo",
    accessFile: async () => {
      throw new Error("missing");
    },
    resolveModule: (specifier) => {
      assert.equal(specifier, "@ai-hero/sandcastle");
      return hoistedPackageEntry;
    },
    exec: async (_file, args) => calls.push(args),
  });

  assert.equal(calls[0]?.[0], hoistedCliPath);
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

test("initialization does not modify the target package manager files", async () => {
  /** @type {{file: string, args: string[]}[]} */
  const calls = [];
  /** @param {string} path */
  const existingPackage = async (path) => {
    if (path === join("/repo", "package.json")) return;
    throw new Error("missing");
  };

  await initializeUpstreamSandcastle({
    cwd: "/repo",
    accessFile: existingPackage,
    exec: async (file, args) => {
      calls.push({ file, args });
    },
  });

  assert.equal(calls.some(({ args }) => args[0] === "install"), false);
  assert.equal(calls.some(({ args }) => args[1] === "init"), true);
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
