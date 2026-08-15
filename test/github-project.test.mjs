import assert from "node:assert/strict";
import test from "node:test";
import { assertReadyLabel, hasReadyLabel } from "../src/github.mjs";
import { parseEnv } from "../src/project.mjs";

test("GitHub label checks are case-insensitive", async () => {
  const exec = async () => ({ stdout: '[{"name":"Ready-For-Agent"}]' });
  assert.equal(await hasReadyLabel({ cwd: "/repo", env: {}, exec }), true);
});

test("missing label is rejected and never created", async () => {
  /** @type {[string, string[]][]} */
  const calls = [];
  /** @param {string} file @param {string[]} args */
  const exec = async (file, args) => {
    calls.push([file, args]);
    return { stdout: args[0] === "label" && args[1] === "list" ? "[]" : "" };
  };

  await assert.rejects(
    () => assertReadyLabel({ cwd: "/repo", env: {}, exec }),
    /Create it in the repository before initialization/,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0]?.[1].slice(0, 2), ["label", "list"]);
});

test("project env parser handles comments and quoted values", () => {
  assert.deepEqual(
    parseEnv("# comment\nGH_TOKEN='token'\nEMPTY=\nSPACED = value\n"),
    { GH_TOKEN: "token", EMPTY: "", SPACED: "value" },
  );
});
