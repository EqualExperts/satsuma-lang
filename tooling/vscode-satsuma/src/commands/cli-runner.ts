import { execFile } from "child_process";
import { workspace } from "vscode";
import { exitCodeFrom, spawnFailureMessage } from "./cli-runner-logic";

export interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run a satsuma CLI command and return the result.
 * Resolves even on non-zero exit (caller checks exitCode).
 */
export function runCli(
  cliPath: string,
  args: string[],
  cwd?: string,
): Promise<CliResult> {
  const workDir =
    cwd ?? workspace.workspaceFolders?.[0]?.uri.fsPath ?? ".";

  return new Promise((resolve) => {
    execFile(
      cliPath,
      args,
      { cwd: workDir, timeout: 15_000, maxBuffer: 10 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          stdout: stdout ?? "",
          stderr: spawnFailureMessage(error, cliPath) ?? stderr ?? "",
          exitCode: exitCodeFrom(error),
        });
      },
    );
  });
}
