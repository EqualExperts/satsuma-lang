/**
 * warnings.ts — `satsuma warnings` command
 *
 * Lists all warning comments (//! ...) from the workspace.
 * With --questions, lists question comments (//?  ...) instead.
 *
 * Output format (default):
 *   file.stm:12  //! some records have NULL
 *
 * Flags:
 *   --questions   show //?  comments instead of //! comments
 *   --json        structured JSON output
 */

import type { Command } from "commander";
import { loadWorkspace } from "../load-workspace.js";
import { runCommand, EXIT_NOT_FOUND } from "../command-runner.js";
import type { WarningRecord, QuestionRecord } from "../types.js";

export function register(program: Command): void {
  program
    .command("warnings [path]")
    .description("List warning or question comments in a Satsuma file and its imports")
    .option("--questions", "show question comments (//?  ...) instead")
    .option("--json", "output JSON")
    .addHelpText(
      "after",
      `
JSON shape (--json):
  {
    "kind":  "warning" | "question",
    "count": int,
    "items": [{"text": str, "line": int, "file": str, "block": str, "blockType": str}, ...]
  }

Examples:
  satsuma warnings pipeline.stm              # //! warnings in file and imports
  satsuma warnings pipeline.stm --questions  # //? questions instead
  satsuma warnings pipeline.stm --json       # structured output`,
    )
    .action(
      runCommand(
        async (pathArg: string | undefined, opts: { questions?: boolean; json?: boolean }) => {
          const { index } = await loadWorkspace(pathArg);

          // By default show both //! and //? comments; --questions shows only //?
          type TaggedItem = (WarningRecord | QuestionRecord) & { _kind: "warning" | "question" };
          const taggedWarnings: TaggedItem[] = index.warnings.map((w) => ({
            ...w,
            _kind: "warning" as const,
          }));
          const taggedQuestions: TaggedItem[] = index.questions.map((q) => ({
            ...q,
            _kind: "question" as const,
          }));
          const items: TaggedItem[] = opts.questions
            ? taggedQuestions
            : [...taggedWarnings, ...taggedQuestions].sort(
                (a, b) => a.file.localeCompare(b.file) || a.row - b.row,
              );
          const kind = opts.questions ? "question" : "warning";

          if (opts.json) {
            const jsonItems = items.map((item) => ({
              text: item.text,
              line: item.row + 1,
              file: item.file,
              ...(item.parent ? { block: item.parent, blockType: item.parentType } : {}),
            }));
            console.log(
              JSON.stringify({ kind, count: jsonItems.length, items: jsonItems }, null, 2),
            );
            return items.length === 0 ? EXIT_NOT_FOUND : undefined;
          }

          if (items.length === 0) {
            console.log(`No ${kind} comments found.`);
            return EXIT_NOT_FOUND;
          }

          // Group by file
          const byFile = new Map<string, Array<WarningRecord | QuestionRecord>>();
          for (const item of items) {
            if (!byFile.has(item.file)) byFile.set(item.file, []);
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: key initialized on previous line
            byFile.get(item.file)!.push(item);
          }

          for (const [file, fileItems] of byFile) {
            console.log(file);
            for (const item of fileItems) {
              const prefix = (item as TaggedItem)._kind === "question" ? "//?" : "//!";
              console.log(`  :${item.row + 1}  ${prefix} ${item.text}`);
            }
            console.log();
          }
        },
      ),
    );
}
