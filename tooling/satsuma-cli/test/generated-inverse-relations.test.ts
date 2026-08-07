/**
 * generated-inverse-relations.test.ts — the three read-only query commands,
 * stated as inverses of what a generated workspace declares.
 *
 * `arrows`, `where-used` and `find` all answer a question the scenario already
 * knows the answer to. An arrow the workspace declares must be discoverable from
 * both of its ends; a schema used by a mapping must be found from the schema's
 * side; a metadata tag nobody wrote must not be found at all. None of the three
 * had generated coverage before this file (Feature 46 R6, `gpt-clpj`) — every
 * existing test for them is a fixture case, and fixtures only ever prove the
 * shapes someone thought to write down.
 *
 * The properties are stated against the *scenario*, whose own arrow declarations
 * are the ground truth, so no expected value is re-derived from production code.
 * See `@satsuma/scenario-gen`'s `ground-truth.js`.
 *
 * ## What these commands actually are — three corrections to the ticket
 *
 * The ticket describes `where-used` as returning "the arrows `scenarioFieldEdges`
 * says touch a field", and `find` as resolving "every declared entity". Neither
 * is what the commands do, so neither property is stated that way here:
 *
 * - **`arrows <schema.field>`** is the field-level command, and the one the
 *   arrow-inverse property belongs to. It is stated below in all three of its
 *   forms: unfiltered, `--as-source`, `--as-target`.
 * - **`where-used <name>`** is *entity*-level: it takes a schema, fragment or
 *   transform name and returns the mappings, metrics, fragment spreads, imports
 *   and NL `@ref` sites that mention it. It cannot be given a field path at all.
 *   Its inverse is `scenarioSchemaEdges` plus the `nl-derived` tier of
 *   `scenarioFieldEdges`.
 * - **`find --tag <token>`** is a metadata search, not a name resolver. The only
 *   metadata a generated workspace carries is the metric block's `metric`,
 *   `metric_name` and `source` tokens, so that is what the positive property
 *   asserts; every other tag must find nothing.
 *
 * ## Three things deliberately not asserted
 *
 * **`nl-derived` arrows on the target side.** `arrows` adds an inferred arrow only
 * when the *queried field is the `@ref` source* — its own module comment says
 * "target-side discovery uses field-lineage". So the expectation below drops
 * `nl-derived` edges from the target direction. This is a contract, not a
 * work-around: the mutation check for this ticket removes the source-side half,
 * and {@link NL_DERIVED_CLASSIFICATION} is the only place the tier is named.
 *
 * **`import` reference counts.** `where-used` reports one `import` ref per import
 * statement naming the entity. The expected value is a property of the
 * *generator's derived imports*, and restating that derivation here would make
 * the oracle a copy of the generator. Each `import` ref is therefore checked
 * against the weaker, still falsifiable rule that it names a file the workspace
 * declares.
 *
 * **`r0-7w76`, and the `nl-derived` rules outside the generated domain.** A
 * container header whose target is a schema root is not generated and is not
 * asserted over; nor are `@ref` self-reference and duplicate suppression. Both
 * exclusions are the generator's, and both are documented in its `ground-truth.js`
 * header. Nothing here needs a special case for them because nothing here can
 * generate them.
 *
 * ## One exclusion this file owns: leaf-name ambiguity inside a schema
 *
 * `arrows` falls back to a bare **leaf-name** lookup so a nested field can be
 * queried by its last segment (`arrows.ts`'s `altKey` loop). When one schema
 * declares two paths ending in the same segment — the kitchen-sink workspace's
 * `raw.field_0` and `raw.lines.field_0` — the fallback returns the other path's
 * arrows as well, in both directions and under `--as-source`/`--as-target` too.
 *
 * That behaviour is **half intended and half not**, and the split is `sl-xj4p`
 * (closed): its acceptance criterion 2 asks that an ambiguous leaf-name query
 * "still work as before (show all matches)", while criterion 1 asks that a deeply
 * nested path "resolve correctly". So:
 *
 * - `arrows ::raw.field_0` returning `raw.lines.field_0`'s arrow is criterion 2
 *   applied to a query that *also* names a declared top-level path exactly.
 *   Whether an exact path should beat the leaf fallback is undecided, and nothing
 *   here decides it. Pinned below by {@link describe} "known behaviour" so it
 *   cannot change unnoticed.
 * - `arrows warehouse::staged.lines.field_0 --as-source` used to return
 *   `staged.field_0 → revenue_metric.field_0` — a different field's arrow, and the
 *   *only* answer, since the queried field has no outgoing arrow. That contradicted
 *   criterion 1 outright and was filed as `gpt-qhfo`. `warehouse::staged.lines.field_0`
 *   is a fully qualified nested path, not a bare leaf name, so it was never covered
 *   by criterion 2's "show all matches" — the fix tightens the `altKey` loop's
 *   `pathExistsInSchema` guard and `arrowPathMatches`'s suffix check (both in
 *   `arrows.ts`) to require the exact path when one was given, and the case below
 *   now asserts the corrected empty answer instead of pinning the old wrong one.
 *
 * The exact-set property still skips both affected paths via
 * {@link leafAmbiguousPaths} rather than skipping the workspace that contains them —
 * the leaf-name conflation the property sidesteps is itself unchanged by the
 * `gpt-qhfo` fix, since `field_0` and `lines.field_0` still share a leaf name.
 * Every unambiguous path of that same workspace is still asserted.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fc from "fast-check";
import {
  GENERATED_PROPERTY_PARAMETERS,
  kitchenSinkWorkspace,
  metricWorkspaceArbitrary,
  nlRefWorkspaceArbitrary,
  scenarioDeclaredFieldPaths,
  scenarioFieldEdges,
  scenarioSchemaEdges,
  workspaceScenarioArbitrary,
} from "@satsuma/scenario-gen";
import type {
  ScenarioFieldEdge,
  ScenarioSchemaEdge,
  ScenarioWorkspace,
} from "@satsuma/scenario-gen";
import { register as registerArrows } from "#src/commands/arrows.js";
import { register as registerFind } from "#src/commands/find.js";
import { register as registerWhereUsed } from "#src/commands/where-used.js";
import { EXIT_NOT_FOUND, EXIT_OK } from "#src/command-runner.js";
import { runCliCommand } from "./support/run-cli-command.js";
import type { CliCommandResult } from "./support/run-cli-command.js";
import {
  disposeGeneratedWorkspace,
  loadGeneratedWorkspace,
} from "./support/generated-workspace.js";
import type { LoadedGeneratedWorkspace } from "./support/generated-workspace.js";

// The WASM parser is initialised by `test/setup.ts`, which the test script
// preloads with `--import`.

// ── Vocabulary the commands' output is written in ──────────────────────────

/**
 * The classification `arrows` and the graph give an edge inferred from an `@ref`
 * mention rather than declared by an arrow. Named because the target-side
 * asymmetry documented in this module's header turns on it, and because it is
 * what the ticket's mutation check removes.
 */
