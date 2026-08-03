/**
 * field-positions.ts — Where does the CLI say a field is declared?
 *
 * Commands that emit `file` + `line` for a field (so a downstream UI can offer
 * an editor-jump link) all face the same question: what position does a field
 * that arrived via a fragment spread get? This module owns the answer, so the
 * rule is stated once instead of re-derived per command, and projects a CLI
 * field tree onto the shape `@satsuma/core`'s coverage walk consumes.
 *
 * Owns: the declaration-row rule for own vs spread-expanded fields.
 * Does not own: field extraction (satsuma-core) or spread expansion
 * (spread-expand.ts) — it only interprets their output.
 */

import { declaresRecordBody } from "@satsuma/core";
import type { CoverageField, ExpandedField } from "@satsuma/core";

/** Where the entity that declares (or spreads in) a field lives. */
export interface DeclaringEntity {
  /** Absolute path of the file containing the entity's block. */
  file: string;
  /** 0-indexed row of the entity's block header. */
  row: number;
}

/**
 * The 0-indexed row the CLI reports for one field, or undefined when no
 * trustworthy position exists. Callers must propagate the absence rather than
 * substitute 0, which reads as line 1 and points at the wrong place.
 *
 * **Rule (cbh-5lzd): a spread-expanded field is reported at the consuming
 * entity, not at the fragment that declared it.** Spread expansion copies
 * fragment `FieldDecl`s wholesale, so `startRow` on such a field is a row in
 * the *fragment's* file. Pairing it with the consuming schema's file — which is
 * the file every command reports — yields a position that looks precise and is
 * wrong. `find` already resolves this the same way; coverage follows it so the
 * two commands cannot disagree about where a spread field lives.
 *
 * The consuming entity's block header is the honest answer available without
 * tracking spread-site positions through expansion: it is in the right file and
 * lands the reader on the schema whose coverage is being reported.
 *
 * @param withinSpread True when this field, or any ancestor of it, arrived via
 *   a spread. Only the field copied directly out of the fragment carries
 *   `fromFragment`; its own children do not, so the caller must carry the flag
 *   down the tree — {@link toCoverageFields} does exactly that.
 */
export function fieldDeclarationRow(
  field: ExpandedField,
  entity: DeclaringEntity,
  withinSpread: boolean,
): number | undefined {
  if (withinSpread || field.fromFragment !== undefined) return entity.row;
  return field.startRow;
}

/**
 * Project a CLI field tree onto core's minimal coverage input shape, resolving
 * each field's declaration row via {@link fieldDeclarationRow}.
 *
 * `fields` must already have had its spreads expanded by the caller — this
 * function reports positions, it does not resolve fragments.
 */
export function toCoverageFields(
  fields: ExpandedField[],
  entity: DeclaringEntity,
  withinSpread = false,
): CoverageField[] {
  return fields.map((field) => {
    const spread = withinSpread || field.fromFragment !== undefined;
    const row = fieldDeclarationRow(field, entity, withinSpread);
    const projected: CoverageField = { name: field.name };
    if (row !== undefined) projected.line = row;
    // Declared from the type, not inferred from the child list: `record {}` has
    // no children and would otherwise reach core as a scalar (`ccc-3vaw`).
    if (declaresRecordBody(field.type)) projected.container = true;
    if (field.children && field.children.length > 0) {
      projected.children = toCoverageFields(field.children, entity, spread);
    }
    return projected;
  });
}
