/**
 * static-compactness-model.mjs — the neutral fact model behind Feature 44's
 * arms S, Y and J.
 *
 * Feature 44 measures how many tokens a `.stm` spec is against "the same
 * mapping expressed as YAML/JSON". That comparison is only honest if all three
 * arms carry *identical information*, so this module owns the one definition of
 * what information a spec contains:
 *
 *   .stm source ──projectSpec()──▶ SpecModel ──▶ renderYaml() / renderJson()
 *
 * The `SpecModel` is deliberately a **projection, not a dump**. It keeps every
 * fact an author wrote and discards everything the parser derived or measured:
 * no row/column positions, no arrow counts, no resolved lineage. That
 * distinction is the whole point. The CLI's own `graph --json` export is the
 * counter-example the PRD cites — 12,388 bytes against a 151-byte `--compact`
 * form for the same file — and serialising *that* as YAML would measure the
 * verbosity of an internal representation rather than the verbosity of YAML.
 *
 * What this module does not own: token counting (see `reference/token-cost.mjs`,
 * the single counter for the whole repo) and the corpus sweep and reporting
 * (see `measure-static-compactness.mjs`).
 */

import * as core from "@satsuma/core";

/**
 * Positional and derived keys the projection strips from every extracted
 * record. Keeping any of them would inflate the YAML and JSON arms with
 * information the `.stm` author never wrote, manufacturing a win for Satsuma.
 */
const DERIVED_KEYS = new Set([
  "startRow",
  "startColumn",
  "row",
  "line",
  "arrowCount",
  "classification",
  // `derived` restates a fact the arrow's own shape already carries: the
  // extractor sets it for an arrow declared with no source (`-> target`), which
  // is visible as the absence of `sources`. Emitting it would make the YAML and
  // JSON arms pay twice for one fact.
  "derived",
]);

/**
 * Returns a copy of `record` without any {@link DERIVED_KEYS}, and without keys
 * whose value is `null`, `undefined`, `false` or an empty array. Absent facts
 * must be absent in every arm: an explicit `metadata: []` in YAML is bytes the
 * `.stm` never spent.
 */
function keepAuthoredFacts(record) {
  const kept = {};
  for (const [key, value] of Object.entries(record)) {
    if (DERIVED_KEYS.has(key)) continue;
    if (value === null || value === undefined || value === false) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    kept[key] = value;
  }
  return kept;
}

/**
 * Projects one field declaration, recursing into `record` and `list_of record`
 * bodies. A field carries its name, its type expression *including parameters*
 * (`CURRENCY(18,2)` is one fact, not two), its list-ness, its metadata tokens,
 * and any fragment spreads inside its body.
 */
function projectField(field) {
  const projected = keepAuthoredFacts({
    name: field.name,
    type: field.type,
    isList: field.isList,
    metadata: field.metadata,
    spreads: field.spreads,
  });
  // A record body holding nothing but a fragment spread has no direct children.
  // Keeping an empty list would make the renderers emit an empty `fields: {}`,
  // which is bytes for a fact that is not there.
  if (field.children?.length) projected.children = field.children.map(projectField);
  return projected;
}

/** Projects a schema or fragment body: its fields, plus any top-level spreads. */
function projectFieldContainer(container) {
  return keepAuthoredFacts({
    name: container.name,
    namespace: container.namespace,
    note: container.note,
    metadata: container.blockMetadata,
    spreads: container.spreads,
    fields: (container.fields ?? []).map(projectField),
  });
}

/**
 * Projects one arrow. `transform` is the authored transform body verbatim
 * (`transform_raw`), which is what a reader implements from; `steps` is the
 * parser's decomposition of that same text into pipe steps, kept because it
 * lets a renderer choose a per-step encoding without re-parsing. The two are
 * the same fact at different granularities — a renderer must emit one or the
 * other, never both, or the arm pays twice for one transform.
 */
function projectArrow(arrow) {
  return keepAuthoredFacts({
    kind: arrow.kind,
    sources: arrow.sources,
    target: arrow.target,
    transform: arrow.transform_raw,
    steps: arrow.steps,
    enumeratesChildren: arrow.enumeratesChildren,
    derived: arrow.derived,
  });
}

/**
 * Projects a parsed Satsuma file into the neutral fact model both non-Satsuma
 * arms render from.
 *
 * @param rootNode - the CST root of one parsed `.stm` file
 * @returns a plain-data model carrying every authored fact and no derived ones
 */