const NL_DERIVED_CLASSIFICATION = "nl-derived";

/** How `arrows --json` joins a multi-source arrow's sources into one field. */
const MULTI_SOURCE_SEPARATOR = ", ";

/**
 * `find`'s placeholder in the `field` column for a match on a *block's* own
 * metadata rather than a field's. A metric block's `metric` token is such a
 * match, so every expected match in this file carries it.
 */
const BLOCK_LEVEL_MATCH_FIELD = "(schema)";

/**
 * Metadata tags no generated workspace can declare.
 *
 * The generator emits field declarations with no metadata at all, and block
 * metadata only on a metric. Any match for one of these is `find` matching
 * something other than metadata — a field name, a type, or a prefix of a tag it
 * does know (the `sl-xav4` class).
 */
const UNDECLARED_TAGS = ["pii", "pk", "required", "enum", "note", "ref"] as const;

/** The tags a generated metric block does declare, in the order it writes them. */
const METRIC_BLOCK_TAGS = ["metric", "metric_name"] as const;

/** The tag a generated metric block declares once per `metricSources` entry. */
const METRIC_SOURCE_TAG = "source";

/**
 * The prose `arrows` prints — even under `--json` — when a field resolved but has
 * no arrows.
 *
 * Load-bearing, not decoration. `arrows` exits `EXIT_NOT_FOUND` for *three*
 * different answers: "no arrows", "no such schema" and "no such field in that
 * schema". Only the first is an empty answer; the other two mean the command could
 * not resolve a path the workspace declares, which is a defect and must not be
 * read as "the declared field has no arrows". The exit code alone cannot tell them
 * apart, so {@link arrowEdgesFor} checks for this text — the same "a dropped edge
 * is indistinguishable from no edge" failure mode
 * `generated-edge-invariants.test.ts` was written against.
 */
const NO_ARROWS_PROSE = "No arrows found";

/**
 * The reference kinds a *generated* workspace can produce.
 *
 * A subset of the seven `where-used` can emit: the generator declares no
 * transforms and writes no `(ref …)` field metadata, so `transform_call` and
 * `ref_metadata` are excluded and asserted empty separately. Anything outside this
 * list is `where-used` reporting a relation the workspace never declared.
 */
const GENERATABLE_REF_KINDS = ["mapping", "metric", "nl_ref", "import", "fragment_spread"];

/**
 * `find --in` scopes that name one block type, i.e. every valid scope except
 * `all`.
 *
 * These are the parts the unscoped answer must partition into; `find.ts`'s
 * `validScopes` is the definition they mirror.
 */
const FIND_BLOCK_SCOPES = ["schema", "metric", "fragment"];

// ── Representation shims ──────────────────────────────────────────────────

/**
 * The canonical `[ns]::name` spelling of an entity key.
 *
 * The commands report entity names in the *index-key* form (`m0`,
 * `warehouse::stage_raw`) while the scenario's ground truth states the canonical
 * one (`::m0`), so one side has to be normalised to compare them. That split is
 * the representational inconsistency `lgc-wtz1` owns; normalising here keeps this
 * file testing the relation it is about rather than failing on a spelling.
 */
function canonicalEntityKey(name: string): string {
  return name.includes("::") ? name : `::${name}`;
}

/**
 * The schema that owns a canonical field endpoint.
 *
 * Read structurally — everything before the first `.` *after* the `::` separator
 * — because splitting on the first `.` is wrong for a namespaced key
 * (`ns_a::s1.field_0`). Same rule as `generated-edge-invariants.test.ts`'s
 * `owningSchema`.
 */
function owningSchema(endpoint: string): string {
  const separator = endpoint.indexOf("::");
  const dot = endpoint.indexOf(".", separator + 2);
  return dot === -1 ? endpoint : endpoint.slice(0, dot);
}

