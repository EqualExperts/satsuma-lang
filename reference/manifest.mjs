/**
 * reference/manifest.mjs — the section registry for the AI Agent Reference.
 *
 * This is the single source of truth for which canonical `reference/*.md`
 * files exist, the order they compose in, and which task profile(s) need
 * each one. Every delivery envelope — the `satsuma agent-reference` CLI
 * command, the generated `AI-AGENT-REFERENCE.md` portable blob, and the
 * `satsuma-language` skill — is composed from this list by `compose.mjs`.
 * None of them hand-restate section content or ordering; changing this file
 * is the only way to add, remove, reorder, or reassign a section.
 *
 * Profile assignment follows the task-need analysis in
 * features/45-agent-reference-progressive-disclosure/PRD.md: a "write" task
 * (generating Satsuma) needs the grammar, conventions, common mistakes,
 * worked examples, and the generate-workflow steps; a "read" task (lineage,
 * impact, coverage, audit) needs the CLI command surface, composition
 * guidance, and the read-workflow steps. Both profiles include the full
 * conventions section — it is a superset, not a minimal cut, because a
 * reader also needs `@ref` and path-syntax rules that a writer needs.
 */

/** One canonical section. `profiles` lists every task-profile that needs it. */
export const SECTIONS = [
  { id: "grammar", file: "grammar.md", profiles: ["write"] },
  { id: "conventions", file: "conventions.md", profiles: ["write", "read"] },
  { id: "mistakes", file: "mistakes.md", profiles: ["write"] },
  { id: "examples", file: "examples.md", profiles: ["write"] },
  { id: "cli-index", file: "cli-index.md", profiles: ["read"] },
  { id: "cli-composition", file: "cli-composition.md", profiles: ["read"] },
  { id: "workflow-generate", file: "workflow-generate.md", profiles: ["write"] },
  { id: "workflow-read", file: "workflow-read.md", profiles: ["read"] },
];

/** Every profile a section can declare membership in — used to validate `--profile`. */
export const PROFILES = ["write", "read"];