export function projectSpec(rootNode) {
  const arrowsByMapping = new Map();
  for (const arrow of core.extractArrowRecords(rootNode)) {
    const key = arrow.mapping;
    if (!arrowsByMapping.has(key)) arrowsByMapping.set(key, []);
    arrowsByMapping.get(key).push(projectArrow(arrow));
  }

  // Notes and warnings carry a `parent` naming the block they were written
  // inside. Grouping them onto that block is what lets a renderer put a
  // schema's note next to the schema, rather than in a detached list the way a
  // flat dump would.
  const notes = core.extractNotes(rootNode).map((n) => keepAuthoredFacts(n));
  const warnings = core.extractWarnings(rootNode).map((w) => keepAuthoredFacts(w));
  const questions = core.extractQuestions(rootNode).map((q) => keepAuthoredFacts(q));

  return keepAuthoredFacts({
    imports: core.extractImports(rootNode).map((i) => keepAuthoredFacts(i)),
    notes,
    warnings,
    questions,
    fragments: core.extractFragments(rootNode).map(projectFieldContainer),
    transforms: core.extractTransforms(rootNode).map((t) => keepAuthoredFacts(t)),
    // Metrics are deliberately absent. A metric is not a separate construct: it
    // is a `schema` block carrying a `(metric)` tag (spec §6), and
    // `extractMetrics` is a filtered *view* of the same blocks `extractSchemas`
    // already returns — with its metric metadata reshaped into named fields and
    // its `blockMetadata` dropped. Projecting both would emit every metric
    // twice and, because the metric view carries no `blockMetadata`, would lose
    // `metric_name`, `grain` and `filter` in the collision.
    schemas: core.extractSchemas(rootNode).map(projectFieldContainer),
    mappings: core.extractMappings(rootNode).map((m) =>
      keepAuthoredFacts({
        name: m.name,
        namespace: m.namespace,
        sources: m.sources,
        targets: m.targets,
        arrows: arrowsByMapping.get(m.name) ?? [],
      }),
    ),
  });
}

/**
 * Removes plain `//` comments from `source`, parser-backed.
 *
 * **Why the measurement needs this.** A `.stm` file carries `//` section
 * dividers and asides; the YAML and JSON arms this repo renders carry none,
 * because the projection has no comment construct. Comparing the authored
 * `.stm` against a comment-free YAML charges Satsuma for content the other arm
 * never has to hold — so the like-for-like figure strips comments from both
 * sides, and the authored figure is reported next to it as the conservative
 * variant.
 *
 * `//!` and `//?` are deliberately *not* stripped. They are `warning_comment`
 * nodes, the extractor surfaces them, and both non-Satsuma arms do carry them
 * (as the `"!"` and `"?"` keys), so they are content on both sides.
 *
 * Comment ranges come from the CST rather than a regular expression, because
 * `//` occurs inside string literals throughout the corpus — every URL in a
 * natural-language transform body would otherwise truncate.
 *
 * @param source - the `.stm` text the CST was parsed from
 * @param rootNode - that file's CST root
 * @returns the same source with plain comments and any lines they left empty removed
 */
export function stripPlainComments(source, rootNode) {
  const comments = [];
  (function collect(node) {
    // `//` comments never span lines, so one row per node is exact.
    if (node.type === "comment") {
      comments.push({
        row: node.startPosition.row,
        start: node.startPosition.column,
        end: node.endPosition.column,
      });
    }
    for (const child of node.children) collect(child);
  })(rootNode);

  const lines = source.split("\n");
  const deletedLines = new Set();
  // Right to left within a line, so an earlier comment's columns stay valid.
  for (const { row, start, end } of comments.sort((a, b) => b.row - a.row || b.start - a.start)) {
    const line = lines[row];
    if (line === undefined) continue;
    const withoutComment = line.slice(0, start) + line.slice(end);
    // A comment on its own line takes the line with it; a trailing comment
    // leaves the code that preceded it, minus the whitespace that separated them.
    if (withoutComment.trim().length === 0) deletedLines.add(row);
    else lines[row] = withoutComment.trimEnd();
  }
  return lines.filter((_, row) => !deletedLines.has(row)).join("\n");
}

/**
 * Every construct the projection must carry, as the totality contract. Feature
 * 44's blind pairing audit exists because an arm handed less information than
 * another is not a comparison; this list is that idea applied where it is
 * cheap — `assertTotality` fails the measurement rather than letting a new
 * language feature silently drop out of the YAML and JSON arms and shrink them.
 */
export const REQUIRED_CONSTRUCTS = [
  "imports",
  "notes",
  "warnings",
  "questions",
  "fragments",
  "transforms",
  "schemas",
  "mappings",
];

/**
 * Throws if `model` contains a top-level key outside {@link REQUIRED_CONSTRUCTS}.
 *
 * The failure direction that matters is a *new* construct appearing in the
 * projection with no renderer handling it. Callers pass the set of keys their
 * renderer knows how to emit; anything the projection produced that the
 * renderer would silently drop is an error, not a warning.
 *
 * @param model - a {@link projectSpec} result
 * @param renderedKeys - the construct keys the calling renderer emits
 */
export function assertTotality(model, renderedKeys) {
  const unhandled = Object.keys(model).filter((key) => !renderedKeys.includes(key));
  if (unhandled.length > 0) {
    throw new Error(
      `static-compactness: the projection produced construct(s) no renderer handles: ` +
        `${unhandled.join(", ")}. Every authored fact must appear in every arm, or the ` +
        `arms are not paired and the measured ratio is invalid. Add a rendering for it.`,
    );
  }
}
