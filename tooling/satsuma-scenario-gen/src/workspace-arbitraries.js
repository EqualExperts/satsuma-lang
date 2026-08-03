/**
 * workspace-arbitraries.js — one generated domain per lineage axis.
 *
 * Each axis is its own arbitrary so that a property can pick the smallest domain
 * that exercises it rather than paying for every axis at once. A property about
 * depth exactness wants chains; a property about container-relative resolution
 * wants `each` blocks and nothing else; only the acceptance case wants all seven
 * at once.
 *
 * | Arbitrary | Axis | Defect class it reaches |
 * |---|---|---|
 * | {@link chainWorkspaceArbitrary} | mappings in series | depth limits (`sl-y89y`) |
 * | {@link diamondWorkspaceArbitrary} | two paths to one field | single-predecessor walks (`sg-pufq`) |
 * | {@link cyclicWorkspaceArbitrary} | a closed loop | non-termination, duplicate entries |
 * | {@link multiFileWorkspaceArbitrary} | files plus `import` | the LSP's cross-file model merge |
 * | {@link namespacedWorkspaceArbitrary} | namespaces | `qualifyField`'s namespace branch |
 * | {@link containerWorkspaceArbitrary} | `each` / `flatten` | dropped edges (`3cdd-yavi`, `sl-l7u0`) |
 * | {@link nlRefWorkspaceArbitrary} | NL `@ref` text | phantom source edges (`cbh-y5og`) |
 * | {@link computedArrowWorkspaceArbitrary} | sourceless arrows | `from: null` handling |
 * | {@link metricWorkspaceArbitrary} | metric `source` tokens | the `metric_source` edge role |
 * | {@link spreadWorkspaceArbitrary} | fragment spreads | endpoints only a spread declares |
 *
 * ## Two shapes deliberately absent
 *
 * **A container header whose target is the schema root** (`flatten orders ->
 * target_schema`). That is `r0-7w76`: core holds two readings of the same token,
 * and `qualifyField` invents `::target_schema.target_schema` for it. Generating it
 * in the default domain would make every endpoint-existence property red for a
 * defect this feature explicitly does not decide.
 *
 * It is also not *expressible* here: an endpoint is `{ schema, path }`, and a
 * schema root has no path. Rather than give every endpoint an empty-path special
 * case for one known-failing demonstration, the shape lives as a literal fixture
 * in `satsuma-cli/test/generated-edge-invariants.test.ts`, in the property marked
 * `todo` against that ticket.
 *
 * **NL `@ref`s that coincide with a declared source, or with the arrow's own
 * target.** Both hit production suppression branches that the ground truth would
 * have to restate to predict — see `ground-truth.js`'s header.
 *
 * Owns: generated workspace domains and the structural transformations properties
 * apply to them. Does not own: expectations (ground-truth.js) or rendering.
 */

import fc from "fast-check";
import { leafNames, listRecordField, scalarField } from "./model.js";
import {
  computedArrow,
  eachBlock,
  endpoint,
  flattenBlock,
  mapArrow,
  mappingDecl,
  nlTransform,
  scenarioFile,
  scenarioWorkspace,
  schemaDecl,
} from "./workspace-model.js";

// ── Bounds ─────────────────────────────────────────────────────────────────

/**
 * Longest generated chain of mappings. Four is enough to have an interior node
 * whose shortest path differs from a first-arrival path, which is what a depth
 * property needs; longer chains only slow shrinking down.
 */
const MAX_CHAIN_LENGTH = 4;

/** Leaves per generated schema. Two is enough for a multi-source arrow. */
const LEAVES_PER_SCHEMA = 2;

/** The entry file every generated workspace is pointed at. */
const ENTRY_FILE = "entry.stm";

// ── Naming ─────────────────────────────────────────────────────────────────
// Names are unique across the whole workspace regardless of namespace. A
// namespaced schema and a file-scope schema of the same name are different
// entities, but they also trip duplicate-definition and shadowing diagnostics,
// and a generated workspace must validate clean.

const schemaName = (index) => `s${index}`;
const mappingName = (index) => `m${index}`;
const leaves = () => leafNames(LEAVES_PER_SCHEMA);

