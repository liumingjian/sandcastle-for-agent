import assert from "node:assert/strict";
import test from "node:test";
import { assertReadyLabel, ensureReadyLabel, hasReadyLabel } from "../src/github.mjs";
import { parseEnv } from "../src/project.mjs";

test("GitHub label checks are case-insensitive", async () => {
  const exec = async () => ({ stdout: '[{"name":"Ready-For-Agent"}]' });
  assert.equal(await hasReadyLabel({ cwd: "/repo", env: {}, exec }), true);
});

test("missing label can be rejected or created with the fixed name", async () => {
  /** @type {[string, string[]][]} */
  const calls = [];
  /** @param {string} file @param {string[]} args */
  const exec = async (file, args) => {
    calls.push([file, args]);
    return { stdout: args[0] === "label" && args[1] === "list" ? "[]" : "" };
  };

  await assert.rejects(
    () => assertReadyLabel({ cwd: "/repo", env: {}, exec }),
    /ready-for-agent/,
  );
  assert.equal(await ensureReadyLabel({ cwd: "/repo", env: {}, exec }), true);
  assert.deepEqual(calls.at(-1)?.[1].slice(0, 3), [
    "label",
    "create",
    "ready-for-agent",
  ]);
});

test("project env parser handles comments and quoted values", () => {
  assert.deepEqual(
    parseEnv("# comment\nGH_TOKEN='token'\nEMPTY=\nSPACED = value\n"),
    { GH_TOKEN: "token", EMPTY: "", SPACED: "value" },
  );
});