/** The last dotted segment of a canonical field endpoint — its leaf name. */
function leafSegment(endpoint: string): string {
  return endpoint.slice(endpoint.lastIndexOf(".") + 1);
}

// ── Edge identity ─────────────────────────────────────────────────────────

/**
 * One edge as a comparable string: `(from, to, mapping, classification)`.
 *
 * File and line are excluded because they are provenance, not identity — the same
 * choice `generated-edge-invariants.test.ts` makes. `kind` is excluded because
 * `arrows --json` does not report it.
 */
function edgeKey(edge: {
  from: string | null;
  to: string | null;
  mapping: string | null;
  classification: string;
}): string {
  const mapping = edge.mapping === null ? "(no mapping)" : canonicalEntityKey(edge.mapping);
  return `${edge.from} -> ${edge.to} | ${mapping} | ${edge.classification}`;
}

/** Sorted edge keys, so a mismatch reads as a set difference. */
function sortedEdgeKeys(keys: string[]): string[] {
  return [...keys].sort();
}

// ── The `arrows` command's output ─────────────────────────────────────────

/** The fields of `arrows --json` this file asserts on. */
interface EmittedArrow {
  /** Canonical mapping key, e.g. `::m0`. */
  mapping: string | null;
  /** Canonical source path, or several joined by `, ` for a multi-source arrow; null when computed. */
  source: string | null;
  /** Canonical target path. */
  target: string | null;
  /** `none`, `nl` or `nl-derived`. */
  classification: string;
}

/**
 * Every field edge one emitted arrow record represents.
 *
 * A multi-source arrow is *one* record naming several sources (spec §4.2, and the
 * command's own JSON contract), so it decomposes into one edge per source. A
 * computed arrow's null source is the single `from: null` edge the graph records.
 */
function emittedEdgeKeys(arrow: EmittedArrow): string[] {
  const sources =
    arrow.source === null
      ? [null]
      : arrow.source.split(MULTI_SOURCE_SEPARATOR).map((s) => s.trim());
  return sources.map((from) =>
    edgeKey({
      from,
      to: arrow.target,
      mapping: arrow.mapping,
      classification: arrow.classification,
    }),
  );
}

/**
 * Run `arrows <field> --json` and return the edge keys it reports.
 *
 * `arrows` exits {@link EXIT_NOT_FOUND} and prints prose — *not* `[]` — when a
 * declared field has no arrows, even under `--json`, while `find --json` emits
 * `[]` in the same situation. That inconsistency is filed as `gpt-4p1z`, whose
 * fix must update {@link NO_ARROWS_PROSE}; it is a stable contract today, so an
 * empty answer is
 * read off the exit code rather than by parsing — and confirmed against
 * {@link NO_ARROWS_PROSE}, because the same exit code also means "I could not
 * resolve that name".
 */
async function arrowEdgesFor(
  loaded: LoadedGeneratedWorkspace,
  field: string,
  flags: string[],
): Promise<{ result: CliCommandResult; edgeKeys: string[] }> {
  const result = await runCliCommand(registerArrows, [field, loaded.entryPath, "--json", ...flags]);
  if (result.code === EXIT_NOT_FOUND) {
    assert.ok(
      result.stdout.includes(NO_ARROWS_PROSE),
      `arrows ${field} ${flags.join(" ")} failed to resolve a path the workspace declares — ` +
        `it exited EXIT_NOT_FOUND without reporting an empty arrow set:\n` +
        `${result.stdout}${result.stderr}\n${loaded.sources}`,
    );
    return { result, edgeKeys: [] };
  }
  assert.equal(
    result.code,
    EXIT_OK,
    `arrows ${field} ${flags.join(" ")} failed:\n${result.stderr}\n${loaded.sources}`,
  );
  const arrows = JSON.parse(result.stdout) as EmittedArrow[];
  return { result, edgeKeys: arrows.flatMap(emittedEdgeKeys) };
}

// ── The declared answer, grouped the way `arrows` reports it ───────────────

/** A declared arrow, reconstructed from the edges the scenario states for it. */
interface DeclaredArrow {
  /** Grouping identity: everything the edges of one arrow necessarily share. */
  key: string;
  /** The edges the arrow declares — one per source, or one with `from: null`. */
  edges: ScenarioFieldEdge[];
}

/** Everything the edges of one declared arrow necessarily share. */
function declaredArrowKey(edge: ScenarioFieldEdge): string {
  return `${edge.to} | ${edge.mapping} | ${edge.kind} | ${edge.classification}`;
}

/**
 * Group a scenario's declared edges back into the arrows that declared them, or
 * `null` when the scenario contains a shape this grouping cannot resolve.
 *
 * `arrows` reports one record per *arrow*, so a multi-source arrow's other
 * sources come back with it whichever of them was queried. The expectation
 * therefore has to be arrow-shaped, and `scenarioFieldEdges` returns edges in
 * declaration order precisely so a caller can do this: one arrow's edges are a
 * contiguous run sharing {@link declaredArrowKey}.
 *
 * The one shape it could not distinguish is two arrows in one mapping with the
 * same target, kind and classification — their runs would not be adjacent, and
 * merging them would silently weaken every property built on this. That returns
 * `null` so the caller fails loudly instead. No current arbitrary produces it.
 *
 * `nl-derived` edges are excluded: each is an independent inference from one
 * `@ref` mention and `arrows` emits one record per mention, so they are never
 * grouped with anything.
 */
