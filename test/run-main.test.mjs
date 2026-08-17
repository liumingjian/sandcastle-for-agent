import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { executeRunScript } from "../src/run.mjs";

test("run delegates to the generated upstream package script", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sandcastle-for-agent-run-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, ".sandcastle"), { recursive: true });
  await writeFile(join(cwd, ".sandcastle", "main.mts"), "console.log('upstream');\n");
  await writeFile(
    join(cwd, "package.json"),
    '{"scripts":{"sandcastle":"npx tsx .sandcastle/main.mts"}}\n',
  );

  /** @type {{file: string, args: string[], cwd: string} | undefined} */
  let invocation;
  await executeRunScript({
    cwd,
    exec: async (file, args, options) => {
      invocation = { file, args, cwd: options.cwd };
    },
  });

  assert.deepEqual(invocation, {
    file: "npm",
    args: ["run", "sandcastle"],
    cwd,
  });
});
