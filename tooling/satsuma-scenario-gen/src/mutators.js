/**
 * mutators.js — one-defect mutations of a valid workspace, and the diagnostics
 * each one predicts.
 *
 * Every other domain in this package builds workspaces the toolchain should
 * *accept*, which is why the whole diagnostic surface — `validate`'s rules, the
 * import-scope check, and the CLI lint registry — is still proved by fixtures a
 * person wrote (Feature 46 PRD, gap 1). A mutator is the negative half: take a
 * workspace that validates clean, break exactly one thing, and state every
 * diagnostic that break causes.
 *
 * ## Three rules that keep this honest rather than circular
 *
 * **1. The predicted set is complete, not minimal.** One defect cascades:
 * deleting a field breaks every arrow that names it, and retyping one field
 * breaks every bare arrow with that field on either end. An "exactly one
 * diagnostic" oracle would therefore be *wrong*, so each mutator enumerates its
 * whole consequence set. A mutation whose consequences this module cannot
 * enumerate does not belong here — that is why the target of each mutation is
 * chosen under stated preconditions rather than at random.
 *
 * **2. A mutator states its precondition and reports when it does not hold.**
 * Applied to a workspace whose shape it cannot break, a mutator returns
 * {@link mutationNotApplicable} rather than a workspace that is still valid. A
 * vacuous mutation that looked like a mutation would fail a consuming property as
 * a *missed diagnostic*, which is the one failure mode worth designing against.
 *
 * **3. Diagnostics are named by rule id and entity, never by message text or
 * byte offset.** Message wording is a consumer concern, and restating it here
 * would make this package a second implementation of diagnostic formatting
 * (PRD decision 1). `line` is a hint for a failure message only — the assertion
 * is containment in the mutated construct, not equality with a line number
 * (PRD decision 4).
 *
 * ## What a consumer must know
 *
 * - **`file` is the workspace-relative path** the scenario uses (`entry.stm`),
 *   not the absolute path a loaded diagnostic carries. Compare basenames.
 * - **`entity` is a name the diagnostic's message is required to mention.**
 *   Diagnostics carry no entity field — `SemanticDiagnostic` and `LintFinding`
 *   are both `(file, line, column, severity, rule, message)` — so "which
 *   construct is this about" is only observable through the message. Each
 *   mutator documents the spelling it predicts, and it is always the spelling the
 *   *source text* uses: `s0`, `warehouse::staged`, `s0.field_0`.
 * - **`surfaces` says which command reports it.** `duplicate-definition` and
 *   `unresolved-nl-ref` are registered by both `validate` and `lint`, so a
 *   property that compared its predicted set against one command's output alone
 *   would see the other's rules as spurious. Filter with
 *   {@link expectedForSurface}.
 * - **Repeated keys in `expected` are meaningful, so compare multisets.** One
 *   mutation can predict two diagnostics that agree on `(rule, file, entity)` and
 *   differ only in which arrow raised them — deleting a mid-chain field is
 *   reported once as a target and once as a source, both naming `field_0` in the
 *   same file. Collapsing `expected` into a set would silently stop checking the
 *   cascade this contract exists to state, so a consumer must compare *counts*.
 *   `scenarioFieldEdges` treats its own duplicates the same way and for the same
 *   reason.
 * - **A defect mutator's result is a deep copy; a null mutator's is not.** The
 *   defect mutators clone before editing, so the caller's workspace is untouched.
 *   The two that delegate to `permuteWorkspaceDeclarations` and
 *   `splitWorkspaceAcrossFiles` reorganise files but share the declaration objects
 *   inside them, because neither helper copies and neither needs to. Harmless for
 *   the intended use — a consumer renders a null-mutated workspace and compares
 *   diagnostics — but a consumer that chained a defect mutation *onto* a null one
 *   would be editing shared state, so chain in the other order.
 * - **The comparison is against a clean baseline.** `expected` is what the
 *   mutation *adds*: as multisets of `(rule, file, entity)`,
 *   `diagnostics(mutated)` must equal `diagnostics(base)` summed with `expected`
 *   — multiset union, not set union, for the reason in the bullet above. Every
 *   mutator here assumes the consumer has already asserted the base is clean.
 *   One generated domain is not lint-clean to begin with —
 *   `cyclicWorkspaceArbitrary` declares a real lineage cycle — so
 *   {@link workspaceHasSchemaCycle} is exported for consumers to exclude it.
 *
 * Owns: the mutations, their preconditions, and the diagnostics they predict.
 * Does not own: rendering (workspace-render.js), the valid domains
 * (workspace-arbitraries.js), or any assertion — a mutator never says whether the
 * toolchain got it right.
 */

import { scalarField } from "./model.js";
import {
  endpoint,
  mapArrow,
  mappingDecl,
  nlTransform,
  scenarioFile,
  scenarioWorkspace,
  flattenArrows,
  workspaceMappings,
  workspaceSchemas,
} from "./workspace-model.js";
import { authoredEndpoint, renderWorkspace } from "./workspace-render.js";
import {
  permuteWorkspaceDeclarations,
  splitWorkspaceAcrossFiles,
} from "./workspace-arbitraries.js";

// ── The rule ids a mutation can predict ────────────────────────────────────
//
// Copied as literals from the three registries, because this package may not
// depend on `@satsuma/core` (see index.js). The registries are:
//   - `satsuma-core/src/validate.ts` — the seven semantic rules;
//   - `satsuma-core/src/import-reachability.ts`, reported by `validate.ts`'s
//     `checkImportScope` under the caller's policy id, which the CLI leaves at
//     the default `import-scope`;
//   - `satsuma-cli/src/lint-engine.ts` `RULES` — six rules, two of which are
//     registered through core's `TYPE_MISMATCH_RULE_ID` and
//     `LINEAGE_CYCLE_RULE_ID` constants rather than as literal strings, which is
//     exactly why an audit of that registry by eye misses them (PRD decision 3).

