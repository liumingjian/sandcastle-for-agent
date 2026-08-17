import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { ensureHarnessDependencies } from "../src/harness-deps.mjs";

test("installs Harness dependencies in .sandcastle without touching the project package", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "sandcastle-for-agent-deps-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await mkdir(join(cwd, ".sandcastle"), { recursive: true });
  const rootPackage = '{"name":"project","dependencies":{"example":"1.0.0"}}\n';
  const rootLock = '{"name":"project","lockfileVersion":3}\n';
  await Promise.all([
    writeFile(join(cwd, "package.json"), rootPackage),
    writeFile(join(cwd, "package-lock.json"), rootLock),
  ]);

  /** @type {{file: string, args: string[], cwd: string} | undefined} */
  let invocation;
  await ensureHarnessDependencies({
    cwd,
    exec: async (file, args, options) => {
      invocation = { file, args, cwd: options.cwd };
    },
  });

  assert.deepEqual(invocation, {
    file: "npm",
    args: ["install", "--prefix", join(cwd, ".sandcastle"), "--no-audit", "--no-fund"],
    cwd,
  });
  const packageJson = JSON.parse(
    await readFile(join(cwd, ".sandcastle", "package.json"), "utf8"),
  );
  assert.equal(packageJson.dependencies["@ai-hero/sandcastle"], "0.12.0");
  assert.equal(packageJson.dependencies.tsx, "4.21.0");
  assert.equal(await readFile(join(cwd, "package.json"), "utf8"), rootPackage);
  assert.equal(await readFile(join(cwd, "package-lock.json"), "utf8"), rootLock);
});