function declaredArrows(edges: ScenarioFieldEdge[]): DeclaredArrow[] | null {
  const groups: DeclaredArrow[] = [];
  const seen = new Set<string>();
  for (const edge of edges) {
    if (edge.classification === NL_DERIVED_CLASSIFICATION) continue;
    const key = declaredArrowKey(edge);
    const previous = groups.at(-1);
    if (previous?.key === key) {
      previous.edges.push(edge);
      continue;
    }
    if (seen.has(key)) return null;
    seen.add(key);
    groups.push({ key, edges: [edge] });
  }
  return groups;
}

/**
 * Every `nl-derived` edge the scenario declares — one per `@ref` mention.
 *
 * The generator's ground truth is authored in JSDoc, so its return type is `any`
 * to TypeScript; annotating at the boundary is what keeps every downstream
 * `.filter` and `.map` checked.
 */
function nlDerivedEdges(workspace: ScenarioWorkspace): ScenarioFieldEdge[] {
  const edges: ScenarioFieldEdge[] = scenarioFieldEdges(workspace);
  return edges.filter((edge) => edge.classification === NL_DERIVED_CLASSIFICATION);
}

/** Which end of an arrow a query is asking about. */
type Direction = "both" | "source" | "target";

/**
 * The edge keys `arrows <field>` must report, in the given direction.
 *
 * Declared arrows are selected whole — a multi-source arrow contributes all of
 * its edges — while `nl-derived` edges are selected individually and only on the
 * source side, per this module's header.
 */
function expectedEdgeKeys(
  edges: ScenarioFieldEdge[],
  arrows: DeclaredArrow[],
  field: string,
  direction: Direction,
): string[] {
  const touches = (arrow: DeclaredArrow) =>
    (direction !== "target" && arrow.edges.some((edge) => edge.from === field)) ||
    (direction !== "source" && arrow.edges.some((edge) => edge.to === field));

  const declared = arrows.filter(touches).flatMap((arrow) => arrow.edges);
  const derived =
    direction === "target"
      ? []
      : edges.filter(
          (edge) => edge.classification === NL_DERIVED_CLASSIFICATION && edge.from === field,
        );
  return sortedEdgeKeys([...declared, ...derived].map(edgeKey));
}

/**
 * The declared paths `arrows` cannot answer about exactly, because another path
 * in the same schema ends in the same segment.
 *
 * See this module's header: the command's leaf-name fallback conflates them. The
 * exclusion is per *path*, not per workspace, so a workspace containing one
 * ambiguous pair still has every other path asserted.
 */
function leafAmbiguousPaths(declaredPaths: string[]): Set<string> {
  const byLeaf = new Map<string, string[]>();
  for (const path of declaredPaths) {
    const leaf = `${owningSchema(path)}|${leafSegment(path)}`;
    byLeaf.set(leaf, [...(byLeaf.get(leaf) ?? []), path]);
  }
  return new Set([...byLeaf.values()].filter((paths) => paths.length > 1).flat());
}

// ── Generated samples, and the workspace lifecycle ────────────────────────

/**
 * One sample of `nlRefWorkspaceArbitrary`, which pairs a workspace with the two
 * canonical endpoints of the arrow its `@ref` mention implies. Spelled out here
 * because the generator's arbitraries are JSDoc-typed and reach TypeScript as
 * `any`, which would silently un-check every use of the sample.
 */
interface NlRefSample {
  workspace: ScenarioWorkspace;
  /** The mentioned field — the implied arrow's source. */
  derivedFrom: string;
  /** The mentioning arrow's target — the implied arrow's target. */
  derivedTo: string;
}

/** One sample of `metricWorkspaceArbitrary`: a workspace containing a metric block. */
interface MetricSample {
  workspace: ScenarioWorkspace;
}

/** Materialise a generated workspace, run `check`, and always clean up after. */
async function withGenerated(
  workspace: ScenarioWorkspace,
  check: (loaded: LoadedGeneratedWorkspace) => Promise<void>,
): Promise<void> {
  const loaded = await loadGeneratedWorkspace(workspace);
  try {
    await check(loaded);
  } finally {
    disposeGeneratedWorkspace(loaded);
  }
}

/** Every schema the workspace declares, in the authored `[ns::]name` spelling. */
function authoredSchemaRefs(workspace: ScenarioWorkspace): string[] {
  return workspace.files.flatMap((file) =>
    file.schemas.map((schema) =>
      schema.namespace ? `${schema.namespace}::${schema.name}` : schema.name,
    ),
  );
}

// ── arrows: an arrow is discoverable from both of its ends ─────────────────