/** Every rule id a mutator in this module predicts. */
export const DIAGNOSTIC_RULES = Object.freeze({
  /** validate: an arrow path no participating schema declares. */
  fieldNotInSchema: "field-not-in-schema",
  /** validate + lint: the same name declared twice in one namespace. */
  duplicateDefinition: "duplicate-definition",
  /** validate: a mapping, metric or spread naming an entity nothing declares. */
  undefinedRef: "undefined-ref",
  /** validate + lint: an NL `@ref` that resolves to nothing. */
  unresolvedNlRef: "unresolved-nl-ref",
  /** validate: an NL `@ref` to a schema outside the mapping's source/target list. */
  nlRefNotInSource: "nl-ref-not-in-source",
  /** lint: the same shape as `nl-ref-not-in-source`, reported as an error. */
  hiddenSourceInNl: "hidden-source-in-nl",
  /** validate: a constraint flag lexed as a type argument — `STRING(pk)`. */
  constraintInTypeArgs: "constraint-in-type-args",
  /** validate: two files disagree about a namespace-level metadata tag. */
  namespaceMetadataConflict: "namespace-metadata-conflict",
  /** validate: a symbol used but not reachable through the file's imports (ADR-022). */
  importScope: "import-scope",
  /** lint: an arrow onto a record with neither a record source nor child arrows. */
  unenumeratedRecordTarget: "unenumerated-record-target",
  /** lint: a bare arrow whose two ends declare different types. */
  typeMismatchDirectArrow: "type-mismatch-direct-arrow",
  /** lint: the schema-level mapping graph contains a cycle. */
  lineageCycle: "lineage-cycle",
});

/** The command that reports a predicted diagnostic. */
const VALIDATE = "validate";
const LINT = "lint";
/** Both registries declare the rule, so both commands report it. */
const BOTH = [VALIDATE, LINT];

// ── The contract ───────────────────────────────────────────────────────────

/**
 * One diagnostic a mutation predicts.
 *
 * @typedef {{
 *   rule: string,
 *   file: string,
 *   entity: string,
 *   line: number | null,
 *   surfaces: string[],
 * }} PredictedDiagnostic
 */

/**
 * A mutated workspace and everything that follows from the mutation.
 *
 * @typedef {{
 *   applicable: true,
 *   workspace: import("./workspace-model.js").ScenarioWorkspace,
 *   mutation: { kind: string, target: string },
 *   expected: PredictedDiagnostic[],
 * }} WorkspaceDefect
 */

/**
 * A mutation that had nothing to break in the given workspace.
 *
 * @typedef {{
 *   applicable: false,
 *   mutation: { kind: string, target: null },
 *   reason: string,
 * }} MutationNotApplicable
 */

/** @typedef {WorkspaceDefect | MutationNotApplicable} MutationResult */

/**
 * Report that a mutation's precondition does not hold.
 *
 * `reason` names the shape the mutator needed, so a property that skips a sample
 * can say *why* it skipped rather than silently passing.
 */
function mutationNotApplicable(kind, reason) {
  return { applicable: false, mutation: { kind, target: null }, reason };
}

/** True when a mutator produced a defect rather than reporting its precondition. */
export function isWorkspaceDefect(result) {
  return result.applicable === true;
}

/**
 * The predicted diagnostics one command reports.
 *
 * A property drives one command at a time, so it must compare against that
 * command's share of the prediction — `duplicate-definition` appears in both
 * registries and `unenumerated-record-target` in neither of the other's.
 */
export function expectedForSurface(defect, surface) {
  return defect.expected.filter((diagnostic) => diagnostic.surfaces.includes(surface));
}

/**
 * Build one prediction. `locator` is the declaration header the diagnostic sits
 * inside; {@link finishDefect} turns it into the `line` hint.
 */
function predict({ rule, file, entity, surfaces, locator }) {
  return { rule, file, entity, surfaces, locator };
}

/**
 * Assemble a {@link WorkspaceDefect}, resolving each prediction's `line` hint.
 *
 * The hint is the first rendered line of the *construct* the diagnostic sits
 * inside, found by rendering the mutated workspace and searching for the
 * declaration header. It is deliberately coarse: an exact line would couple every
 * consuming property to this package's layout choices, which is what PRD decision
 * 4 rules out. `null` means the construct could not be located, which is a
 * degraded failure message and never a wrong assertion.
 */
function finishDefect({ workspace, kind, target, expected }) {
  const sources = new Map(renderWorkspace(workspace).map((file) => [file.path, file.source]));
  return {
    applicable: true,
    workspace,
    mutation: { kind, target },
    expected: expected.map(({ locator, ...diagnostic }) => ({
      ...diagnostic,
      line: locateLine(sources.get(diagnostic.file), locator),
    })),
  };
}

/** 1-based line of the first occurrence of `needle`, or null. */
function locateLine(source, needle) {
  if (source === undefined || needle === undefined) return null;
  const index = source.split("\n").findIndex((line) => line.includes(needle));
  return index === -1 ? null : index + 1;
}

// ── Reading a scenario ─────────────────────────────────────────────────────

/** A deep copy, so a mutator never edits the caller's workspace in place. */
function clone(workspace) {
  return structuredClone(workspace);
}

/** The authored spelling of a declaration's own name: `name`, or `ns::name`. */
function authoredRefOf(decl) {
  return decl.namespace ? `${decl.namespace}::${decl.name}` : decl.name;
}

/** The rendered header a schema declaration opens with — the `line` hint locator. */
function schemaLocator(schema) {
  return `schema ${schema.name}`;
}

/** The rendered header a mapping declaration opens with. */
function mappingLocator(mapping) {
  return `mapping ${mapping.name} {`;
}

/** Every top-level scalar field a schema declares in its own body. */
function ownScalarFields(schema) {
  return schema.fields.filter((field) => field.kind === "scalar");
}

/** Every top-level record field a schema declares in its own body. */
function ownRecordFields(schema) {
  return schema.fields.filter((field) => field.kind === "record");
}

/** One arrow endpoint, with the side it sits on — sources first, then the target. */
function endpointsOf(arrow) {
  const sources = arrow.kind === "computed" ? [] : (arrow.sources ?? [arrow.source]);
  return [
    ...sources.map((endpoint) => ({ side: "source", endpoint })),
    ...(arrow.target ? [{ side: "target", endpoint: arrow.target }] : []),
  ];
}

/** Do two endpoints name the same declared field? */
function sameEndpoint(left, right) {
  return left.schema === right.schema && left.path === right.path;
}

/**
 * Every arrow in the workspace, with the mapping and file that declare it.
 *
 * Container headers are included, because they are arrows in their own right —
 * they name a source and a target, and every rule that reasons about arrows sees
 * them.
 */
function allArrows(workspace) {
  return workspaceMappings(workspace).flatMap(({ file, mapping }) =>
    flattenArrows(mapping.arrows).map((arrow) => ({ file, mapping, arrow })),
  );
}

/** Every NL `@ref` in the workspace, addressable for mutation by index. */
function allNlRefs(workspace) {
  return allArrows(workspace).flatMap(({ file, mapping, arrow }) =>
    (arrow.transform?.refs ?? []).map((ref, refIndex) => ({
      file,
      mapping,
      arrow,
      refIndex,
      ref,
    })),
  );
}

