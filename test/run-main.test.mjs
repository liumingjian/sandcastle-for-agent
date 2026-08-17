import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeGeneratedMain } from "../src/run.mjs";

test("run delegates directly to the generated upstream entrypoint", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sandcastle-for-agent-run-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, ".sandcastle"), { recursive: true });
  await writeFile(join(cwd, ".sandcastle", "main.mts"), "console.log('upstream');\n");

  /** @type {{file: string, args: string[], cwd: string} | undefined} */
  let invocation;
  await executeGeneratedMain({
    cwd,
    exec: async (file, args, options) => {
      invocation = { file, args, cwd: options.cwd };
    },
  });

  assert.deepEqual(invocation, {
    file: "npx",
    args: ["tsx", ".sandcastle/main.mts"],
    cwd,
  });
});
