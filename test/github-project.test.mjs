import assert from "node:assert/strict";
import test from "node:test";
import {
  assertReadyLabel,
  getReadyLabelWarning,
  hasReadyLabel,
} from "../src/github.mjs";
import { assertGitHead, parseEnv } from "../src/project.mjs";

test("GitHub label checks are case-insensitive", async () => {
  const exec = async () => ({ stdout: '[{"name":"Ready-For-Agent"}]' });
  assert.equal(await hasReadyLabel({ cwd: "/repo", env: {}, exec }), true);
  assert.equal(
    await getReadyLabelWarning({ cwd: "/repo", env: {}, exec }),
    undefined,
  );
});

test("missing label warns during initialization but is rejected before running", async () => {
  /** @type {[string, string[]][]} */
  const calls = [];
  /** @param {string} file @param {string[]} args */
  const exec = async (file, args) => {
    calls.push([file, args]);
    return { stdout: args[0] === "label" && args[1] === "list" ? "[]" : "" };
  };

  await assert.rejects(
    () => assertReadyLabel({ cwd: "/repo", env: {}, exec }),
    /Create it in the repository before running/,
  );
  const warning = await getReadyLabelWarning({ cwd: "/repo", env: {}, exec });
  assert.ok(warning);
  assert.match(warning, /Initialization will continue/);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0]?.[1].slice(0, 2), ["label", "list"]);
});

test("initialization also continues when the label cannot be queried", async () => {
  const warning = await getReadyLabelWarning({
    cwd: "/repo",
    env: {},
    exec: async () => {
      throw new Error("no GitHub remote");
    },
  });
  assert.ok(warning);
  assert.match(warning, /Could not verify/);
  assert.match(warning, /Initialization will continue/);
});

test("project env parser handles comments and quoted values", () => {
  assert.deepEqual(
    parseEnv("# comment\nGH_TOKEN='token'\nEMPTY=\nSPACED = value\n"),
    { GH_TOKEN: "token", EMPTY: "", SPACED: "value" },
  );
});

test("unborn Git repositories receive an actionable run error", async () => {
  await assert.rejects(
    () =>
      assertGitHead("/repo", async () => {
        throw new Error("fatal: ambiguous argument 'HEAD'");
      }),
    /HEAD is unborn.*initial commit/,
  );
  await assert.doesNotReject(() =>
    assertGitHead("/repo", async () => ({ stdout: "abc123\n" })),
  );
});
