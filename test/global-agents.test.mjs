import assert from "node:assert/strict";
import test from "node:test";
import { resolveGlobalAgents } from "../src/global-agents.mjs";

test("explicit AGENTS.md flags override detection and prompts", async () => {
  let asked = false;
  const result = await resolveGlobalAgents({
    explicit: false,
    detected: true,
    interactive: true,
    ask: async () => {
      asked = true;
      return true;
    },
  });

  assert.equal(result, false);
  assert.equal(asked, false);
});

test("interactive setup uses the user's AGENTS.md decision", async () => {
  let initialValue;
  const result = await resolveGlobalAgents({
    detected: true,
    existing: false,
    interactive: true,
    ask: async (initial) => {
      initialValue = initial;
      return true;
    },
  });

  assert.equal(initialValue, false);
  assert.equal(result, true);
});

test("non-interactive setup falls back to host-file detection", async () => {
  assert.equal(
    await resolveGlobalAgents({ detected: true, interactive: false }),
    true,
  );
  assert.equal(
    await resolveGlobalAgents({ detected: false, interactive: false }),
    false,
  );
});