/** Flat scalar fields, the same set in every schema so arrows line up. */
const flatFields = () => leaves().map(scalarField);

// ── Chains, diamonds and cycles ────────────────────────────────────────────

/**
 * A schema and one mapping per hop, wired in series: `s0 → s1 → … → sN`.
 *
 * Every hop maps every leaf, so the field-level graph is `length` parallel
 * chains — which is what makes the shortest-path distance of each field
 * unambiguous, and therefore what a depth-exactness property can assert on.
 */
function chainWorkspace(length, namespaces = []) {
  const schemas = [];
  const mappings = [];
  const nsOf = (index) => namespaces[index] ?? null;
  const ref = (index) => (nsOf(index) ? `${nsOf(index)}::${schemaName(index)}` : schemaName(index));

  for (let index = 0; index <= length; index += 1) {
    schemas.push(
      schemaDecl({ name: schemaName(index), namespace: nsOf(index), fields: flatFields() }),
    );
  }
  for (let hop = 0; hop < length; hop += 1) {
    mappings.push(
      mappingDecl({
        name: mappingName(hop),
        namespace: mappingNamespace(nsOf(hop), nsOf(hop + 1)),
        sources: [ref(hop)],
        targets: [ref(hop + 1)],
        arrows: leaves().map((leaf) =>
          mapArrow([endpoint(ref(hop), leaf)], endpoint(ref(hop + 1), leaf)),
        ),
      }),
    );
  }
  return { schemas, mappings, ref };
}

/**
 * Which namespace a hop's mapping is declared in, given its two schemas'.
 *
 * A mapping sits in its source schema's namespace — *unless* either schema is at
 * file scope, in which case it is declared at file scope too.
 *
 * That exception is a deliberate hole in the generated domain, and it is working
 * around **`lgc-3f13`**: a namespaced mapping whose target is a global schema has
 * that target pre-qualified during extraction (`extract.ts:490-497`), so the whole
 * toolchain then reports `ns::name` for a schema nothing declares — an invented
 * endpoint in `graph`, in `lineage`, and a spurious `undefined-ref` from
 * `validate`. Generating the shape would leave every property in this feature red
 * for a defect it did not cause and does not own.
 *
 * Cross-*namespace* hops are unaffected and are still generated: those targets are
 * written `ns::name` by the author, so there is nothing to pre-qualify. Remove this
 * function when `lgc-3f13` is fixed.
 */
function mappingNamespace(sourceNamespace, targetNamespace) {
  return sourceNamespace !== null && targetNamespace !== null ? sourceNamespace : null;
}

/** Wrap declarations into a single-file workspace whose entry file holds them all. */
function singleFile({ schemas, mappings, fragments = [] }) {
  return scenarioWorkspace([scenarioFile({ path: ENTRY_FILE, fragments, schemas, mappings })]);
}

/**
 * `s0 → s1 → … → sN`, plus the head and tail field a traversal property starts
 * from and expects to reach.
 */
export const chainWorkspaceArbitrary = fc
  .integer({ min: 1, max: MAX_CHAIN_LENGTH })
  .map((length) => {
    const { schemas, mappings, ref } = chainWorkspace(length);
    const [leaf] = leaves();
    return {
      workspace: singleFile({ schemas, mappings }),
      length,
      head: `::${schemaName(0)}.${leaf}`,
      tail: `::${schemaName(length)}.${leaf}`,
      ref,
    };
  });

/**
 * A diamond: `s0` feeds `s1` and `s2`, both of which feed `s3`.
 *
 * The point is that `s3`'s field has two distinct upstream paths of equal length.
 * A walk that follows only one predecessor still produces a plausible-looking
 * answer, which is why `sg-pufq` survived hand-written tests: it returned *a*
 * chain rather than *every* branch.
 */
