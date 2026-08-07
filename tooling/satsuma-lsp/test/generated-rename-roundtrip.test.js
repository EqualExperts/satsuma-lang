/**
 * generated-rename-roundtrip.test.js — rename, proved by applying it.
 *
 * Rename is the only LSP feature that *writes*, and the only one whose failure
 * mode is silent: a rename that misses an occurrence leaves a workspace that
 * still parses, still opens, and is wrong. Every other provider fails visibly —
 * a missing reference is a missing entry in a list a reader is looking at.
 *
 * Until now it was proved by fixtures, which check that the edit *set* looks
 * right. This file proves the round trip instead: compute the edit, apply it to
 * the documents, re-index the result, and ask whether the workspace survived.
 *
 * ## Which index this asks, and why that is the first thing stated
 *
 * Every property below computes the rename against the **whole-folder index** —
 * the state a client establishes by opening a folder — and *not* against
 * `server.ts`'s per-request `scopeIndex(uri)`.
 *
 * That is a deliberate choice, not an accident, and it is worth being blunt
 * about: the two disagree. Import reachability points one way, from an importing
 * file to what it imports, so a rename driven from a declaration in a downstream
 * file cannot see the upstream files that import it. `gpt-bc1x` is that bug, and
 * the pinned test at the end of this file measures it rather than describing it.
 *
 * So these properties state what a correct rename must achieve, and the pin
 * states what today's server achieves. The day `gpt-bc1x` is fixed, the pin turns
 * red and the properties move onto the scoped index unchanged. Asserting the
 * round trip against the scoped index today would have made this whole file fail
 * for one known reason, which is a worse way to record one known reason.
 *
 * ## The four things a round trip has to check
 *
 * A property that only checked "the new name appears everywhere the old one did"
 * would pass on a rename that also rewrote a *different* entity's name, so all
 * four of these are asserted:
 *
 * 1. the workspace still validates clean;
 * 2. every entity's usage sites are what the scenario declares, with the renamed
 *    key swapped — the edge set, identical modulo the rename;
 * 3. no reference to the old name survives anywhere;
 * 4. no *unrelated* entity's usage sites changed. This is the half a naive
 *    property omits.
 *
 * Ground truth is `@satsuma/scenario-gen`'s `scenarioDeclaredUsageSites`, which
 * reads scenario data only. Nothing here derives an expectation by asking the
 * LSP what it did.
 *
 * ## gpt-fjo7: fixed for the schema; a field rename is a separate question
 *
 * Renaming a schema rewrites the schema segment of every NL `@ref` naming one
 * of its fields (`@s0.field_1` → `@renamed_s0.field_1`): the index now files
 * that ref under the schema key too, not only under the field path it names,
 * so `findReferences`/rename for the schema reach it. `entitiesMentionedByNlRefs`
 * used to compute an exclusion for this; it is kept below only as the
 * vocabulary the two gpt-68ka/gpt-bc1x pins still need.
 *
 * Renaming the FIELD an `@ref` names (rather than the schema) is a different
 * question this ticket does not attempt: `prepareRename`'s renameable-context
 * set has no `field_name` case, so the LSP does not offer to rename a field at
 * all today, through any path. Whether an NL `@ref` should follow a future
 * field rename is therefore out of scope here, not fixed.
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const {
  GENERATED_PROPERTY_PARAMETERS,
  bareNamespacedWorkspaceArbitrary,
  endpoint,
  mapArrow,
  mappingDecl,
  multiFileWorkspaceArbitrary,
  nlTransform,
  scalarField,
  scenarioDeclaredEntities,
  scenarioDeclaredUsageSites,
  scenarioFile,
  scenarioWorkspace,
  schemaDecl,
  workspaceScenarioArbitrary,
} = require("@satsuma/scenario-gen");
const { initTestParser } = require("./helper");
const {
  applyWorkspaceEdit,
  declarationSite,
  findReferenceSites,
  indexGeneratedWorkspace,
  indexRenderedFiles,
  indexedReferenceSites,
  renameEdit,
  renameEditInImportScope,
  semanticProblems,
} = require("./support/generated-workspace");

before(async () => {
  await initTestParser();
});

// ── Vocabulary ─────────────────────────────────────────────────────────────

/**
 * The name every rename in this file renames *to*.
 *
 * Prefixed rather than generated: the fresh-name choice belongs to the property
 * (Feature 46 PRD), a collision is a separate case with its own test below, and
 * a name derived from the old one makes a failure message readable. No generated
 * entity name starts with this, so the result cannot collide with a sibling.
 */
