/**
 * helpers.ts — Shared typed utilities for test files.
 *
 * Provides a typed `run()` function for CLI subprocess tests and a typed
 * mock CST node builder for unit tests that need tree-sitter-shaped objects
 * without loading the native parser.
 */

import { execFile } from "node:child_process";

// ── CLI subprocess helper ────────────────────────────────────────────────────

/** Result of running the CLI as a subprocess. */
export interface RunResult {
  stdout: string;
  stderr: string;
  code: number | string;
}

/**
 * Spawn the CLI with the given arguments and return stdout, stderr, and exit code.
 *
 * @param cli  Absolute path to the CLI entry point (dist/index.js).
 * @param args CLI arguments to pass after the entry point.
 */
export function run(cli: string, ...args: string[]): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile("node", [cli, ...args], { timeout: 15_000 }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout ?? "",
        stderr: stderr ?? "",
        code: err ? (err.code ?? 1) : 0,
      });
    });
  });
}

// ── Mock CST node builder ────────────────────────────────────────────────────

/**
 * Minimal mock of a tree-sitter SyntaxNode — just enough structure for
 * extract/classify/arrow tests without pulling in the native parser.
 */
export interface MockNode {
  type: string;
  text: string;
  startPosition: { row: number; column: number };
  namedChildren: MockNode[];
  children: Array<
    | MockNode
    | { type: string; text: string; isNamed: boolean; namedChildren: never[]; children: never[] }
  >;
  isNamed: boolean;
}

/** Build a mock CST node with the given type, children, text, and row. */
export function mockNode(
  type: string,
  namedChildren: MockNode[] = [],
  text = "",
  row = 0,
  anonymousChildren: string[] = [],
): MockNode {
  const children: MockNode["children"] = [];
  children.push(
    ...anonymousChildren.map((t) => ({
      type: t,
      text: t,
      isNamed: false as const,
      namedChildren: [] as never[],
      children: [] as never[],
    })),
  );
  children.push(...namedChildren.map((c) => ({ ...c, isNamed: true as const })));
  return { type, text, startPosition: { row, column: 0 }, namedChildren, children, isNamed: true };
}