export const diamondWorkspaceArbitrary = fc.constant(null).map(() => {
  const names = [0, 1, 2, 3].map(schemaName);
  const schemas = names.map((name) => schemaDecl({ name, fields: flatFields() }));
  const [leaf] = leaves();
  const hop = (index, from, to) =>
    mappingDecl({
      name: mappingName(index),
      sources: [from],
      targets: [to],
      arrows: [mapArrow([endpoint(from, leaf)], endpoint(to, leaf))],
    });
  const mappings = [
    hop(0, names[0], names[1]),
    hop(1, names[0], names[2]),
    hop(2, names[1], names[3]),
    hop(3, names[2], names[3]),
  ];
  return {
    workspace: singleFile({ schemas, mappings }),
    sink: `::${names[3]}.${leaf}`,
    branches: [`::${names[1]}.${leaf}`, `::${names[2]}.${leaf}`],
    source: `::${names[0]}.${leaf}`,
  };
});

/**
 * A chain closed into a cycle by a final mapping from the tail back to the head.
 *
 * Every field in the loop is reachable from every other, so a traversal must
 * terminate and must report each field once — the two things a cycle can break.
 */
export const cyclicWorkspaceArbitrary = fc
  .integer({ min: 1, max: MAX_CHAIN_LENGTH })
  .map((length) => {
    const { schemas, mappings, ref } = chainWorkspace(length);
    const closing = mappingDecl({
      name: mappingName(length),
      sources: [ref(length)],
      targets: [ref(0)],
      arrows: leaves().map((leaf) =>
        mapArrow([endpoint(ref(length), leaf)], endpoint(ref(0), leaf)),
      ),
    });
    const [leaf] = leaves();
    return {
      workspace: singleFile({ schemas, mappings: [...mappings, closing] }),
      loopLength: length + 1,
      start: `::${schemaName(0)}.${leaf}`,
    };
  });

// ── Files and imports ──────────────────────────────────────────────────────

/**
 * A chain split across files, one hop per file after the entry.
 *
 * The entry file declares the first schema and mapping; each later file declares
 * the next schema and the mapping that fills it, importing what it needs. Nothing
 * here authors an `import` — the renderer derives every one from usage, so a
 * generated workspace cannot claim an import graph its declarations contradict.
 *
 * Every file is import-reachable from the entry *because* of how the chain is
 * cut: each file's mapping targets the next file's schema, so it imports that
 * file, and following imports from the entry visits all of them. A workspace with
 * a file nothing imports would be a generator bug — the command would never see
 * it, and half the expected edges would look like toolchain omissions.
 *
 * The minimum length is 2: a one-hop chain has nothing to put in a second file.
 */
export const multiFileWorkspaceArbitrary = fc
  .integer({ min: 2, max: MAX_CHAIN_LENGTH })
  .map((length) => {
    const { schemas, mappings } = chainWorkspace(length);
    const files = [
      scenarioFile({ path: ENTRY_FILE, schemas: [schemas[0]], mappings: [mappings[0]] }),
      ...mappings.slice(1).map((mapping, offset) =>
        scenarioFile({
          path: `part${offset + 1}.stm`,
          schemas: [schemas[offset + 1]],
          mappings: [mapping],
        }),
      ),
    ];
    // The last schema is declared by no mapping's file, so it needs a home: give
    // it to the final file, which is the one whose mapping targets it.
    files[files.length - 1].schemas.push(schemas[length]);
    const [leaf] = leaves();
    return {
      workspace: scenarioWorkspace(files),
      fileCount: files.length,
      head: `::${schemaName(0)}.${leaf}`,
      tail: `::${schemaName(length)}.${leaf}`,
    };
  });

// ── Namespaces ─────────────────────────────────────────────────────────────

/**
 * A chain whose schemas are spread across file scope and two namespaces.
 *
 * `qualifyField` has a namespace-matching branch that strips a namespace from a
 * declared schema to compare its bare name against an authored prefix
 * (`canonical-ref.ts:68-72`). Nothing generated reached it before, and every
 * cross-namespace hop here does.
 *
 * **At least one schema is always namespaced.** An all-file-scope draw would not
 * exercise the axis at all, and worse, it would make any property that loops over
 * `namespaces` — every `--namespace` filter property — pass *vacuously* for that
 * sample by iterating an empty list. The first schema is forced into a namespace
 * rather than filtering the draw, so shrinking stays well behaved.
 */