/** Every name the workspace uses, so a mutation can pick one that collides with none. */
function usedNames(workspace) {
  const names = new Set();
  for (const file of workspace.files) {
    for (const fragment of file.fragments) names.add(fragment.name);
    for (const schema of file.schemas) names.add(schema.name);
    for (const mapping of file.mappings) names.add(mapping.name);
  }
  return names;
}

/** `base`, or `base_2`, `base_3`… — the first spelling the workspace does not use. */
function freshName(workspace, base) {
  const taken = usedNames(workspace);
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * The order the CLI's loader reaches a workspace's files: the entry, then every
 * other file in the path order the renderer emits its `import` statements in.
 *
 * Two mutations need it. `duplicate-definition` and
 * `namespace-metadata-conflict` are both reported against the *later* of two
 * declarations, so which file a prediction names is a function of load order —
 * and a mutator that guessed would produce a prediction that is right half the
 * time, which is worse than one that is wrong every time.
 */
function loadOrder(workspace) {
  const [entry, ...rest] = workspace.files.map((file) => file.path);
  return [entry, ...rest.sort((left, right) => left.localeCompare(right))];
}

/** The later of two files in {@link loadOrder} — the one a duplicate is blamed on. */
function laterLoaded(workspace, first, second) {
  const order = loadOrder(workspace);
  return order.indexOf(first) > order.indexOf(second) ? first : second;
}

// ── The schema-level mapping graph, for the cycle mutation ─────────────────

/**
 * The schema-to-schema edges a workspace's mappings declare: one per
 * (source, target) pair, with the mapping and file responsible.
 *
 * Derived from the declared `source { }` / `target { }` lists rather than from
 * arrows, which is the same rule `scenarioSchemaEdges` follows and the same one
 * the lint rule's own graph follows: a mapping declares topology even with no
 * arrows at all.
 */
function schemaEdges(workspace) {
  return workspaceMappings(workspace).flatMap(({ file, mapping }) =>
    mapping.sources.flatMap((from) =>
      mapping.targets.map((to) => ({ from, to, mapping: mapping.name, file })),
    ),
  );
}

/** Every node reachable from `start` by following `edges` forwards, `start` included. */
function reachableFrom(edges, start) {
  const seen = new Set([start]);
  const queue = [start];
  while (queue.length > 0) {
    const node = queue.shift();
    for (const edge of edges) {
      if (edge.from === node && !seen.has(edge.to)) {
        seen.add(edge.to);
        queue.push(edge.to);
      }
    }
  }
  return seen;
}

/** Every node that can reach `end`, `end` included. */
function reachingTo(edges, end) {
  return reachableFrom(
    edges.map((edge) => ({ from: edge.to, to: edge.from })),
    end,
  );
}

/**
 * Does the workspace's schema-level mapping graph already contain a cycle?
 *
 * Exported because a consumer needs it as a *filter*, not just this module:
 * `cyclicWorkspaceArbitrary` deliberately produces workspaces that are
 * semantically valid but already carry a `lineage-cycle` lint finding, and a
 * property comparing a mutated workspace's findings against a clean baseline must
 * exclude them.
 */
export function workspaceHasSchemaCycle(workspace) {
  const edges = schemaEdges(workspace);
  return edges.some((edge) => reachableFrom(edges, edge.to).has(edge.from));
}

// ── Defect 1: delete a field a target arrow names ──────────────────────────

/**
 * Delete a scalar field declaration that arrows still name.
 *
 * Predicts one `field-not-in-schema` per arrow *endpoint* that names the deleted
 * path — which is more than one whenever the field sits mid-chain, where it is a
 * mapping's target and the next mapping's source. That cascade is the reason this
 * contract predicts a set rather than a single diagnostic.
 *
 * Preconditions, each narrowing the mutation to a shape whose consequences are
 * fully enumerable:
 *
 * - the field is a **top-level scalar** in the schema's own body, so no container
 *   header and no relative child arrow can name it;
 * - the schema declares **another** field, so deleting this one does not empty the
 *   declaration and change what other rules can say about it;
 * - **no NL `@ref` mentions it**, because an `@ref` at a deleted field also raises
 *   `unresolved-nl-ref` and that belongs to its own mutator;
 * - **every mapping declares exactly one target**, because `validate` checks arrow
 *   targets against `targets[0]` alone. Rather than predict that limitation (and
 *   so hide it if it changes), the mutation declines to run where it would apply.
 */
export function deleteMappedField(workspace) {
  const kind = "delete-mapped-field";

  if (!workspaceMappings(workspace).every(({ mapping }) => mapping.targets.length === 1)) {
    return mutationNotApplicable(
      kind,
      "a mapping declares more than one target; validate only checks arrow targets " +
        "against the first, so the consequence set is not enumerable",
    );
  }

  const mentionedByNlRef = allNlRefs(workspace).map(({ ref }) => ref);
  for (const { file, schema } of workspaceSchemas(workspace)) {
    if (ownScalarFields(schema).length + ownRecordFields(schema).length < 2) continue;

    for (const field of ownScalarFields(schema)) {
      const doomed = { schema: authoredRefOf(schema), path: field.name };
      if (mentionedByNlRef.some((ref) => sameEndpoint(ref, doomed))) continue;

      const naming = allArrows(workspace).flatMap(({ file: arrowFile, mapping, arrow }) =>
        endpointsOf(arrow)
          .filter(({ endpoint }) => sameEndpoint(endpoint, doomed))
          .map(({ side }) => ({ arrowFile, mapping, side })),
      );
      if (naming.length === 0) continue;

      const mutated = clone(workspace);
      const victim = mutated.files
        .find((candidate) => candidate.path === file)
        .schemas.find((candidate) => candidate.name === schema.name);
      victim.fields = victim.fields.filter((candidate) => candidate.name !== field.name);

      return finishDefect({
        workspace: mutated,
        kind,
        target: `${doomed.schema}.${doomed.path}`,
        expected: naming.map(({ arrowFile, mapping, side }) =>
          predict({
            rule: DIAGNOSTIC_RULES.fieldNotInSchema,
            file: arrowFile,
            // The message quotes the path as *authored*, which is bare on a
            // single-schema side and `schema.path` on a multi-schema one.
            entity: authoredEndpoint(doomed, side === "source" ? mapping.sources : mapping.targets),
            surfaces: [VALIDATE],
            locator: mappingLocator(mapping),
          }),
        ),
      });
    }
  }

  return mutationNotApplicable(
    kind,
    "no schema declares a top-level scalar field that an arrow names, no NL @ref " +
      "mentions, and that is not the schema's only field",
  );
}

// ── Defect 2: duplicate an entity within one file ──────────────────────────

/**
 * Declare the same schema twice in the file that already declares it.
 *
 * The copy is identical, so the index merges the two field lists and nothing else
 * changes: the whole consequence is one `duplicate-definition`, reported by both
 * `validate` and the lint registry.
 */
export function duplicateEntityWithinFile(workspace) {
  const kind = "duplicate-entity-within-file";
  const first = workspaceSchemas(workspace)[0];
  if (first === undefined) {
    return mutationNotApplicable(kind, "the workspace declares no schema to duplicate");
  }

  const mutated = clone(workspace);
  const file = mutated.files.find((candidate) => candidate.path === first.file);
  file.schemas.push(structuredClone(first.schema));

  return finishDefect({
    workspace: mutated,
    kind,
    target: authoredRefOf(first.schema),
    expected: [
      predict({
        rule: DIAGNOSTIC_RULES.duplicateDefinition,
        file: first.file,
        // The message quotes the bare declared name: "Schema 's0' is already
        // defined in …". The namespace is carried by the index key, not the text.
        entity: first.schema.name,
        surfaces: BOTH,
        locator: schemaLocator(first.schema),
      }),
    ],
  });
}

// ── Defect 3: duplicate an entity into a second file ───────────────────────

/**
 * Declare the same schema in a second file, reached through the same entry.
 *
 * This is `sl-rw3e`'s shape — the defect where duplicates were reported at one
 * site but not the other — and it needs two files that are *both* import
 * reachable. The mutation therefore normalises the layout with
 * {@link splitWorkspaceAcrossFiles} first, so every schema is imported by the
 * entry's mappings and a second declaration of one of them is imported too. That
 * split is itself a null mutation, so it adds nothing to the predicted set.
 *
 * The copy goes in a file named to sort last, because the duplicate is blamed on
 * whichever declaration the loader reaches second.
 */
export function duplicateEntityAcrossFiles(workspace) {
  const kind = "duplicate-entity-across-files";
  const split = splitWorkspaceAcrossFiles(workspace);
  const referenced = new Set(
    workspaceMappings(split).flatMap(({ mapping }) => [...mapping.sources, ...mapping.targets]),
  );
  const original = workspaceSchemas(split).find(({ schema }) =>
    referenced.has(authoredRefOf(schema)),
  );
  if (original === undefined) {
    return mutationNotApplicable(
      kind,
      "no schema is named by a mapping, so a second declaration of one would sit in " +
        "a file nothing imports and the loader would never see it",
    );
  }

  const copyPath = "zz-duplicate.stm";
  const mutated = scenarioWorkspace([
    ...split.files.map((file) => structuredClone(file)),
    scenarioFile({ path: copyPath, schemas: [structuredClone(original.schema)] }),
  ]);

  return finishDefect({
    workspace: mutated,
    kind,
    target: authoredRefOf(original.schema),
    expected: [
      predict({
        rule: DIAGNOSTIC_RULES.duplicateDefinition,
        file: laterLoaded(mutated, original.file, copyPath),
        entity: original.schema.name,
        surfaces: BOTH,
        locator: schemaLocator(original.schema),
      }),
    ],
  });
}

// ── Defect 4: break an import ──────────────────────────────────────────────

/** The field a withheld-import mutation adds, named so it collides with nothing. */
const WITHHELD_IMPORT_FIELD = "mutator_stamp";
/** The fragment a withheld-import mutation adds when the workspace has none. */
const WITHHELD_IMPORT_FRAGMENT = "mutator_shared_fields";

/**
 * Remove the `import` a file's own fragment spread depends on.
 *
 * This is the only mutation that reaches ADR-022's import-scope check, and it
 * takes a construction rather than an edit. Two facts force it:
 *
 * - **Imports are derived from usage** (workspace-render.js), so no valid scenario
 *   can fail the check — a file always imports exactly what it references. The
 *   `withheldImports` hole exists for this mutation and nothing else.
 * - **Dropping an import must not unload the file it pointed at.** An entity
 *   nothing imports is not merely out of scope, it is absent, and `validate`
 *   reports `undefined-ref` instead. So the fragment needs a *second* spreader in
 *   another file, which keeps its file loaded while the first file's reference
 *   goes out of scope.
 *
 * The layout is normalised with {@link splitWorkspaceAcrossFiles} (a null
 * mutation) so each schema has its own file, and the two spreading schemas are
 * chosen from those a mapping names, so the entry imports both of their files.
 */
export function withholdSpreadImport(workspace) {
  const kind = "withhold-spread-import";
  const split = splitWorkspaceAcrossFiles(workspace);
  const referenced = new Set(
    workspaceMappings(split).flatMap(({ mapping }) => [...mapping.sources, ...mapping.targets]),
  );
  const spreaders = workspaceSchemas(split).filter(({ schema }) =>
    referenced.has(authoredRefOf(schema)),
  );
  if (spreaders.length < 2) {
    return mutationNotApplicable(
      kind,
      "fewer than two schemas are named by a mapping, so there is no second spreader " +
        "to keep the fragment's file loaded once the import is withheld",
    );
  }

  const mutated = scenarioWorkspace(split.files.map((file) => structuredClone(file)));
  const existingFragment = mutated.files.flatMap((file) => file.fragments)[0];
  const fragmentName = existingFragment?.name ?? WITHHELD_IMPORT_FRAGMENT;
  if (existingFragment === undefined) {
    mutated.files.push(
      scenarioFile({
        path: "lib.stm",
        fragments: [{ name: fragmentName, fields: [scalarField(WITHHELD_IMPORT_FIELD)] }],
      }),
    );
  }

  const [withheldFrom, secondSpreader] = spreaders.slice(0, 2);
  for (const { file, schema } of [withheldFrom, secondSpreader]) {
    const declaration = mutated.files
      .find((candidate) => candidate.path === file)
      .schemas.find((candidate) => candidate.name === schema.name);
    declaration.spreads = [...new Set([...(declaration.spreads ?? []), fragmentName])];
  }
  const strippedFile = mutated.files.find((candidate) => candidate.path === withheldFrom.file);
  strippedFile.withheldImports = [fragmentName];

  return finishDefect({
    workspace: mutated,
    kind,
    target: `${withheldFrom.file} → ${fragmentName}`,
    expected: [
      predict({
        rule: DIAGNOSTIC_RULES.importScope,
        file: withheldFrom.file,
        // "Schema 's0' references fragment 'f' which is not reachable …" — the
        // referencing entity is what the message leads with.
        entity: withheldFrom.schema.name,
        surfaces: [VALIDATE],
        locator: schemaLocator(withheldFrom.schema),
      }),
    ],
  });
}

// ── Defect 5: reference an undefined entity ────────────────────────────────

/** The name an undefined-reference mutation points at. Nothing may declare it. */
const UNDEFINED_ENTITY = "mutator_missing_schema";

/**
 * Add a mapping whose source names an entity nothing declares.
 *
 * A *new* mapping rather than an edit to an existing one, for two reasons. Adding
 * a second source to a mapping would requalify every arrow path on that side
 * (`field_0` becomes `s0.field_0`), which changes far more than the reference
 * under test; and retargeting an existing source would remove a reference, which
 * can unload the file that declared it and cascade into further `undefined-ref`s.
 * A mapping with no arrows adds exactly one reference and nothing else.
 */
export function referenceUndefinedEntity(workspace) {
  const kind = "reference-undefined-entity";
  const host = workspaceMappings(workspace)[0];
  if (host === undefined) {
    return mutationNotApplicable(
      kind,
      "the workspace declares no mapping, so there is no file whose mappings a " +
        "dangling reference could join",
    );
  }

  const name = freshName(workspace, "mutator_dangling_map");
  const mutated = clone(workspace);
  mutated.files
    .find((candidate) => candidate.path === host.file)
    .mappings.push(
      mappingDecl({
        name,
        namespace: host.mapping.namespace,
        sources: [UNDEFINED_ENTITY],
        targets: [...host.mapping.targets],
        arrows: [],
      }),
    );

  return finishDefect({
    workspace: mutated,
    kind,
    target: UNDEFINED_ENTITY,
    expected: [
      predict({
        rule: DIAGNOSTIC_RULES.undefinedRef,
        file: host.file,
        // "Mapping 'm' references undefined source 'x'" — the message names both;
        // the undefined name is the one the mutation is about.
        entity: UNDEFINED_ENTITY,
        surfaces: [VALIDATE],
        locator: `mapping ${name} {`,
      }),
    ],
  });
}

// ── Defect 6: point an NL `@ref` at a name nothing declares ────────────────

/** The field name an NL-ref mutation points at. No generated schema declares it. */
const UNDECLARED_FIELD = "mutator_missing_field";

/**
 * Repoint an NL `@ref` at a field its schema does not declare.
 *
 * The schema is left alone so the ref still *parses* as a dotted field ref and
 * still resolves its prefix — what fails is the field lookup, which is
 * `unresolved-nl-ref`. Both `validate` and the lint registry report it.
 */
export function breakNlRefTarget(workspace) {
  const kind = "break-nl-ref-target";
  const [first] = allNlRefs(workspace);
  if (first === undefined) {
    return mutationNotApplicable(kind, "no arrow carries an NL transform with an @ref");
  }

  const mutated = clone(workspace);
  const broken = locateNlRef(mutated, first);
  broken.path = UNDECLARED_FIELD;

  const authored = `${broken.schema}.${broken.path}`;
  return finishDefect({
    workspace: mutated,
    kind,
    target: authored,
    expected: [
      predict({
        rule: DIAGNOSTIC_RULES.unresolvedNlRef,
        file: first.file,
        // The message quotes the ref as written, minus the `@`.
        entity: authored,
        surfaces: BOTH,
        locator: mappingLocator(first.mapping),
      }),
    ],
  });
}

/**
 * Point an NL `@ref` at a schema the mapping does not declare as a source or target.
 *
 * The ref still resolves — the schema and field both exist — so this is the other
 * NL failure: a hidden dependency. `validate` calls it `nl-ref-not-in-source`
 * (warning) and the lint registry calls the same shape `hidden-source-in-nl`
 * (error), so one mutation predicts two diagnostics with different rule ids.
 */
export function pointNlRefOutsideSourceList(workspace) {
  const kind = "point-nl-ref-outside-source-list";
  const [first] = allNlRefs(workspace);
  if (first === undefined) {
    return mutationNotApplicable(kind, "no arrow carries an NL transform with an @ref");
  }

  const participating = new Set([...first.mapping.sources, ...first.mapping.targets]);
  const outsider = workspaceSchemas(workspace).find(
    ({ schema }) => !participating.has(authoredRefOf(schema)) && ownScalarFields(schema).length > 0,
  );
  if (outsider === undefined) {
    return mutationNotApplicable(
      kind,
      `every schema with a scalar field is declared by mapping '${first.mapping.name}', ` +
        "so no ref target exists that resolves and is still outside its lists",
    );
  }

  const mutated = clone(workspace);
  const repointed = locateNlRef(mutated, first);
  repointed.schema = authoredRefOf(outsider.schema);
  repointed.path = ownScalarFields(outsider.schema)[0].name;

  const authored = `${repointed.schema}.${repointed.path}`;
  const shared = { file: first.file, entity: authored, locator: mappingLocator(first.mapping) };
  return finishDefect({
    workspace: mutated,
    kind,
    target: authored,
    expected: [
      predict({ ...shared, rule: DIAGNOSTIC_RULES.nlRefNotInSource, surfaces: [VALIDATE] }),
      predict({ ...shared, rule: DIAGNOSTIC_RULES.hiddenSourceInNl, surfaces: [LINT] }),
    ],
  });
}

/** The same `@ref` object inside a cloned workspace, addressed by its indices. */
function locateNlRef(mutated, original) {
  const found = allNlRefs(mutated).find(
    (candidate) =>
      candidate.file === original.file &&
      candidate.mapping.name === original.mapping.name &&
      candidate.refIndex === original.refIndex &&
      sameEndpoint(candidate.ref, original.ref),
  );
  return found.ref;
}

// ── Defect 7: introduce a lineage cycle ────────────────────────────────────

/**
 * Add a mapping that closes a loop in the schema-level graph.
 *
 * `lineage-cycle` reports one finding per strongly connected component, against
 * the mapping declaring the first hop of a representative path through it. So the
 * mutation predicts one finding — but it can only say *which file* if every
 * mapping that joins the component is declared in the same file, which it checks.
 *
 * The component created by adding `B -> A` is every schema reachable from `A` that
 * can also reach `B`; the mutation computes it from the scenario's own edges, and
 * every member is named in the message.
 */
export function closeLineageCycle(workspace) {
  const kind = "close-lineage-cycle";
  if (workspaceHasSchemaCycle(workspace)) {
    return mutationNotApplicable(
      kind,
      "the workspace already declares a lineage cycle, so the finding would exist " +
        "before the mutation",
    );
  }

  const edges = schemaEdges(workspace);
  for (const { file, mapping } of workspaceMappings(workspace)) {
    const from = mapping.targets[0];
    const to = mapping.sources[0];
    if (from === undefined || to === undefined || from === to) continue;

    // Members of the component the new edge closes, and the mappings inside it.
    const component = new Set(
      [...reachableFrom(edges, to)].filter((node) => reachingTo(edges, from).has(node)),
    );
    const interior = edges.filter((edge) => component.has(edge.from) && component.has(edge.to));
    if (interior.some((edge) => edge.file !== file)) {
      continue; // The anchor could be any of them, so the file is not predictable.
    }

    const name = freshName(workspace, "mutator_closing_map");
    const mutated = clone(workspace);
    mutated.files
      .find((candidate) => candidate.path === file)
      .mappings.push(
        mappingDecl({
          name,
          namespace: mapping.namespace,
          sources: [from],
          targets: [to],
          arrows: [],
        }),
      );

    return finishDefect({
      workspace: mutated,
      kind,
      target: `${from} -> ${to}`,
      expected: [
        predict({
          rule: DIAGNOSTIC_RULES.lineageCycle,
          file,
          // Every component member appears in the message: the representative
          // path names some, and "Component also includes …" names the rest.
          entity: from,
          surfaces: [LINT],
          locator: mappingLocator(mapping),
        }),
      ],
    });
  }

  return mutationNotApplicable(
    kind,
    "no mapping connects two different schemas with every interior mapping of the " +
      "resulting component in one file",
  );
}

// ── Defect 8: make a bare arrow connect mismatched types ───────────────────

/**
 * The type a retyped field is given.
 *
 * Any token distinct from the generated default (`STRING`) would do; a date is
 * chosen because a `STRING`/`DATE` pass-through is the mistake the rule was
 * written for. It must not be a member of a configured alias group, and no
 * generated workspace configures any.
 */
const MISMATCHED_TYPE = "DATE";

/**
 * Retype a scalar field so every bare arrow across it connects two declared types.
 *
 * The consequence set is every bare arrow with the retyped path on exactly one
 * end — mid-chain that is two arrows, one flowing in and one flowing out. The
 * rule's own exemptions decide which arrows are *not* in the set, and the
 * prediction states them rather than inheriting them:
 *
 * - an arrow carrying a transform body classifies `nl`, and the rule does not
 *   judge whether a transform preserves type;
 * - an arrow with several sources asserts something about the combination, so no
 *   one source is *the* type of the result;
 * - a computed arrow has no source to compare.
 *
 * An arrow naming the path on *both* ends is why the mutation skips a candidate
 * rather than predicting it: the two ends would then agree again and the mutation
 * would be vacuous for that arrow.
 */
export function retypeBareArrowTarget(workspace) {
  const kind = "retype-bare-arrow-target";

  for (const { file, schema } of workspaceSchemas(workspace)) {
    for (const field of ownScalarFields(schema)) {
      if (field.type !== undefined) continue; // Already typed: not the default domain.
      const retyped = { schema: authoredRefOf(schema), path: field.name };

      const bare = allArrows(workspace).filter(
        ({ arrow }) =>
          arrow.kind === "map" && arrow.transform === undefined && arrow.sources.length === 1,
      );
      const affected = bare.filter(
        ({ arrow }) =>
          endpointsOf(arrow).filter(({ endpoint }) => sameEndpoint(endpoint, retyped)).length === 1,
      );
      const selfReferential = bare.some(
        ({ arrow }) =>
          endpointsOf(arrow).filter(({ endpoint }) => sameEndpoint(endpoint, retyped)).length > 1,
      );
      if (affected.length === 0 || selfReferential) continue;

      const mutated = clone(workspace);
      const declaration = mutated.files
        .find((candidate) => candidate.path === file)
        .schemas.find((candidate) => candidate.name === schema.name)
        .fields.find((candidate) => candidate.name === field.name);
      declaration.type = MISMATCHED_TYPE;

      return finishDefect({
        workspace: mutated,
        kind,
        target: `${retyped.schema}.${retyped.path}`,
        expected: affected.map(({ file: arrowFile, mapping }) =>
          predict({
            rule: DIAGNOSTIC_RULES.typeMismatchDirectArrow,
            file: arrowFile,
            // The message quotes both ends as `schemaId.localPath`, so the
            // retyped end is named with its own schema whatever the arrow wrote.
            entity: `${retyped.schema}.${retyped.path}`,
            surfaces: [LINT],
            locator: mappingLocator(mapping),
          }),
        ),
      });
    }
  }

  return mutationNotApplicable(
    kind,
    "no untyped top-level scalar field is named by exactly one end of a bare, " +
      "single-source arrow",
  );
}

// ── Defect 9: absorb a constraint flag into type arguments ─────────────────

/**
 * The type text a constraint-absorbing mutation writes.
 *
 * `pk` inside the parentheses is the mistake `sl-vryu` is about: the grammar reads
 * parentheses attached to a type name as type *arguments*, so the constraint
 * silently vanishes from extraction. The base token stays `STRING`, which is what
 * keeps `type-mismatch-direct-arrow` out of the predicted set — it compares base
 * tokens, and `STRING(pk)` and `STRING` share one.
 */
const CONSTRAINT_IN_TYPE_ARGS = "STRING(pk)";

/** Retype a scalar field so a constraint flag is lexed as a type argument. */
export function absorbConstraintIntoTypeArgs(workspace) {
  const kind = "absorb-constraint-into-type-args";
  const host = workspaceSchemas(workspace).find(({ schema }) =>
    ownScalarFields(schema).some((field) => field.type === undefined),
  );
  if (host === undefined) {
    return mutationNotApplicable(kind, "no schema declares an untyped top-level scalar field");
  }

  const field = ownScalarFields(host.schema).find((candidate) => candidate.type === undefined);
  const mutated = clone(workspace);
  mutated.files
    .find((candidate) => candidate.path === host.file)
    .schemas.find((candidate) => candidate.name === host.schema.name)
    .fields.find((candidate) => candidate.name === field.name).type = CONSTRAINT_IN_TYPE_ARGS;

  return finishDefect({
    workspace: mutated,
    kind,
    target: `${authoredRefOf(host.schema)}.${field.name}`,
    expected: [
      predict({
        rule: DIAGNOSTIC_RULES.constraintInTypeArgs,
        file: host.file,
        // "Field 'field_0' in 's0' has constraint 'pk' inside type arguments …"
        entity: field.name,
        surfaces: [VALIDATE],
        locator: `${field.name} ${CONSTRAINT_IN_TYPE_ARGS}`,
      }),
    ],
  });
}

// ── Defect 10: conflicting namespace-level metadata ────────────────────────

/** The two `note` values a namespace-conflict mutation writes. They must differ. */
const NAMESPACE_NOTES = ["Owned by the ingest team.", "Owned by the reporting team."];

/**
 * Reopen one namespace in two files with a different `note` in each.
 *
 * A namespace block may be reopened across files and the index merges their
 * metadata, so two files disagreeing about the same tag is a genuine conflict —
 * `lnd-qqo7` and `sl-padl` are both from this neighbourhood. The mutation
 * normalises the layout with {@link splitWorkspaceAcrossFiles} first (a null
 * mutation), because that is what puts one namespace's declarations in more than
 * one file: schemas move to files of their own while namespaced mappings stay in
 * the entry.
 */
export function conflictNamespaceNote(workspace) {
  const kind = "conflict-namespace-note";
  const split = splitWorkspaceAcrossFiles(workspace);

  const filesByNamespace = new Map();
  for (const file of split.files) {
    for (const decl of [...file.schemas, ...file.mappings]) {
      if (decl.namespace === null) continue;
      const paths = filesByNamespace.get(decl.namespace) ?? [];
      if (!paths.includes(file.path)) paths.push(file.path);
      filesByNamespace.set(decl.namespace, paths);
    }
  }
  const conflicted = [...filesByNamespace.entries()].find(([, paths]) => paths.length >= 2);
  if (conflicted === undefined) {
    return mutationNotApplicable(
      kind,
      "no namespace is opened by two files, so there is nowhere for two values of " +
        "one tag to disagree",
    );
  }

  const [namespace, [firstPath, secondPath]] = conflicted;
  const mutated = scenarioWorkspace(split.files.map((file) => structuredClone(file)));
  for (const [index, path] of [firstPath, secondPath].entries()) {
    const file = mutated.files.find((candidate) => candidate.path === path);
    file.namespaceNotes = { ...(file.namespaceNotes ?? {}), [namespace]: NAMESPACE_NOTES[index] };
  }

  return finishDefect({
    workspace: mutated,
    kind,
    target: namespace,
    expected: [
      predict({
        rule: DIAGNOSTIC_RULES.namespaceMetadataConflict,
        // Reported against the declaration the loader reaches second.
        file: laterLoaded(mutated, firstPath, secondPath),
        entity: namespace,
        surfaces: [VALIDATE],
        locator: `namespace ${namespace}`,
      }),
    ],
  });
}

// ── Defect 11: an arrow onto a record that enumerates nothing ──────────────

/** The scalar source field this mutation adds when the source schema has none. */
const RECORD_TARGET_SOURCE_FIELD = "mutator_scalar_source";

/**
 * Add a bare arrow from a scalar onto a record field.
 *
 * `unenumerated-record-target` is the sixth lint rule and the only one no other
 * mutation here reaches. It fires on a `map` arrow whose target is a container,
 * whose sources contain no container, and whose body lists no child arrows — so
 * a scalar-to-record arrow is the smallest shape that reaches it.
 *
 * The arrow carries an NL body deliberately. Without one it would *also* connect
 * `STRING` to `record` and so raise `type-mismatch-direct-arrow`; a transform body
 * classifies the arrow `nl`, which that rule exempts, leaving the predicted set at
 * exactly one diagnostic.
 *
 * **The target schema must declare no fragment spread.** The rule resolves what a
 * path names through `endpointKind`, which skips any schema whose `hasSpreads` is
 * set — not merely one whose spreads failed to resolve, which is what its comment
 * describes. So a spread-bearing target silences the rule today, and a mutation
 * that predicted a diagnostic there would fail against current behaviour for a
 * reason that has nothing to do with the mutation. Declining is the honest move;
 * the gap itself is filed as `gpt-i1uv`, proved with a differential pair of
 * mappings whose arrows are identical and whose targets differ only by a resolved
 * spread. When that is fixed, this precondition can be dropped.
 *
 * When the source schema declares no top-level scalar — a container workspace
 * declares only its record — the mutation adds one. An unmapped extra source field
 * is invisible to every diagnostic (it is a coverage question, not a validity one),
 * so it enlarges the shape the mutation needs without enlarging the prediction.
 */
export function targetRecordWithoutChildren(workspace) {
  const kind = "target-record-without-children";

  for (const { file, mapping } of workspaceMappings(workspace)) {
    if (mapping.sources.length !== 1 || mapping.targets.length !== 1) continue;
    const source = workspaceSchemas(workspace).find(
      ({ schema }) => authoredRefOf(schema) === mapping.sources[0],
    );
    const target = workspaceSchemas(workspace).find(
      ({ schema }) => authoredRefOf(schema) === mapping.targets[0],
    );
    if (source === undefined || target === undefined) continue;
    if ((target.schema.spreads ?? []).length > 0) continue;

    const record = ownRecordFields(target.schema)[0];
    if (record === undefined) continue;
    const scalarName = ownScalarFields(source.schema)[0]?.name ?? RECORD_TARGET_SOURCE_FIELD;

    const mutated = clone(workspace);
    if (ownScalarFields(source.schema).length === 0) {
      mutated.files
        .find((candidate) => candidate.path === source.file)
        .schemas.find((candidate) => candidate.name === source.schema.name)
        .fields.push(scalarField(scalarName));
    }
    mutated.files
      .find((candidate) => candidate.path === file)
      .mappings.find((candidate) => candidate.name === mapping.name)
      .arrows.push(
        mapArrow(
          [endpoint(mapping.sources[0], scalarName)],
          endpoint(mapping.targets[0], record.name),
          nlTransform("Populated wholesale."),
        ),
      );

    return finishDefect({
      workspace: mutated,
      kind,
      target: `${mapping.targets[0]}.${record.name}`,
      expected: [
        predict({
          rule: DIAGNOSTIC_RULES.unenumeratedRecordTarget,
          file,
          // "Arrow 'field_0 -> group_0' targets a record …" — quoted as authored.
          entity: authoredEndpoint(
            { schema: mapping.targets[0], path: record.name },
            mapping.targets,
          ),
          surfaces: [LINT],
          locator: mappingLocator(mapping),
        }),
      ],
    });
  }

  return mutationNotApplicable(
    kind,
    "no mapping has a single source declaring a top-level scalar and a single, " +
      "spread-free target declaring a top-level record",
  );
}

// ── Null mutators: changes that must add no diagnostic ─────────────────────
//
// A null mutator is a defect mutator whose predicted set is empty, which is what
// lets a consumer drive both kinds through one comparison. Each one returns
// `applicable: false` when it would leave the rendered source untouched: a
// transformation that changed nothing would satisfy "the diagnostics did not
// change" for free, and a property that passes for free is worse than none.
//
// `reformat` is deliberately absent. Reformatting is a transformation of *source
// text*, not of a scenario, so it cannot be expressed as a workspace-to-workspace
// function; it belongs to the consumer that has the formatter (R7, gpt-h0dc).

/** Wrap a workspace-to-workspace transformation as a null mutation. */
function nullMutation(kind, workspace, mutated, target) {
  const before = renderWorkspace(workspace);
  const after = renderWorkspace(mutated);
  const changed =
    before.length !== after.length ||
    before.some((file, index) => file.path !== after[index].path) ||
    before.some((file, index) => file.source !== after[index].source);
  if (!changed) {
    return mutationNotApplicable(kind, "the transformation leaves the rendered source identical");
  }
  return { applicable: true, workspace: mutated, mutation: { kind, target }, expected: [] };
}

/**
 * Reverse every file's declaration order.
 *
 * Reversal rather than a random permutation because a null mutator takes no
 * randomness: a property that needs a *generated* reordering already has
 * `workspacePermutationsArbitrary`. Reversal is the strongest fixed permutation —
 * it inverts every pairwise ordering, so an implementation that depended on "the
 * first schema declared" cannot survive it.
 */
export function reverseDeclarationOrder(workspace) {
  const reversedIndices = (count) => Array.from({ length: count }, (_, index) => count - 1 - index);
  const mutated = permuteWorkspaceDeclarations(
    workspace,
    workspace.files.map((file) => ({
      schemas: reversedIndices(file.schemas.length),
      mappings: reversedIndices(file.mappings.length),
    })),
  );
  return nullMutation("reverse-declaration-order", workspace, mutated, "every file");
}

/**
 * Redistribute the same declarations across more files.
 *
 * Promotes {@link splitWorkspaceAcrossFiles} from "the edge set is stable" to
 * "the diagnostic set is stable" — the claim that matters for `sl-rw3e`, where a
 * name clash was reported at one site and not the other.
 */
export function splitAcrossFiles(workspace) {
  return nullMutation(
    "split-across-files",
    workspace,
    splitWorkspaceAcrossFiles(workspace),
    "one file per schema",
  );
}

/**
 * Rename one schema, and every reference to it, everywhere.
 *
 * A consistent rename changes every occurrence of the name and nothing else, so
 * the workspace still validates clean and its edge set is identical *modulo the
 * rename* — which is the invariant R4's rename round-trip is built on. References
 * live in five places, and missing any one of them would make this mutation a
 * defect rather than a null: mapping source and target lists, arrow endpoints, NL
 * `@ref`s, and metric `source` tokens.
 */
export function renameEntityConsistently(workspace) {
  const kind = "rename-entity-consistently";
  const first = workspaceSchemas(workspace)[0];
  if (first === undefined) {
    return mutationNotApplicable(kind, "the workspace declares no schema to rename");
  }

  const oldRef = authoredRefOf(first.schema);
  const newName = freshName(workspace, `${first.schema.name}_renamed`);
  const newRef = first.schema.namespace ? `${first.schema.namespace}::${newName}` : newName;
  const rewrite = (ref) => (ref === oldRef ? newRef : ref);

  const mutated = clone(workspace);
  for (const file of mutated.files) {
    for (const schema of file.schemas) {
      if (authoredRefOf(schema) === oldRef) schema.name = newName;
      schema.metricSources = (schema.metricSources ?? []).map(rewrite);
      if (schema.metricSources.length === 0) delete schema.metricSources;
    }
    for (const mapping of file.mappings) {
      mapping.sources = mapping.sources.map(rewrite);
      mapping.targets = mapping.targets.map(rewrite);
      for (const arrow of flattenArrows(mapping.arrows)) {
        for (const { endpoint } of endpointsOf(arrow)) endpoint.schema = rewrite(endpoint.schema);
        for (const ref of arrow.transform?.refs ?? []) ref.schema = rewrite(ref.schema);
      }
    }
  }

  return nullMutation(kind, workspace, mutated, `${oldRef} → ${newRef}`);
}

// ── Registries ─────────────────────────────────────────────────────────────

/**
 * Every defect mutator, as `{ kind, mutate }`.
 *
 * A property loops over this so that adding a mutator extends the property's
 * reach without editing the property — the same reason the lint engine has a rule
 * registry. `kind` matches the `mutation.kind` the mutator reports.
 */
export const DEFECT_MUTATORS = Object.freeze([
  { kind: "delete-mapped-field", mutate: deleteMappedField },
  { kind: "duplicate-entity-within-file", mutate: duplicateEntityWithinFile },
  { kind: "duplicate-entity-across-files", mutate: duplicateEntityAcrossFiles },
  { kind: "withhold-spread-import", mutate: withholdSpreadImport },
  { kind: "reference-undefined-entity", mutate: referenceUndefinedEntity },
  { kind: "break-nl-ref-target", mutate: breakNlRefTarget },
  { kind: "point-nl-ref-outside-source-list", mutate: pointNlRefOutsideSourceList },
  { kind: "close-lineage-cycle", mutate: closeLineageCycle },
  { kind: "retype-bare-arrow-target", mutate: retypeBareArrowTarget },
  { kind: "absorb-constraint-into-type-args", mutate: absorbConstraintIntoTypeArgs },
  { kind: "conflict-namespace-note", mutate: conflictNamespaceNote },
  { kind: "target-record-without-children", mutate: targetRecordWithoutChildren },
]);

/**
 * Every null mutator, as `{ kind, mutate }`.
 *
 * Same shape as {@link DEFECT_MUTATORS} and the same return contract, with an
 * empty `expected`: these transformations preserve meaning, so they must add no
 * diagnostic at all.
 */
export const NULL_MUTATORS = Object.freeze([
  { kind: "reverse-declaration-order", mutate: reverseDeclarationOrder },
  { kind: "split-across-files", mutate: splitAcrossFiles },
  { kind: "rename-entity-consistently", mutate: renameEntityConsistently },
]);