const RENAMED_PREFIX = "renamed_";

/** Compact `kind@file` form, sorted — the identity a usage site is compared by. */
function siteLabels(sites) {
  return sites.map((site) => `${site.kind}@${site.file}`).sort();
}

/**
 * Every entity of a workspace that this suite renames, with its ground truth.
 *
 * Used to exclude entities an NL `@ref` mentions, back when renaming such an
 * entity left the `@ref` dangling (`gpt-fjo7`); now that the fix files the
 * `@ref` under the schema key too, no exclusion is needed and every declared
 * entity is fair game. Still asserts the entity list is non-empty: a sample
 * with nothing to rename would let every property below pass without doing
 * anything.
 */
function renameableEntities(workspace, indexed) {
  const entities = scenarioDeclaredEntities(workspace);
  assert.ok(entities.length > 0, `the workspace declares nothing to rename:\n${indexed.sources}`);
  return entities;
}

/**
 * Rename one entity from its declaration and re-index the edited documents.
 *
 * @returns {{ newName: string, edited: object, edit: object }} `edited` is the
 *   re-indexed workspace, ready to be asked the same questions as the original.
 */
function renameFromDeclaration(indexed, entity) {
  const newName = `${RENAMED_PREFIX}${entity.name}`;
  const position = declarationSite(indexed, entity);
  const edit = renameEdit(indexed, position, newName);
  assert.notEqual(
    edit,
    null,
    `rename refused to rename ${entity.keyword} '${entity.name}' to '${newName}', ` +
      `which is a fresh name:\n${indexed.sources}`,
  );
  return { newName, edit, edited: indexRenderedFiles(applyWorkspaceEdit(indexed, edit)) };
}

/** The entity as it should exist after the rename — same everything but the name. */
function renamedEntity(entity, newName) {
  return {
    ...entity,
    name: newName,
    key: entity.namespace ? `${entity.namespace}::${newName}` : newName,
  };
}

// ── The round trip ─────────────────────────────────────────────────────────

/**
 * Rename every entity of a workspace in turn, asserting all four properties of
 * the round trip on each. Written as one walk because the four share the edit:
 * applying it three more times to assert them separately would treble the cost
 * and prove nothing extra.
 */
function assertRenameRoundTrip(workspace) {
  const indexed = indexGeneratedWorkspace(workspace);
  assert.equal(
    indexed.parseErrorCount,
    0,
    `the generated workspace does not parse:\n${indexed.sources}`,
  );

  const entities = renameableEntities(workspace, indexed);
  const declared = scenarioDeclaredUsageSites(workspace);

  for (const entity of entities) {
    const { newName, edited } = renameFromDeclaration(indexed, entity);
    const context = `renaming ${entity.keyword} '${entity.name}' to '${newName}'`;

    // 1. The workspace still validates clean.
    assert.deepEqual(
      semanticProblems(edited),
      [],
      `${context} broke the workspace:\n${edited.sources}`,
    );
    assert.equal(
      edited.parseErrorCount,
      0,
      `${context} produced unparseable Satsuma:\n${edited.sources}`,
    );

    // 2 and 4. Every entity's usage sites are what the scenario declares, with
    // the renamed key swapped — the renamed entity keeps exactly the sites it
    // had, and every other entity keeps exactly its own. Asserted in one pass
    // because "an unrelated entity changed" and "the renamed entity lost a site"
    // are the same comparison against different keys.
    for (const other of entities) {
      const after = other.key === entity.key ? renamedEntity(entity, newName) : other;
      const observed = findReferenceSites(edited, after.key, declarationSite(edited, after));
      assert.deepEqual(
        siteLabels(observed),
        siteLabels(declared.get(other.key)),
        `${context} changed the usage sites of '${other.name}':\n${edited.sources}`,
      );
    }

    // 3. No reference to the old name survives, under any key the index files.
    const survivors = indexedReferenceSites(edited).filter(
      (site) => site.key === entity.key || site.text === entity.name,
    );
    assert.deepEqual(
      survivors.map((site) => `${site.kind}@${site.file}:${site.line + 1} '${site.text}'`),
      [],
      `${context} left references to the old name behind:\n${edited.sources}`,
    );
  }
}