export const namespacedWorkspaceArbitrary = fc
  .integer({ min: 1, max: MAX_CHAIN_LENGTH })
  .chain((length) =>
    fc
      .array(fc.constantFrom(null, "ns_a", "ns_b"), {
        minLength: length + 1,
        maxLength: length + 1,
      })
      .map((drawn) => {
        const namespaces = drawn.some((namespace) => namespace !== null)
          ? drawn
          : ["ns_a", ...drawn.slice(1)];
        const { schemas, mappings } = chainWorkspace(length, namespaces);
        return { workspace: singleFile({ schemas, mappings }), namespaces };
      }),
  );

// ── Container blocks ───────────────────────────────────────────────────────

/**
 * A mapping whose arrows live inside nested `each` or `flatten` blocks.
 *
 * `depth` is how many blocks are nested. Every child arrow's model path is
 * absolute and the renderer emits it relative to its block, so the generated
 * Satsuma exercises exactly the container-relative qualification that once made
 * every nested-iteration mapping draw no lines at all (`3cdd-yavi`): the arrows
 * were in the model, no port resolved, and no test failed.
 *
 * The block target is always a declared record *field*, never the schema root —
 * see this module's header.
 */
export const containerWorkspaceArbitrary = fc
  .record({
    kind: fc.constantFrom("each", "flatten"),
    depth: fc.integer({ min: 1, max: 2 }),
  })
  .map(({ kind, depth }) => {
    // A record chain exactly `depth` levels deep — `group_0 { field_0 }` at depth
    // 1, `group_0 { group_1 { field_0 } }` at depth 2 — list-typed at every level
    // so each iteration really is over something iterable. The leaves must sit at
    // the innermost level, because that is the only level the innermost block's
    // relative arrows can name.
    const nested = (level) =>
      level === depth - 1
        ? flatFields()
        : [listRecordField(`group_${level + 1}`, nested(level + 1))];
    const fields = [listRecordField("group_0", nested(0))];
    const blockPath = (level) =>
      Array.from({ length: level + 1 }, (_, index) => `group_${index}`).join(".");

    const source = schemaName(0);
    const target = schemaName(1);
    const schemas = [schemaDecl({ name: source, fields }), schemaDecl({ name: target, fields })];

    // Innermost first, then wrap outwards, so each level's children are the
    // block one level deeper.
    let body = leaves().map((leaf) =>
      mapArrow(
        [endpoint(source, `${blockPath(depth - 1)}.${leaf}`)],
        endpoint(target, `${blockPath(depth - 1)}.${leaf}`),
      ),
    );
    for (let level = depth - 1; level >= 0; level -= 1) {
      const block = kind === "each" ? eachBlock : flattenBlock;
      body = [block(endpoint(source, blockPath(level)), endpoint(target, blockPath(level)), body)];
    }

    return {
      workspace: singleFile({
        schemas,
        mappings: [
          mappingDecl({
            name: mappingName(0),
            sources: [source],
            targets: [target],
            arrows: body,
          }),
        ],
      }),
      kind,
      depth,
    };
  });

// ── NL `@ref` transform text ───────────────────────────────────────────────

/**
 * A mapping whose arrow bodies mention *other* source fields by `@ref`.
 *
 * Each mention is an implicit source for the arrow's target — the `nl-derived`
 * tier. The mention is always a different leaf of a declared source schema, so it
 * is neither the arrow's own declared source nor its target: those two shapes hit
 * production suppression branches the ground truth would have to restate.
 */
export const nlRefWorkspaceArbitrary = fc.constant(null).map(() => {
  const source = schemaName(0);
  const target = schemaName(1);
  const [first, second] = leaves();
  return {
    workspace: singleFile({
      schemas: [
        schemaDecl({ name: source, fields: flatFields() }),
        schemaDecl({ name: target, fields: flatFields() }),
      ],
      mappings: [
        mappingDecl({
          name: mappingName(0),
          sources: [source],
          targets: [target],
          arrows: [
            mapArrow(
              [endpoint(source, first)],
              endpoint(target, first),
              nlTransform("Normalise the value.", [endpoint(source, second)]),
            ),
            mapArrow([endpoint(source, second)], endpoint(target, second)),
          ],
        }),
      ],
    }),
    derivedFrom: `::${source}.${second}`,
    derivedTo: `::${target}.${first}`,
  };
});

