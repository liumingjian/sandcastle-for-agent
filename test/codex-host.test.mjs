import assert from "node:assert/strict";
import test from "node:test";
import { join } from "node:path";
import {
  preflightHostCodex,
  renderCodexConfig,
  syncHostCodexConfig,
  toContainerBaseUrl,
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
  const source = renderCodexConfig(`
model_provider = "local"

[model_providers.local]
name = "Local gateway"
base_url = "http://127.0.0.1:15721/v1"
wire_api = "responses"
requires_openai_auth = true
http_headers = { Authorization = "do-not-copy" }

[mcp_servers.private]
url = "https://private.example.com"
`);

  assert.match(source, /requires_openai_auth = true/);
  assert.match(source, /base_url = "http:\/\/host\.docker\.internal:15721\/v1"/);
  assert.doesNotMatch(source, /^model\s*=/m);
  assert.doesNotMatch(source, /review_model/);
  assert.doesNotMatch(source, /do-not-copy|mcp_servers|private\.example/);
});

test("only host-local provider addresses are rewritten for Docker", () => {
  assert.equal(
    toContainerBaseUrl("http://localhost:15721/v1"),
    "http://host.docker.internal:15721/v1",
  );
  assert.equal(
    toContainerBaseUrl("https://api.example.com/v1"),
    "https://api.example.com/v1",
  );
});

test("host Codex config is detected and written to the local Harness", async () => {
  /** @type {{path?: string, data?: string}} */
  const written = {};
  const paths = await syncHostCodexConfig({
    cwd,
    home,
    readHostFile: async (path) => {
      assert.equal(path, join(home, ".codex", "config.toml"));
      return 'openai_base_url = "http://[::1]:15721/v1"\n';
    },
    writeConfig: async (path, data) => {
      written.path = path;
      written.data = data;
    },
  });
  assert.equal(paths.containerPath, join(cwd, ".sandcastle", "codex-config.toml"));
  assert.equal(written.path, paths.containerPath);
  assert.match(written.data ?? "", /host\.docker\.internal:15721/);
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
