import { spawn } from "node:child_process";

/**
 * @param {string} file
 * @param {string[]} args
 * @param {{cwd: string, env?: NodeJS.ProcessEnv}} options
 */
export function runStreamingCommand(file, args, options) {
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