// ── Sourceless arrows ──────────────────────────────────────────────────────

/**
 * A mapping with one computed arrow (`-> target { "…" }`) alongside a declared
 * one, so the same generated workspace has both a `from: null` edge and a normal
 * one. A consumer that treats a null source as "no edge" loses the target field
 * from the graph entirely.
 */
export const computedArrowWorkspaceArbitrary = fc.constant(null).map(() => {
  const source = schemaName(0);
  const target = schemaName(1);
  const [first, second] = leaves();
  return {
    workspace: singleFile({
      schemas: [
        schemaDecl({ name: source, fields: flatFields() }),
        schemaDecl({ name: target, fields: flatFields() }),
      ],
      mappings: [
        mappingDecl({
          name: mappingName(0),
          sources: [source],
          targets: [target],
          arrows: [
            mapArrow([endpoint(source, first)], endpoint(target, first)),
            computedArrow(endpoint(target, second), nlTransform("Stamped at load time.")),
          ],
        }),
      ],
    }),
    computedTarget: `::${target}.${second}`,
  };
});

// ── Metrics ────────────────────────────────────────────────────────────────

/**
 * A metric schema fed by a mapping *and* naming a `source` token.
 *
 * The two mechanisms are independent: the mapping produces `source`/`target`
 * schema edges the way any mapping does, while the metadata token produces a
 * `metric_source` edge. A consumer that derived metric provenance from mappings
 * alone would miss the second, and one that derived it from the token alone would
 * miss the first.
 */
export const metricWorkspaceArbitrary = fc.constant(null).map(() => {
  const fact = schemaName(0);
  const metric = schemaName(1);
  const [leaf] = leaves();
  return {
    workspace: singleFile({
      schemas: [
        schemaDecl({ name: fact, fields: flatFields() }),
        schemaDecl({ name: metric, fields: flatFields(), metric: true, metricSources: [fact] }),
      ],
      mappings: [
        mappingDecl({
          name: mappingName(0),
          sources: [fact],
          targets: [metric],
          arrows: [mapArrow([endpoint(fact, leaf)], endpoint(metric, leaf))],
        }),
      ],
    }),
    metric: `::${metric}`,
    metricSource: `::${fact}`,
  };
});

// ── Fragment spreads ───────────────────────────────────────────────────────

/**
 * A target schema whose mapped fields come from a spread fragment.
 *
 * An arrow may name a field the schema never declares in its own body, so any
 * endpoint-existence check that reads only the body would report a false
 * positive. This is the smallest workspace that distinguishes the two.
 */
export const spreadWorkspaceArbitrary = fc.constant(null).map(() => {
  const source = schemaName(0);
  const target = schemaName(1);
  const [first, second] = leaves();
  return {
    workspace: singleFile({
      fragments: [{ name: "shared_fields", fields: [scalarField(second)] }],
      schemas: [
        schemaDecl({ name: source, fields: flatFields() }),
        schemaDecl({ name: target, fields: [scalarField(first)], spreads: ["shared_fields"] }),
      ],
      mappings: [
        mappingDecl({
          name: mappingName(0),
          sources: [source],
          targets: [target],
          arrows: [
            mapArrow([endpoint(source, first)], endpoint(target, first)),
            mapArrow([endpoint(source, second)], endpoint(target, second)),
          ],
        }),
      ],
    }),
    spreadEndpoint: `::${target}.${second}`,
  };
});

// ── Multi-source arrows ────────────────────────────────────────────────────

/**
 * One mapping with two source schemas and an arrow drawing from both.
 *
 * A multi-source side forces every arrow path to be written `schema.path`, which
 * is the `qualifyField` branch that matches an authored prefix against the
 * declared schema list — and one arrow with two sources must appear as two edges
 * to the same target (spec §4.2).
 */
