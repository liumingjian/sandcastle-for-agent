import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_DIR } from "./constants.mjs";

export const RUN_SCRIPT_NAME = "sandcastle";

/** @param {string} path */
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** @param {string} cwd @param {string} mainFilename */
export async function ensureRunScript(cwd, mainFilename) {
  const command = `npx tsx ${CONFIG_DIR}/${mainFilename}`;
  const rootPackagePath = join(cwd, "package.json");
  const rootPackage = await readJson(rootPackagePath);

  if (rootPackage) {
    const existingCommand = rootPackage.scripts?.[RUN_SCRIPT_NAME];
    if (existingCommand !== undefined && existingCommand !== command) {
      throw new Error(
        `package.json already defines '${RUN_SCRIPT_NAME}' with a different command. Rename that script before running sandcastle-for-agent build.`,
      );
    }
    const scripts = {
      ...(rootPackage.scripts ?? {}),
      [RUN_SCRIPT_NAME]: command,
    };
    await writeFile(
      rootPackagePath,
      `${JSON.stringify({ ...rootPackage, scripts }, null, 2)}\n`,
    );
    return { command: "npm", args: ["run", RUN_SCRIPT_NAME], cwd };
  }

  const harnessPackagePath = join(cwd, CONFIG_DIR, "package.json");
  const harnessPackage = (await readJson(harnessPackagePath)) ?? {
    name: "sandcastle-for-agent-harness",
    private: true,
    type: "module",
  };
  await writeFile(
    harnessPackagePath,
    `${JSON.stringify(
      {
        ...harnessPackage,
        scripts: {
          ...(harnessPackage.scripts ?? {}),
          [RUN_SCRIPT_NAME]: `npx tsx ${mainFilename}`,
        },
      },
      null,
    )}\n`,
  );
  return {
    command: "npm",
    args: ["--prefix", CONFIG_DIR, "run", RUN_SCRIPT_NAME],
    cwd,
  };
}

/** @param {string} cwd @param {string} mainFilename */
export async function resolveRunScript(cwd, mainFilename) {
  const rootPackage = await readJson(join(cwd, "package.json"));
  const expectedRootCommand = `npx tsx ${CONFIG_DIR}/${mainFilename}`;
  if (rootPackage?.scripts?.[RUN_SCRIPT_NAME] === expectedRootCommand) {
    return { command: "npm", args: ["run", RUN_SCRIPT_NAME], cwd };
  }

  const harnessPackagePath = join(cwd, CONFIG_DIR, "package.json");
  try {
    await access(harnessPackagePath);
  } catch {
    throw new Error(
      `Missing ${RUN_SCRIPT_NAME} script. Run 'sandcastle-for-agent build' first.`,
    );
  }
  const harnessPackage = await readJson(harnessPackagePath);
  if (harnessPackage?.scripts?.[RUN_SCRIPT_NAME] !== `npx tsx ${mainFilename}`) {
    throw new Error(
      `Missing ${RUN_SCRIPT_NAME} script. Run 'sandcastle-for-agent build' first.`,
    );
  }
  return {
    command: "npm",
    args: ["--prefix", CONFIG_DIR, "run", RUN_SCRIPT_NAME],
    cwd,
  };
}