describe("rename round-trip over generated workspaces", () => {
  // Why this case exists: the whole-workspace guarantee. Over the shared domain
  // — chains, diamonds, containers, spreads, metrics, multi-file, namespaces —
  // renaming any entity must leave a workspace that still validates, whose
  // reference structure is what it was, and which mentions the old name nowhere.
  it("preserves the workspace over every axis of the shared domain", () => {
    fc.assert(
      fc.property(workspaceScenarioArbitrary, assertRenameRoundTrip),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  // Why this case exists: the cross-file half is the one a fixture author is
  // least likely to have written and the one `gpt-bc1x` is about. Named
  // separately from the shared domain so a counterexample is guaranteed to be a
  // multi-file workspace rather than whatever the uniform draw happened to pick.
  it("rewrites the import declaration in every file that imports the renamed entity", () => {
    fc.assert(
      fc.property(multiFileWorkspaceArbitrary, (drawn) =>
        assertRenameRoundTrip(drawn.workspace ?? drawn),
      ),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  // Why this case exists: inside a namespace a bare `source { s0 }` binds to
  // `ns_a::s0`, so the key a rename must query is not the text at the cursor.
  // Renaming on the wrong key rewrites nothing, or rewrites a same-named entity
  // in another namespace — which is `sl-p256` in its writing form.
  it("renames by the key a bare reference binds to, not by the text at the cursor", () => {
    fc.assert(
      fc.property(bareNamespacedWorkspaceArbitrary, assertRenameRoundTrip),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

// ── The collision case, which is not part of the round trip ────────────────

describe("rename onto a name the workspace already declares", () => {
  // Why this case exists: the PRD is explicit that renaming onto an existing
  // name is a legitimate collision the editor may reject rather than a
  // round-trip failure, so the fresh-name choice belongs to the property. This
  // is the other half of that decision: the refusal has to actually happen, or
  // every round-trip property above is one careless fresh-name change away from
  // silently merging two entities.
  it("refuses rather than merging two entities of the same namespace", () => {
    let collisionsTried = 0;

    fc.assert(
      fc.property(workspaceScenarioArbitrary, (workspace) => {
        const indexed = indexGeneratedWorkspace(workspace);
        const schemas = scenarioDeclaredEntities(workspace).filter(
          (entity) => entity.keyword === "schema",
        );

        // The collision has to be within one namespace. A file-scope `staged`
        // and a `warehouse::staged` are two *different* entities, so renaming
        // `raw` to `staged` beside a `warehouse::staged` is legal and the server
        // rightly allows it — that near-miss is what a first draft of this case
        // asserted, wrongly.
        const victim = schemas.find((entity) =>
          schemas.some((other) => other.key !== entity.key && other.namespace === entity.namespace),
        );
        if (victim === undefined) return;
        const rival = schemas.find(
          (other) => other.key !== victim.key && other.namespace === victim.namespace,
        );
        collisionsTried += 1;

        const edit = renameEdit(indexed, declarationSite(indexed, victim), rival.name);
        assert.equal(
          edit,
          null,
          `renaming '${victim.key}' onto '${rival.key}', which the same namespace ` +
            `already declares, produced an edit instead of a refusal:\n${indexed.sources}`,
        );
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );

    assert.ok(
      collisionsTried > 0,
      "no sample declared two schemas in one namespace, so no collision was ever tried",
    );
  });
});

// ── A fixed gap, kept as a concrete regression case ─────────────────────────
//
// This is the exact repro from gpt-fjo7's ticket. The generated properties
// above now cover the same fix generically (`nlRefWorkspaceArbitrary` is part
// of `workspaceScenarioArbitrary`, and `renameableEntities` no longer excludes
// anything), but a minimal, readable case survives as its own test so a
// regression here fails with a small, specific diff rather than only a fuzzed
// counterexample.

describe("gpt-fjo7: rename rewrites the schema segment of an NL @ref naming its field", () => {
  it("turns @s0.field_1 into @renamed_s0.field_1 instead of leaving it dangling", () => {
    const workspace = scenarioWorkspace([
      scenarioFile({
        path: "entry.stm",
        schemas: ["s0", "s1"].map((name) =>
          schemaDecl({ name, fields: [scalarField("field_0"), scalarField("field_1")] }),
        ),
        mappings: [
          mappingDecl({
            name: "m0",
            sources: ["s0"],
            targets: ["s1"],
            arrows: [
              mapArrow(
                [endpoint("s0", "field_0")],
                endpoint("s1", "field_0"),
                nlTransform("Normalise.", [endpoint("s0", "field_1")]),
              ),
            ],
          }),
        ],
      }),
    ]);

    const indexed = indexGeneratedWorkspace(workspace);
    const entity = { file: "entry.stm", name: "s0", keyword: "schema", key: "s0", namespace: null };
    const { edited } = renameFromDeclaration(indexed, entity);

    // The declaration and the `source { }` entry are rewritten, as before...
    assert.ok(edited.sources.includes("schema renamed_s0"), edited.sources);
    assert.ok(edited.sources.includes("source { renamed_s0 }"), edited.sources);
    // ...and now so is the @ref's schema segment, leaving the field part
    // ("field_1") untouched: renaming a FIELD is a separate concern this
    // ticket does not attempt (see this file's header).
    assert.ok(edited.sources.includes("@renamed_s0.field_1"), edited.sources);
    assert.ok(!edited.sources.includes("@s0.field_1"), edited.sources);
    assert.deepEqual(semanticProblems(edited), []);
  });
});

describe("known gap: a rename in import scope misses its upstream files (gpt-bc1x)", () => {
  // Why this case exists: the properties above compute their rename against the
  // whole-folder index, and this is the measurement that justifies saying so out
  // loud. Import reachability points from an importing file to what it imports,
  // so renaming from a declaration in a downstream file cannot reach the entry
  // file that imports it — and the edit the real server sends is strictly
  // smaller than the one the workspace needs.
  it("produces fewer edits than the whole-folder index for a downstream declaration", () => {
    const workspace = scenarioWorkspace([
      scenarioFile({
        path: "entry.stm",
        schemas: [schemaDecl({ name: "s1", fields: [scalarField("field_0")] })],
        mappings: [
          mappingDecl({
            name: "m0",
            sources: ["s0"],
            targets: ["s1"],
            arrows: [mapArrow([endpoint("s0", "field_0")], endpoint("s1", "field_0"))],
          }),
        ],
      }),
      scenarioFile({
        path: "part1.stm",
        schemas: [schemaDecl({ name: "s0", fields: [scalarField("field_0")] })],
        mappings: [],
      }),
    ]);

    const indexed = indexGeneratedWorkspace(workspace);
    // `s0` is declared in part1.stm and used from entry.stm, which imports it.
    const position = declarationSite(indexed, {
      file: "part1.stm",
      name: "s0",
      keyword: "schema",
    });
    const editCount = (edit) => Object.values(edit?.changes ?? {}).flat().length;

    const wholeFolder = renameEdit(indexed, position, "renamed_s0");
    const importScoped = renameEditInImportScope(indexed, position, "renamed_s0");

    assert.ok(editCount(wholeFolder) > editCount(importScoped), indexed.sources);

    // And the consequence, spelled out: applying what the server would actually
    // send leaves entry.stm importing and using a schema nothing declares.
    const edited = indexRenderedFiles(applyWorkspaceEdit(indexed, importScoped));
    assert.ok(edited.sources.includes("schema renamed_s0"), edited.sources);
    assert.ok(edited.sources.includes('import { s0 } from "./part1.stm"'), edited.sources);
  });
});