export const multiSourceWorkspaceArbitrary = fc.constant(null).map(() => {
  const [left, right, target] = [0, 1, 2].map(schemaName);
  const [leaf] = leaves();
  return {
    workspace: singleFile({
      schemas: [left, right, target].map((name) => schemaDecl({ name, fields: flatFields() })),
      mappings: [
        mappingDecl({
          name: mappingName(0),
          sources: [left, right],
          targets: [target],
          arrows: [
            mapArrow(
              [endpoint(left, leaf), endpoint(right, leaf)],
              endpoint(target, leaf),
              nlTransform("Concatenate both sources."),
            ),
          ],
        }),
      ],
    }),
    expectedSources: [`::${left}.${leaf}`, `::${right}.${leaf}`],
    target: `::${target}.${leaf}`,
  };
});

// ── The acceptance case, and the default domain ────────────────────────────

/**
 * Every axis in one workspace: four files, a namespace, an `each` container, an
 * NL `@ref`, a computed arrow, a fragment spread and a metric.
 *
 * This is PRD acceptance test 5 as a value rather than a description. It is a
 * single constant, not a family: its job is to prove the renderer can put all
 * seven constructs in a workspace that parses and validates, and a fixed shape
 * makes a failure immediately readable.
 *
 * The file split is chosen so the import graph is **rooted at the entry and
 * acyclic**: the entry declares only mappings, so it references — and therefore
 * imports — every schema; schemas import the fragment library; the metric imports
 * the schema it sources from. Putting the fragment in the entry instead would make
 * the entry and the schema file import each other.
 */
export const kitchenSinkWorkspace = (() => {
  const [first, second] = leaves();
  const raw = "raw";
  const staged = "warehouse::staged";
  const metric = "revenue_metric";

  const library = scenarioFile({
    path: "lib.stm",
    fragments: [{ name: "audit_fields", fields: [scalarField("loaded_at")] }],
  });

  const schemas = scenarioFile({
    path: "schemas.stm",
    schemas: [
      schemaDecl({
        name: raw,
        fields: [...flatFields(), listRecordField("lines", flatFields())],
      }),
      schemaDecl({
        name: "staged",
        namespace: "warehouse",
        fields: [...flatFields(), listRecordField("lines", flatFields())],
        spreads: ["audit_fields"],
      }),
    ],
  });

  const metrics = scenarioFile({
    path: "metrics.stm",
    schemas: [
      schemaDecl({
        name: metric,
        fields: flatFields(),
        metric: true,
        metricSources: [staged],
      }),
    ],
  });

  const entry = scenarioFile({
    path: ENTRY_FILE,
    mappings: [
      mappingDecl({
        name: "stage_raw",
        namespace: "warehouse",
        sources: [raw],
        targets: [staged],
        arrows: [
          mapArrow(
            [endpoint(raw, first)],
            endpoint(staged, first),
            nlTransform("Trim and upper-case.", [endpoint(raw, second)]),
          ),
          computedArrow(endpoint(staged, "loaded_at"), nlTransform("Stamped at load time.")),
          eachBlock(
            endpoint(raw, "lines"),
            endpoint(staged, "lines"),
            leaves().map((leaf) =>
              mapArrow([endpoint(raw, `lines.${leaf}`)], endpoint(staged, `lines.${leaf}`)),
            ),
          ),
        ],
      }),
      mappingDecl({
        name: "load_metric",
        sources: [staged],
        targets: [metric],
        arrows: [mapArrow([endpoint(staged, first)], endpoint(metric, first))],
      }),
    ],
  });

  return scenarioWorkspace([entry, schemas, metrics, library]);
})();

/**
 * The default generated domain: one axis at a time, chosen uniformly.
 *
 * A property that states an invariant over *any* workspace should use this. A
 * property about one axis should use that axis's arbitrary directly, so a
 * counterexample is a workspace exercising the thing under test rather than an
 * unrelated shape that happened to fail.
 */
