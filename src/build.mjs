import { execFile, spawn } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { CONFIG_DIR } from "./constants.mjs";

const execFileAsync = promisify(execFile);

/** @param {string} file @param {string[]} args @param {{cwd: string}} options */
function streamCommand(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { ...options, stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve(undefined);
      else {
        reject(
          new Error(
            `${file} exited with ${signal ? `signal ${signal}` : `code ${String(code)}`}.`,
          ),
        );
      }
    });
  });
}

/**
 * @param {object} options
 * @param {string} options.cwd
 * @param {import("./config.mjs").ProjectConfig} options.config
 * @param {(file: string, args: string[], options: {cwd: string}) => Promise<unknown>} [options.exec]
 */
export async function buildImage({ cwd, config, exec = streamCommand }) {
  const uid = process.getuid?.() ?? 1000;
  const gid = process.getgid?.() ?? 1000;
  await exec(
    "docker",
    [
      "build",
      "-t",
      config.imageName,
      "--build-arg",
      `AGENT_UID=${uid}`,
      "--build-arg",
      `AGENT_GID=${gid}`,
      join(cwd, CONFIG_DIR),
    ],
    { cwd },
  );
}

/** @param {object} options @param {string} options.cwd @param {import("./config.mjs").ProjectConfig} options.config */
export async function assertImageExists({ cwd, config }) {
  try {
    await execFileAsync("docker", ["image", "inspect", config.imageName], { cwd });
  } catch {
    throw new Error(
      `Docker image '${config.imageName}' is missing. Run 'sandcastle-for-agent build'.`,
    );
  }
}
