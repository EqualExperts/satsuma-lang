/**
 * lint-findings.ts — the shape a core lint detector reports.
 *
 * Owns the output contract shared by every structural lint rule whose detection
 * logic lives in core (PRD 37 R3), so the CLI's `lint` command and the LSP's
 * diagnostics can be fed from the same detector without either package owning
 * the other's shape.
 *
 * It does **not** own severity policy per rule (each detector states its own,
 * and the rationale belongs next to the rule), rule registration, suppression,
 * or fixes — fixes are text rewrites and stay with the consumer that owns the
 * file on disk.
 *
 * Why this is not {@link SemanticDiagnostic}: the two are structurally identical
 * today, and deliberately separate. A `validate` diagnostic says the workspace is
 * *wrong*; a lint finding says it breaks a *policy* the workspace may have chosen
 * — the distinction the `lint`/`validate` split exists to draw, and the reason
 * only one of the two is suppressible via `satsuma.config.yaml`. Keeping them
 * apart also means a field one side later needs (lint fixability, for instance)
 * does not widen a contract that crosses the LSP protocol boundary.
 */

/**
 * One finding from a core lint detector.
 *
 * Positions are 1-indexed in both axes, matching {@link SemanticDiagnostic} and
 * CLI output. LSP consumers subtract 1 from each.
 */
export interface LintFinding {
  /** Rule id, e.g. `type-mismatch-direct-arrow`. Stable: CI and configs key off it. */
  readonly rule: string;
  /** Severity as the rule itself defines it — detectors never leave this to the caller. */
  readonly severity: "error" | "warning";
  /** Absolute path (CLI) or URI (LSP) of the file the finding is reported against. */
  readonly file: string;
  /** 1-indexed line of the declaration that triggered the finding. */
  readonly line: number;
  /** 1-indexed column; `1` for findings anchored to a whole declaration. */
  readonly column: number;
  /** Human-readable message, complete enough to act on without opening the file. */
  readonly message: string;
}
