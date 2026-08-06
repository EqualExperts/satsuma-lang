/**
 * semantic-index.js — what the toolchain *understands* about a file, with every
 * position and every layout choice projected out.
 *
 * The formatter's existing generated properties all assert claims about **shape**:
 * idempotence, CST-structure preservation, and a recovery-free reparse. A
 * formatter that dropped the trailing source of a multi-source arrow, or
 * re-associated a pipe chain, would keep the CST well-formed and satisfy all
 * three. This module supplies the missing comparison basis — *meaning* — so a
 * property can state `extract(parse(src))` equals `extract(parse(format(src)))`.
 *
 * ## What "meaning" is taken to be here
 *
 * Every extractor `@satsuma/core` exposes, projected onto the fields a downstream
 * consumer reads, and nothing else. Two things are deliberately dropped:
 *
 * - **Positions.** Rows and columns are what the formatter exists to change, so a
 *   comparison that kept them would fail on every input.
 * - **Raw transform text.** `ExtractedArrow.transform_raw` and
 *   `ExtractedTransform.body` preserve the author's layout, and the formatter is
 *   explicitly permitted to reflow a pipe chain (sl-dxjh, ADR-033). The index
 *   keeps the decomposed `steps` and the canonical body instead, with each step's
 *   whitespace collapsed — a `map { a: 1 }` step's `text` is the node's raw text,
 *   interior spacing and all, so comparing it verbatim would report a legal
 *   reflow as a semantic change.
 *
 * Everything else is kept, including constructs today's generated domain never
 * emits — comments, transform blocks, metric metadata. They project to empty
 * arrays now, and the property they feed strengthens by itself the moment the
 * generator grows those shapes. That matters for comments in particular: the
 * formatter has dropped them before (`cbh-394k`, `cbh-0lhj`).
 *
 * Owns: the position-free projection and the definition of semantic equality for
 * formatter and diff properties. Does not own: parsing, formatting, or any
 * expectation — the properties state those.
 */

import {
  extractArrowRecords,
  extractFragments,
  extractImports,
  extractMappings,
  extractMetrics,
  extractNotes,
  extractQuestions,
  extractSchemas,
  extractTransforms,
  extractWarnings,
} from "@satsuma/core";

/**
 * One field declaration with its subtree, positions removed.
 *
 * `type` and `isList` together carry the declared shape, which is what makes a
 * type-changing defect visible; `metadata`, `spreads` and `hasSpreads` are read by
 * coverage and the lint rules, so a formatter that lost one would change meaning.
 */
function projectField(field) {
  return {
    name: field.name,
    type: field.type,
    isList: field.isList === true,
    metadata: field.metadata ?? [],
    hasSpreads: field.hasSpreads === true,
    spreads: field.spreads ?? [],
    children: (field.children ?? []).map(projectField),
  };
}

/** A schema-shaped declaration: `schema` and `fragment` bodies share this shape. */
function projectEntity(entity) {
  return {
    name: entity.name,
    namespace: entity.namespace,
    fields: entity.fields.map(projectField),
    hasSpreads: entity.hasSpreads,
    spreads: entity.spreads,
  };
}

/**
 * One pipe step, with the interior whitespace the formatter may reflow collapsed.
 *
 * `PipeStep.text` is the step node's raw text. For a `pipe_text` or
 * `fragment_spread` step that is already a single layout-free token, but a
 * `map_literal` step carries its own braces, commas and spacing — so the collapse
 * is what keeps this index a statement about content rather than about layout.
 */
function projectPipeStep(step) {
  return { type: step.type, text: step.text.replace(/\s+/g, " ").trim() };
}

/** A `//` note, `//!` warning or `//?` question, keyed by the block it annotates. */
function projectComment(comment) {
  return {
    text: comment.text,
    parent: comment.parent,
    // `parentType` on warnings and questions, `namespace` on notes — both are the
    // scope the comment was attached to, and both must survive formatting.
    scope: comment.parentType ?? comment.namespace ?? null,
  };
}

/**
 * The semantic index of one parsed Satsuma file.
 *
 * Deep-equal comparison of two indexes is the definition of "these two files mean
 * the same thing" used by the generated formatter properties. Declaration order is
 * preserved throughout, because order is semantically load-bearing: an
 * unqualified arrow path attaches to the *first* schema on its side of a mapping.
 *
 * @param {import("@satsuma/core").SyntaxNode} rootNode a recovery-free parse tree's root
 * @returns {object} a position-free, layout-free projection safe to deep-equal
 */
export function semanticIndexOf(rootNode) {
  return {
    imports: extractImports(rootNode).map(({ names, path }) => ({ names, path })),
    fragments: extractFragments(rootNode).map(projectEntity),
    schemas: extractSchemas(rootNode).map((schema) => ({
      ...projectEntity(schema),
      note: schema.note,
      blockMetadata: schema.blockMetadata ?? [],
    })),
    metrics: extractMetrics(rootNode).map((metric) => ({
      name: metric.name,
      namespace: metric.namespace,
      displayName: metric.displayName,
      sources: metric.sources,
      grain: metric.grain,
      slices: metric.slices,
      fields: metric.fields.map(projectField),
    })),
    mappings: extractMappings(rootNode).map((mapping) => ({
      name: mapping.name,
      namespace: mapping.namespace,
      sources: mapping.sources,
      targets: mapping.targets,
      arrowCount: mapping.arrowCount,
    })),
    arrows: extractArrowRecords(rootNode).map((arrow) => ({
      mapping: arrow.mapping,
      namespace: arrow.namespace,
      kind: arrow.kind,
      enumeratesChildren: arrow.enumeratesChildren,
      sources: arrow.sources,
      target: arrow.target,
      steps: arrow.steps.map(projectPipeStep),
      classification: arrow.classification,
      derived: arrow.derived,
      metadata: arrow.metadata ?? [],
    })),
    transforms: extractTransforms(rootNode).map((transform) => ({
      name: transform.name,
      namespace: transform.namespace,
      canonicalBody: transform.canonicalBody,
    })),
    notes: extractNotes(rootNode).map(projectComment),
    warnings: extractWarnings(rootNode).map(projectComment),
    questions: extractQuestions(rootNode).map(projectComment),
  };
}