describe("arrows: every declared arrow is reachable from both of its endpoints (gpt-clpj)", () => {
  it("reports exactly the declared arrows touching a field, in each of the three directions", async () => {
    // The inverse relation, stated in both set directions at once: nothing the
    // scenario declares for the field may be missing, and nothing else may appear.
    // Half of this — "every expected arrow is there" — would pass for a command
    // that returned every arrow in the workspace, which is exactly the failure
    // mode the leaf-name fallback produces (see the module header).
    await fc.assert(
      fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
        const edges: ScenarioFieldEdge[] = scenarioFieldEdges(workspace);
        const arrows = declaredArrows(edges);
        assert.ok(
          arrows,
          "the generator now declares two arrows in one mapping with the same " +
            "target, kind and classification; declaredArrows() cannot group that " +
            "and the expectation would be silently wrong",
        );
        const declaredPaths = scenarioDeclaredFieldPaths(workspace);
        const ambiguous = leafAmbiguousPaths(declaredPaths);
        const queryable = declaredPaths.filter((path) => !ambiguous.has(path));
        // Precondition, not decoration: an empty query list would make every
        // assertion below unreachable and the property vacuously true.
        assert.ok(queryable.length > 0, "no unambiguous declared field path to query");

        await withGenerated(workspace, async (loaded) => {
          let checkedNonEmpty = 0;
          for (const field of queryable) {
            for (const [direction, flags] of [
              ["both", []],
              ["source", ["--as-source"]],
              ["target", ["--as-target"]],
            ] as Array<[Direction, string[]]>) {
              const expected = expectedEdgeKeys(edges, arrows, field, direction);
              const { result, edgeKeys } = await arrowEdgesFor(loaded, field, flags);
              assert.deepEqual(
                sortedEdgeKeys(edgeKeys),
                expected,
                `arrows ${field} ${flags.join(" ")} is not the declared arrow set:\n${loaded.sources}`,
              );
              // The exit code is part of the contract shell pipelines rely on:
              // "no arrows" must be distinguishable from "some arrows" without
              // parsing stdout.
              assert.equal(
                result.code,
                expected.length === 0 ? EXIT_NOT_FOUND : EXIT_OK,
                `arrows ${field} ${flags.join(" ")} exit code disagrees with its own answer:\n${loaded.sources}`,
              );
              if (expected.length > 0) checkedNonEmpty += 1;
            }
          }
          // Every generated workspace declares at least one arrow, so a sample in
          // which no query returned anything means the queries missed the arrows
          // rather than that the workspace had none.
          assert.ok(
            checkedNonEmpty > 0,
            `no queried field reported any arrow, but the workspace declares ${edges.length}:\n${loaded.sources}`,
          );
        });
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("reports an @ref's implied arrow from the mentioned field and not from the arrow's target", async () => {
    // The `nl-derived` tier on its own axis, so the mutation check for this ticket
    // (dropping NL-derived discovery) fails here with a named counterexample rather
    // than inside the general property above. The asymmetry is the command's
    // documented contract: the mentioned field discovers the inferred arrow, the
    // target does not.
    await fc.assert(
      fc.asyncProperty(
        nlRefWorkspaceArbitrary,
        async ({ workspace, derivedFrom, derivedTo }: NlRefSample) => {
          const [implied] = nlDerivedEdges(workspace);
          // Precondition: this arbitrary exists to produce exactly one `@ref`
          // mention. Without it there would be no inferred arrow to look for and
          // both assertions below would hold trivially.
          assert.ok(implied, "nlRefWorkspaceArbitrary declared no @ref mention");
          const derivedKey = edgeKey({
            from: derivedFrom,
            to: derivedTo,
            mapping: implied.mapping,
            classification: NL_DERIVED_CLASSIFICATION,
          });
          await withGenerated(workspace, async (loaded) => {
            const fromSource = await arrowEdgesFor(loaded, derivedFrom, []);
            assert.ok(
              fromSource.edgeKeys.includes(derivedKey),
              `arrows ${derivedFrom} lost the arrow its @ref mention implies:\n${loaded.sources}`,
            );
            const fromTarget = await arrowEdgesFor(loaded, derivedTo, []);
            assert.ok(
              !fromTarget.edgeKeys.includes(derivedKey),
              `arrows ${derivedTo} reported an nl-derived arrow on the target side, ` +
                `which the command documents as field-lineage's job:\n${loaded.sources}`,
            );
          });
        },
      ),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

describe("arrows: known behaviour — a shared leaf name merges two paths' arrows", () => {
  // ⚠️ THIS CASE PINS WHAT `arrows` DOES TODAY, not what it should do, so it goes
  // red the moment the leaf-name fallback changes — at which point read this
  // module's header, re-decide it against `sl-xj4p`, and remove
  // `leafAmbiguousPaths` from the exact-set property above.
  //
  // The mechanism: `raw` declares `field_0` *and* `lines.field_0`, so after
  // resolving the qualified key `arrows` also looks the bare leaf name up
  // (`arrows.ts`'s `altKey` loop), and — for a query with no dotted path of its
  // own, as `field_0` here — that loop's guard accepts any path that exists
  // *somewhere* in the queried schema, which is the sl-xj4p criterion-2 fallback
  // rather than a bug.
  //
  // Pinned rather than skipped: a skipped test proves nothing, and node's JUnit
  // reporter puts a `failure=` attribute on a failing `todo` case, which fails
  // CI's test-report check.

  it("returns raw.lines.field_0's arrow when asked about raw.field_0", async () => {
    // The defensible half. `field_0` is a leaf name two paths of `raw` end in, so
    // `sl-xj4p`'s criterion 2 ("ambiguous leaf-name queries show all matches")
    // covers this answer — even though the query also names a declared top-level
    // path exactly. Pinned because it is what makes `leafAmbiguousPaths` necessary,
    // not because it is agreed to be wrong.
    await withGenerated(kitchenSinkWorkspace, async (loaded) => {
      const { edgeKeys } = await arrowEdgesFor(loaded, "::raw.field_0", []);
      assert.deepEqual(
        sortedEdgeKeys(edgeKeys),
        sortedEdgeKeys([
          "::raw.field_0 -> warehouse::staged.field_0 | warehouse::stage_raw | nl",
          "::raw.lines.field_0 -> warehouse::staged.lines.field_0 | warehouse::stage_raw | none",
        ]),
        `the leaf-name conflation changed shape — read this describe block's comments ` +
          `before updating the expectation:\n${loaded.sources}`,
      );
    });
  });
});

describe("arrows: a fully qualified nested-path query is exact (gpt-qhfo)", () => {
  it("reports no arrows for a nested field with no outgoing arrow, rather than a shallower field's", async () => {
    // Regression test for gpt-qhfo. `staged.lines.field_0` is a fully qualified
    // nested path — unlike the bare `field_0` query pinned above, this one names
    // no ambiguous leaf, so sl-xj4p's criterion 1 ("a deeply nested path resolves
    // correctly") applies without qualification. `staged` also declares a
    // top-level `field_0`, which DOES have an outgoing arrow
    // (`staged.field_0 -> revenue_metric.field_0`); before the fix, the `altKey`
    // loop's `pathExistsInSchema` guard and `arrowPathMatches`'s suffix check
    // (both in `arrows.ts`) let that shallower field's arrow satisfy the query
    // for the nested one. The nested field has no outgoing arrow of its own, so
    // the correct answer is empty, not a confident wrong one.
    await withGenerated(kitchenSinkWorkspace, async (loaded) => {
      const { edgeKeys } = await arrowEdgesFor(loaded, "warehouse::staged.lines.field_0", [
        "--as-source",
      ]);
      assert.deepEqual(edgeKeys, [], `expected no arrows, found:\n${loaded.sources}`);
    });
  });
});

// ── where-used: an entity is findable from every site that mentions it ────

/** One reference as `where-used --json` reports it. */
interface EmittedRef {
  /** `mapping`, `metric`, `fragment_spread`, `ref_metadata`, `import`, `transform_call` or `nl_ref`. */
  kind: string;
  /** The referring entity's index key, or — for `import` — the imported file's path. */
  name: string;
}

/**
 * The `name`s of the refs of one kind, canonicalised and sorted, duplicates kept.
 *
 * Use this wherever the scenario states *how many* references to expect — a set
 * comparison would pass for a command that reported every reference twice, and
 * "reported exactly once" is half of what an inverse-relation property is for.
 */
function refNameMultiset(refs: EmittedRef[], kind: string): string[] {
  return refs
    .filter((ref) => ref.kind === kind)
    .map((ref) => canonicalEntityKey(ref.name))
    .sort();
}

/**
 * The *distinct* `name`s of the refs of one kind, canonicalised and sorted.
 *
 * Only for the kinds whose multiplicity the scenario cannot state: a `metric` ref
 * is emitted once per metric whose `source` list contains the schema (a per-metric
 * boolean, not a count), and `nl_ref`s are deduplicated per (mapping, file, line)
 * while the scenario states one edge per `@ref` mention. Everywhere else use
 * {@link refNameMultiset}.
 */
function distinctRefNames(refs: EmittedRef[], kind: string): string[] {
  return [...new Set(refNameMultiset(refs, kind))].sort();
}

/** Run `where-used <name> --json` and parse the payload. */
async function whereUsed(
  loaded: LoadedGeneratedWorkspace,
  name: string,
): Promise<{ result: CliCommandResult; payload: { name: string; refs: EmittedRef[] } }> {
  const result = await runCliCommand(registerWhereUsed, [name, loaded.entryPath, "--json"]);
  assert.equal(
    result.code,
    EXIT_OK,
    `where-used ${name} found nothing, but every generated entity is referenced:\n` +
      `${result.stdout}${result.stderr}\n${loaded.sources}`,
  );
  return { result, payload: JSON.parse(result.stdout) };
}

describe("where-used: every declared reference to a schema is reported (gpt-clpj)", () => {
  it("reports exactly the mappings and metrics the workspace attaches to each schema", async () => {
    // The inverse of `scenarioSchemaEdges`. Both directions: a mapping the schema
    // is wired into may not be missing, and a mapping it is *not* wired into may
    // not appear — the second half is what catches a lookup that fans out across a
    // shared bare name, which is how `sl-l3m8` escaped.
    await fc.assert(
      fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
        // Widened `role` on purpose: `scenarioSchemaEdges` is JSDoc-typed and its
        // inferred return says `role: string`, which will not assign to the
        // published `ScenarioSchemaEdge` union. Naming the shape read here keeps
        // the comparisons below checked without asserting a type the generator
        // does not actually promise TypeScript.
        const schemaEdges: Array<Pick<ScenarioSchemaEdge, "from" | "to"> & { role: string }> =
          scenarioSchemaEdges(workspace);
        const nlEdges = nlDerivedEdges(workspace);
        const workspacePaths = new Set(workspace.files.map((file) => `./${file.path}`));
        const schemaRefs = authoredSchemaRefs(workspace);
        assert.ok(schemaRefs.length > 0, "workspace declares no schema to query");

        await withGenerated(workspace, async (loaded) => {
          for (const authored of schemaRefs) {
            const schema = canonicalEntityKey(authored);
            const { payload } = await whereUsed(loaded, authored);
            assert.equal(
              canonicalEntityKey(payload.name),
              schema,
              `where-used echoed a different entity than it resolved:\n${loaded.sources}`,
            );

            // One ref per *occurrence* of the schema in a mapping's source or
            // target list, which is exactly one `scenarioSchemaEdges` edge each —
            // so the comparable quantity is a multiset and the count is the
            // scenario's own answer, not a restatement of production.
            const expectedMappings = schemaEdges
              .filter(
                (edge) =>
                  (edge.role === "source" && edge.from === schema) ||
                  (edge.role === "target" && edge.to === schema),
              )
              .map((edge) => (edge.role === "source" ? edge.to : edge.from))
              .sort();
            assert.deepEqual(
              refNameMultiset(payload.refs, "mapping"),
              expectedMappings,
              `where-used ${authored} does not report exactly the mappings using it, ` +
                `exactly once each:\n${loaded.sources}`,
            );

            const expectedMetrics = [
              ...new Set(
                schemaEdges
                  .filter((edge) => edge.role === "metric_source" && edge.from === schema)
                  .map((edge) => edge.to),
              ),
            ].sort();
            assert.deepEqual(
              distinctRefNames(payload.refs, "metric"),
              expectedMetrics,
              `where-used ${authored} does not report exactly the metrics sourcing it:\n${loaded.sources}`,
            );

            // The `nl_ref` refs are deduplicated per (mapping, file, line), so the
            // comparable quantity is which mappings mention the schema, not how
            // many times. That is still the whole inverse relation for this tier:
            // a mapping whose `@ref` names the schema must appear, and one whose
            // `@ref`s do not must not.
            const expectedNlMappings = [
              ...new Set(
                nlEdges
                  .filter((edge) => edge.from !== null && owningSchema(edge.from) === schema)
                  .map((edge) => edge.mapping),
              ),
            ].sort();
            assert.deepEqual(
              distinctRefNames(payload.refs, "nl_ref"),
              expectedNlMappings,
              `where-used ${authored} does not report exactly the @ref sites naming it:\n${loaded.sources}`,
            );

            // Nothing invented: the generator writes no `(ref …)` field metadata and
            // declares no transforms, so those two ref kinds must be empty, and no
            // kind outside the vocabulary may appear at all.
            assert.deepEqual(
              refNameMultiset(payload.refs, "ref_metadata"),
              [],
              `where-used ${authored} invented (ref) metadata:\n${loaded.sources}`,
            );
            assert.deepEqual(
              refNameMultiset(payload.refs, "transform_call"),
              [],
              `where-used ${authored} invented a transform call:\n${loaded.sources}`,
            );
            const kinds = [...new Set(payload.refs.map((ref) => ref.kind))].sort();
            assert.deepEqual(
              kinds.filter((kind) => !GENERATABLE_REF_KINDS.includes(kind)),
              [],
              `where-used ${authored} reported a reference kind a generated workspace ` +
                `cannot declare:\n${loaded.sources}`,
            );

            // Import refs are only checked for naming a real file — see the module
            // header for why their count is not stated here.
            for (const ref of payload.refs.filter((r) => r.kind === "import")) {
              assert.ok(
                workspacePaths.has(ref.name),
                `where-used ${authored} reported an import of '${ref.name}', which is ` +
                  `not a file this workspace declares:\n${loaded.sources}`,
              );
            }
          }
        });
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("reports the mapping whose @ref names a schema, and reports it only there", async () => {
    // The `nl_ref` tier on its own axis, for the same reason as the sibling
    // `arrows` property: the ticket's mutation check must fail with a message that
    // names the @ref-touched field, not with a set difference over a workspace that
    // happened to contain one.
    await fc.assert(
      fc.asyncProperty(nlRefWorkspaceArbitrary, async ({ workspace, derivedFrom }: NlRefSample) => {
        const mentionedSchema = owningSchema(derivedFrom);
        const mentioningMappings = [...new Set(nlDerivedEdges(workspace).map((e) => e.mapping))];
        // Precondition: no mention means nothing for `where-used` to find, and the
        // comparison below would be empty-to-empty for every schema.
        assert.ok(
          mentioningMappings.length > 0,
          "nlRefWorkspaceArbitrary declared no @ref mention",
        );
        await withGenerated(workspace, async (loaded) => {
          for (const authored of authoredSchemaRefs(workspace)) {
            const { payload } = await whereUsed(loaded, authored);
            const expected =
              canonicalEntityKey(authored) === mentionedSchema ? mentioningMappings : [];
            assert.deepEqual(
              distinctRefNames(payload.refs, "nl_ref"),
              [...expected].sort(),
              `where-used ${authored} misreports the @ref site for ${derivedFrom}:\n${loaded.sources}`,
            );
          }
        });
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

// ── find: exactly the metadata the workspace wrote ────────────────────────

/** One match as `find --json` reports it. */
interface EmittedMatch {
  /** `schema`, `metric` or `fragment`. */
  blockType: string;
  /** The block's index key, or `block.field` for a match inside a nested record. */
  block: string;
  /** The matched field's name, or {@link BLOCK_LEVEL_MATCH_FIELD} for block metadata. */
  field: string;
  /** The matched tag's authored text. */
  tag: string;
}

/** Run `find --tag <tag> [--in <scope>] --json` and parse the payload. */
async function findByTag(
  loaded: LoadedGeneratedWorkspace,
  tag: string,
  scope?: string,
): Promise<{ result: CliCommandResult; matches: EmittedMatch[] }> {
  const result = await runCliCommand(registerFind, [
    loaded.entryPath,
    "--tag",
    tag,
    ...(scope ? ["--in", scope] : []),
    "--json",
  ]);
  return { result, matches: JSON.parse(result.stdout) as EmittedMatch[] };
}

/** A match as a comparable string. */
function matchKey(match: EmittedMatch): string {
  return `${match.blockType} ${canonicalEntityKey(match.block)}.${match.field} [${match.tag}]`;
}

/** Every metric schema the workspace declares, canonicalised, with its source count. */
function declaredMetrics(
  workspace: ScenarioWorkspace,
): Array<{ key: string; sourceCount: number }> {
  return workspace.files
    .flatMap((file) => file.schemas)
    .filter((schema) => schema.metric === true)
    .map((schema) => ({
      key: canonicalEntityKey(
        schema.namespace ? `${schema.namespace}::${schema.name}` : schema.name,
      ),
      sourceCount: (schema.metricSources ?? []).length,
    }));
}

describe("find: exactly the metadata tokens the workspace declares (gpt-clpj)", () => {
  it("finds every metric block by its own tags, and only metric blocks", async () => {
    // The only metadata a generated workspace carries is a metric block's, so this
    // is the whole positive direction of `find`. Both halves matter: a metric that
    // is not found is a search that missed a block, and a non-metric schema that is
    // found is a search matching something other than the tag it was given.
    await fc.assert(
      fc.asyncProperty(metricWorkspaceArbitrary, async ({ workspace }: MetricSample) => {
        const metrics = declaredMetrics(workspace);
        // Precondition: this arbitrary always declares one metric. If it stops, the
        // assertions below would all compare empty to empty.
        assert.ok(metrics.length > 0, "metricWorkspaceArbitrary declared no metric block");

        await withGenerated(workspace, async (loaded) => {
          for (const tag of METRIC_BLOCK_TAGS) {
            const { result, matches } = await findByTag(loaded, tag);
            assert.equal(
              result.code,
              EXIT_OK,
              `find --tag ${tag} found nothing:\n${loaded.sources}`,
            );
            assert.deepEqual(
              matches.map(matchKey).sort(),
              metrics
                .map((metric) => `metric ${metric.key}.${BLOCK_LEVEL_MATCH_FIELD} [${tag}]`)
                .sort(),
              `find --tag ${tag} is not exactly the declared metric blocks:\n${loaded.sources}`,
            );
          }

          // `source` is declared once per metricSources entry but reported once per
          // block, because a block-level match is one match however many tokens
          // matched it.
          const withSources = metrics.filter((metric) => metric.sourceCount > 0);
          const { matches } = await findByTag(loaded, METRIC_SOURCE_TAG);
          assert.deepEqual(
            matches.map(matchKey).sort(),
            withSources
              .map(
                (metric) =>
                  `metric ${metric.key}.${BLOCK_LEVEL_MATCH_FIELD} [${METRIC_SOURCE_TAG}]`,
              )
              .sort(),
            `find --tag ${METRIC_SOURCE_TAG} is not exactly the metrics naming a source:\n${loaded.sources}`,
          );
        });
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("partitions its matches across --in scopes without gaining or losing any", async () => {
    // A scope filter may narrow the answer; it may never change it. Stated on the
    // metric axis because a metric block is the one thing a generated workspace has
    // to find — on a workspace with no metadata at all, both sides would be empty
    // and the property would hold for the wrong reason.
    await fc.assert(
      fc.asyncProperty(metricWorkspaceArbitrary, async ({ workspace }: MetricSample) => {
        await withGenerated(workspace, async (loaded) => {
          for (const tag of METRIC_BLOCK_TAGS) {
            const all = (await findByTag(loaded, tag, "all")).matches.map(matchKey).sort();
            assert.ok(
              all.length > 0,
              `find --tag ${tag} --in all found nothing:\n${loaded.sources}`,
            );
            const scoped: string[] = [];
            for (const scope of FIND_BLOCK_SCOPES) {
              const { matches } = await findByTag(loaded, tag, scope);
              for (const match of matches) {
                assert.equal(
                  match.blockType,
                  scope,
                  `find --in ${scope} returned a ${match.blockType} match:\n${loaded.sources}`,
                );
              }
              scoped.push(...matches.map(matchKey));
            }
            assert.deepEqual(
              scoped.sort(),
              all,
              `the --in scopes do not partition find's unscoped answer:\n${loaded.sources}`,
            );
          }
        });
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("finds nothing for a tag no generated workspace declares", async () => {
    // The "nothing the workspace does not declare" direction, and the only place
    // `find` is asked about a tag it must not match. A generated field declaration
    // carries no metadata at all, so a match here is `find` matching a field name,
    // a type, or a prefix of a tag it does know — the `sl-xav4` class.
    await fc.assert(
      fc.asyncProperty(workspaceScenarioArbitrary, async (workspace: ScenarioWorkspace) => {
        await withGenerated(workspace, async (loaded) => {
          for (const tag of UNDECLARED_TAGS) {
            const { result, matches } = await findByTag(loaded, tag);
            assert.deepEqual(
              matches.map(matchKey),
              [],
              `find --tag ${tag} matched something the workspace never declared:\n${loaded.sources}`,
            );
            assert.equal(
              result.code,
              EXIT_NOT_FOUND,
              `find --tag ${tag} exited ${result.code} with no matches:\n${loaded.sources}`,
            );
          }
        });
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});
