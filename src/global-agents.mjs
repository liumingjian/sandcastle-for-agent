/**
 * Resolve whether the host-wide AGENTS.md should be mounted into sandboxes.
 * Interactive setup makes this an explicit user decision; non-interactive
 * setup preserves an explicit config or falls back to host-file detection.
 * @param {object} options
 * @param {boolean} [options.explicit]
 * @param {boolean} options.detected
 * @param {boolean} [options.existing]
 * @param {boolean} [options.interactive]
 * @param {(initialValue: boolean) => Promise<boolean>} [options.ask]
 */
export async function resolveGlobalAgents({
  explicit,
  detected,
  existing,
  interactive = false,
  ask,
}) {
  if (explicit !== undefined) return explicit;
  if (interactive && detected) {
    if (!ask) throw new Error("Interactive AGENTS.md selection requires a prompt handler.");
    return Boolean(await ask(existing ?? true));
  }
  return existing ?? detected;
}
