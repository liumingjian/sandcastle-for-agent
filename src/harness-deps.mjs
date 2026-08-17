import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { runStreamingCommand } from "./command.mjs";
import { CONFIG_DIR, UPSTREAM_SANDCASTLE_VERSION } from "./constants.mjs";

const HARNESS_PACKAGE = {
  name: "sandcastle-for-agent-harness",
  private: true,
  type: "module",
  dependencies: {
    "@ai-hero/sandcastle": UPSTREAM_SANDCASTLE_VERSION,
    "smol-toml": "1.8.0",
    tsx: "4.21.0",
    zod: "4.4.3",
  },
};

/** @param {string} path @param {string} version */
async function packageVersionMatches(path, version) {
  try {
    const packageJson = JSON.parse(await readFile(path, "utf8"));
    return packageJson.version === version;
  } catch {
    return false;
  }
}

/** @param {string} configDir */
async function harnessDependenciesExist(configDir) {
  try {
    await access(
      join(
        configDir,
        "node_modules",
        ".bin",
        process.platform === "win32" ? "tsx.cmd" : "tsx",
      ),
    );
  } catch {
    return false;
  }
  const packages = [
    ["@ai-hero/sandcastle", UPSTREAM_SANDCASTLE_VERSION],
    ["smol-toml", "1.8.0"],
    ["tsx", "4.21.0"],
    ["zod", "4.4.3"],
  ];
  return (
    await Promise.all(
      packages.map(([name, version]) =>
        packageVersionMatches(
          join(configDir, "node_modules", ...name.split("/"), "package.json"),
          version,
        ),
      ),
    )
  ).every(Boolean);
}

/**
 * Install the dependencies needed by the upstream main.mts in its own
 * package scope. The target project's package manager files are untouched.
 * @param {object} options
 * @param {string} options.cwd
 * @param {(file: string, args: string[], options: {cwd: string}) => Promise<unknown>} [options.exec]
 */
export async function ensureHarnessDependencies({
  cwd,
  exec = runStreamingCommand,
}) {
  const configDir = join(cwd, CONFIG_DIR);
  const packagePath = join(configDir, "package.json");
  /** @type {Record<string, any>} */
  let existing = {};
  try {
    existing = JSON.parse(await readFile(packagePath, "utf8"));
  } catch {
    // The upstream scaffold does not create a package.json in .sandcastle.
  }
  const packageJson = {
    ...existing,
    ...HARNESS_PACKAGE,
    dependencies: {
      ...(existing.dependencies ?? {}),
      ...HARNESS_PACKAGE.dependencies,
    },
  };
  await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
  if (await harnessDependenciesExist(configDir)) return packagePath;
  await exec(
    "npm",
    ["install", "--prefix", configDir, "--no-audit", "--no-fund"],
    { cwd },
  );
  return packagePath;
}
