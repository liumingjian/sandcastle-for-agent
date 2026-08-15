import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import {
  createHostCodexRuntime,
  getCodexMounts,
  preflightHostCodex,
  renderCodexConfig,
  withoutApiKeyEnv,
} from "../src/codex-host.mjs";
import { createProjectConfig } from "../src/config.mjs";

const cwd = "/project";
const home = "/home/tester";

function config(loadGlobalAgents = false) {
  return createProjectConfig({
    workflow: "simple-loop",
    projectName: "project",
    loadGlobalAgents,
  });
}

test("generated Codex config delegates model selection to workflow stages", () => {
  const source = renderCodexConfig("http://host.docker.internal:15721/v1");

  assert.match(source, /requires_openai_auth = true/);
  assert.doesNotMatch(source, /^model\s*=/m);
  assert.doesNotMatch(source, /review_model/);
});

test("host authentication is mounted read-only and AGENTS.md is optional", () => {
  const basic = getCodexMounts({ cwd, home, config: config() });
  assert.equal(basic.length, 2);
  assert.deepEqual(basic[1], {
    hostPath: join(home, ".codex", "auth.json"),
    sandboxPath: "~/.codex/auth.json",
    readonly: true,
  });

  const withAgents = getCodexMounts({ cwd, home, config: config(true) });
  assert.equal(withAgents.length, 3);
  assert.equal(withAgents[2].hostPath, join(home, ".codex", "AGENTS.md"));
  assert.ok(withAgents.every((mount) => mount.readonly));
});

test("preflight checks host files and invokes Codex without API key variables", async () => {
  /** @type {string[]} */
  const checked = [];
  /** @type {{file: string, args: string[], options: object} | undefined} */
  let invocation;
  await preflightHostCodex({
    cwd,
    home,
    config: config(true),
    accessFile: async (path) => checked.push(path),
    exec: async (file, args, options) => {
      invocation = { file, args, options };
      return {};
    },
  });

  assert.deepEqual(checked, [
    join(home, ".codex", "auth.json"),
    join(cwd, ".sandcastle", "codex-config.toml"),
    join(home, ".codex", "AGENTS.md"),
  ]);
  assert.ok(invocation);
  assert.equal(invocation.file, "codex");
  assert.deepEqual(invocation.args, ["login", "status"]);
  const options = /** @type {{env: NodeJS.ProcessEnv}} */ (invocation.options);
  assert.equal(options.env.OPENAI_API_KEY, undefined);
  assert.equal(options.env.CODEX_API_KEY, undefined);
});

test("API key variables are removed without mutating the source environment", () => {
  const source = { OPENAI_API_KEY: "secret", GH_TOKEN: "github" };
  const clean = withoutApiKeyEnv(source);

  assert.deepEqual(clean, { GH_TOKEN: "github" });
  assert.equal(source.OPENAI_API_KEY, "secret");
});

test("host runtime forwards the recommended Luna max setting to Codex", () => {
  const runtime = createHostCodexRuntime({
    cwd,
    config: createProjectConfig({
      workflow: "parallel-planner-with-review",
      projectName: "project",
    }),
    ghToken: "github-token",
  });
  const command = runtime.agent("implementer").buildPrintCommand({
    prompt: "work",
    dangerouslySkipPermissions: true,
  });

  assert.match(command.command, /-m 'gpt-5\.6-luna'/);
  assert.match(command.command, /model_reasoning_effort="max"/);
});