export const workspaceScenarioArbitrary = fc.oneof(
  chainWorkspaceArbitrary.map(({ workspace }) => workspace),
  diamondWorkspaceArbitrary.map(({ workspace }) => workspace),
  cyclicWorkspaceArbitrary.map(({ workspace }) => workspace),
  multiFileWorkspaceArbitrary.map(({ workspace }) => workspace),
  namespacedWorkspaceArbitrary.map(({ workspace }) => workspace),
  containerWorkspaceArbitrary.map(({ workspace }) => workspace),
  nlRefWorkspaceArbitrary.map(({ workspace }) => workspace),
  computedArrowWorkspaceArbitrary.map(({ workspace }) => workspace),
  metricWorkspaceArbitrary.map(({ workspace }) => workspace),
  spreadWorkspaceArbitrary.map(({ workspace }) => workspace),
  multiSourceWorkspaceArbitrary.map(({ workspace }) => workspace),
  fc.constant(kitchenSinkWorkspace),
);

// ── Structural transformations ─────────────────────────────────────────────

/**
 * A permutation of `[0 … length)`, for properties that reorder declarations.
 *
 * A rotation would be cheaper but is a much weaker test: it preserves every
 * pairwise ordering except at the wrap point, so an implementation that depended
 * on, say, "the first schema declared" could survive it.
 */
export function permutationArbitrary(length) {
  return fc.shuffledSubarray(
    Array.from({ length }, (_, index) => index),
    { minLength: length, maxLength: length },
  );
}

/**
 * Reorder every file's declarations by the given permutations.
 *
 * The emitted edge set must not move: nothing about which fields flow where is a
 * function of declaration order. The import-merge path in particular assumes it,
 * because a merged multi-file model has no single declaration order to speak of.
 */
export function permuteWorkspaceDeclarations(workspace, permutations) {
  const reorder = (items, permutation) =>
    permutation.length === items.length ? permutation.map((index) => items[index]) : items;
  return scenarioWorkspace(
    workspace.files.map((file, fileIndex) => ({
      ...file,
      schemas: reorder(file.schemas, permutations[fileIndex]?.schemas ?? []),
      mappings: reorder(file.mappings, permutations[fileIndex]?.mappings ?? []),
    })),
  );
}

/**
 * The permutations {@link permuteWorkspaceDeclarations} needs for one workspace.
 *
 * Generated per file, because each file has its own declaration counts.
 */
export function workspacePermutationsArbitrary(workspace) {
  return fc.tuple(
    ...workspace.files.map((file) =>
      fc.record({
        schemas: permutationArbitrary(file.schemas.length),
        mappings: permutationArbitrary(file.mappings.length),
      }),
    ),
  );
}

/**
 * Redistribute a workspace's declarations so each schema has a file of its own.
 *
 * The same declarations spread across more files must produce the same edge set —
 * the property the import-merge path assumes and never states.
 *
 * The layout is forced by Satsuma's explicit import scoping (spec §5.3), not
 * chosen for tidiness:
 *
 * - **All mappings stay in the entry file.** A mapping references every schema it
 *   touches, so the entry imports every schema file, and following imports from
 *   the entry therefore reaches all of them. Give a mapping its own file instead
 *   and nothing imports it — the command would never load it, and every edge it
 *   declares would look like a toolchain omission.
 * - **Fragments get their own file, not the entry's.** A schema that spreads a
 *   fragment must import it; if the fragment lived in the entry, the entry and the
 *   schema file would import each other.
 *
 * Mapping *namespaces* are preserved, so a namespaced mapping moved into the entry
 * file is still namespaced.
 */
export function splitWorkspaceAcrossFiles(workspace) {
  const fragments = workspace.files.flatMap((file) => file.fragments);
  const schemas = workspace.files.flatMap((file) => file.schemas);
  const mappings = workspace.files.flatMap((file) => file.mappings);

  return scenarioWorkspace([
    scenarioFile({ path: ENTRY_FILE, mappings }),
    ...schemas.map((schema, index) =>
      scenarioFile({ path: `schema${index}.stm`, schemas: [schema] }),
    ),
    ...(fragments.length > 0 ? [scenarioFile({ path: "lib.stm", fragments })] : []),
  ]);
}
