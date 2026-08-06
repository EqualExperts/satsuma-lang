/**
 * generated-reference-duality.test.js — find-references, go-to-definition and
 * the inverse relation between them, over generated workspaces.
 *
 * The LSP's 26 other test files are fixture-driven: someone wrote the Satsuma,
 * then wrote down the answer. That finds the cases the author thought of, which
 * is why the bug history here is full of shapes nobody thought of — a bare name
 * inside a namespace that shadows a global one (`sl-p256`), a reference range
 * that swallowed the surrounding path (`sl-xf3f`), a spread whose `...` sigil was
 * part of the range (`sl-kf1r`).
 *
 * These properties need no new oracle, which is the reason this is the LSP's
 * first generated suite. A generated workspace *declares* its entities and names
 * every place it uses them, so the answer is already stated by the input:
 *
 * - `references(declaration)` must be exactly the usage sites the scenario
 *   declares — no fewer (a reference the editor cannot find) and no more (a
 *   reference it invented).
 * - `definition(usage)` must be the declaration, for every usage.
 * - The two must be inverses: `x ∈ references(d)` exactly when
 *   `definition(x) = d`.
 * - `includeDeclaration` must toggle exactly the declaration site and nothing
 *   else.
 *
 * Ground truth comes from `support/scenario-usage-sites.js`, which reads scenario
 * data only. Nothing below derives an expectation by asking the LSP.
 *
 * Every property here asks the **whole-folder index**, which is the state a
 * client establishes by opening a folder, and not `server.ts`'s per-request
 * `scopeIndex(uri)`. The scoping layer changes the answer, so it is a question of
 * its own — see the last pinned test.
 *
 * ## Four gaps this suite pins rather than hides
 *
 * `go-to-definition` answers nothing at a metric `source` token, nothing at the
 * schema prefix of a qualified arrow path, and nothing at all at a `namespace`
 * name; and import scope drops every usage in a file the declaring file does not
 * itself import. Each is a real gap and each has a pinned test at the end of this
 * file, so the properties above can exclude them by name instead of quietly
 * narrowing.
 */

const { describe, it, before } = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const {
  GENERATED_PROPERTY_PARAMETERS,
  endpoint,
  leafNames,
  mapArrow,
  mappingDecl,
  metricWorkspaceArbitrary,
  multiFileWorkspaceArbitrary,
  multiSourceWorkspaceArbitrary,
  namespacedWorkspaceArbitrary,
  scalarField,
  scenarioFile,
  scenarioWorkspace,
  schemaDecl,
  workspaceScenarioArbitrary,
} = require("@satsuma/scenario-gen");
const { initTestParser } = require("./helper");
const {
  declarationSite,
  definitionSites,
  findReferenceSites,
  findReferenceSitesInImportScope,
  indexGeneratedWorkspace,
  indexedReferenceSites,
} = require("./support/generated-workspace");
const {
  RESOLVABLE_USAGE_KINDS,
  USAGE_KIND,
  declaredEntities,
  declaredUsageSites,
  entityKeyForRef,
} = require("./support/scenario-usage-sites");

before(async () => {
  await initTestParser();
});

// ── Comparison vocabulary ──────────────────────────────────────────────────

/**
 * A usage site as compared against the scenario's ground truth: which file, and
 * what kind of use.
 *
 * The line and column are deliberately excluded. They are a function of the
 * renderer's layout, which `@satsuma/scenario-gen` owns and is free to change,
 * so asserting them would couple these properties to text formatting rather
 * than to reference semantics. Position identity is still checked, by
 * {@link positionLabel} for set membership and by each site's covered text.
 */
function usageLabel(site) {
  return `${site.file} ${site.kind}`;
}

/** Identity of a position, for set membership and set difference. */
function positionLabel(position) {
  return `${position.uri}:${position.line}:${position.character}`;
}

/** One site as a reader can find it: path, position, the text covered, and its kind. */
function describeSite(site) {
  return `${site.file}:${site.line}:${site.character} "${site.text}" (${site.kind})`;
}

/** Every site of a list, printable, for a failure message. */
function describeSites(sites) {
  return sites.length > 0 ? sites.map(describeSite).join(", ") : "none";
}

/**
 * Index a generated workspace beside the ground truth it states about itself.
 *
 * Two preconditions are asserted here rather than assumed, because both would
 * otherwise turn a property into one that passes without checking anything: the
 * workspace must parse cleanly, and it must reference at least one entity.
 */
function indexWithGroundTruth(workspace) {
  const indexed = indexGeneratedWorkspace(workspace);
  assert.equal(
    indexed.parseErrorCount,
    0,
    `generated workspace does not parse cleanly:\n${indexed.sources}`,
  );

  const entities = declaredEntities(workspace);
  const expected = declaredUsageSites(workspace);
  const siteCount = [...expected.values()].reduce((total, sites) => total + sites.length, 0);
  assert.ok(
    siteCount > 0,
    `the workspace declares no usage site, so there is nothing to check:\n${indexed.sources}`,
  );

  return { indexed, entities, expected };
}

// ── A domain where the reference key is not the authored spelling ───────────

/**
 * A chain of schemas inside one namespace, every reference authored **bare**.
 *
 * `namespacedWorkspaceArbitrary` always writes a namespaced reference out in
 * full (`ns_a::s0`), so the reference key and the authored spelling coincide and
 * a query that used the spelling directly would still pass. This domain is the
 * shape where they differ: `source { s0 }` inside `namespace ns_a` binds to
 * `ns_a::s0`, which is what `resolveReferenceKey` exists to work out, and what
 * `sl-p256` was.
 *
 * Built here from the generator's constructors rather than added to the shared
 * package: the arbitraries in `@satsuma/scenario-gen` are consumed by other
 * packages' ground truth, which reads an authored ref as canonical, so changing
 * one to author bare refs would silently move their expectations too.
 */
const bareNamespacedWorkspaceArbitrary = fc
  .record({
    namespace: fc.constantFrom("ns_a", "ns_b"),
    /** Hops in the chain; one is enough for a reference, more vary the site count. */
    hops: fc.integer({ min: 1, max: 3 }),
  })
  .map(({ namespace, hops }) => {
    const [leaf] = leafNames(1);
    const schemaNames = Array.from({ length: hops + 1 }, (_, index) => `s${index}`);
    return scenarioWorkspace([
      scenarioFile({
        path: "entry.stm",
        schemas: schemaNames.map((name) =>
          schemaDecl({ name, namespace, fields: [scalarField(leaf)] }),
        ),
        mappings: schemaNames.slice(1).map((target, hop) =>
          mappingDecl({
            name: `m${hop}`,
            namespace,
            // Bare on purpose: the whole point of the domain.
            sources: [schemaNames[hop]],
            targets: [target],
            arrows: [mapArrow([endpoint(schemaNames[hop], leaf)], endpoint(target, leaf))],
          }),
        ),
      }),
    ]);
  });

// ── The four checks, each usable against any domain ────────────────────────

/**
 * `references(declaration)` is exactly the usage sites the scenario declares,
 * for every declared entity — compared as multisets, so a reference reported
 * twice fails as loudly as one not reported at all.
 */
function assertReferencesAreTheDeclaredSites(workspace) {
  const { indexed, entities, expected } = indexWithGroundTruth(workspace);

  for (const entity of entities) {
    const observed = findReferenceSites(indexed, entity.key, declarationSite(indexed, entity));
    assert.deepEqual(
      observed.map(usageLabel).sort(),
      expected.get(entity.key).map(usageLabel).sort(),
      `references for ${entity.keyword} ${entity.key} are not the workspace's declared usage sites` +
        `\nreported: ${describeSites(observed)}\n${indexed.sources}`,
    );
  }
}

/**
 * Every reported reference range covers exactly the entity's own name — the
 * authored spelling at that site, which inside a namespace may be either the
 * bare label or the qualified key.
 *
 * A range that reached one character further either way is the `sl-xf3f` /
 * `sl-kf1r` class: find-references still looks right, and rename then rewrites
 * the `...` sigil, the `@` sigil or a trailing `.field` along with the name.
 */
function assertReferenceRangesCoverOnlyTheName(workspace) {
  const { indexed, entities } = indexWithGroundTruth(workspace);

  for (const entity of entities) {
    const spellings = new Set([entity.name, entity.key]);
    for (const site of findReferenceSites(indexed, entity.key, declarationSite(indexed, entity))) {
      assert.ok(
        spellings.has(site.text),
        `reference range for ${entity.key} covers "${site.text}", not ${[...spellings].join(" or ")}` +
          ` at ${describeSite(site)}\n${indexed.sources}`,
      );
    }
  }
}

/**
 * `definition(usage)` is the declaration, for every usage the index records in a
 * context the definition provider handles.
 *
 * The declaration position comes from the rendered text, not from the index, so
 * this compares the toolchain against the workspace rather than against itself.
 */
function assertDefinitionResolvesEveryUsage(workspace) {
  const { indexed, entities } = indexWithGroundTruth(workspace);
  const keys = new Set(entities.map((entity) => entity.key));
  const byKey = new Map(entities.map((entity) => [entity.key, entity]));

  const probes = resolvableProbeSites(indexed, keys);
  assert.ok(probes.length > 0, `no usage site to resolve:\n${indexed.sources}`);

  for (const { site, entityKey } of probes) {
    const entity = byKey.get(entityKey);
    const expected = declarationSite(indexed, entity);
    const answer = definitionSites(indexed, site);

    assert.deepEqual(
      answer.map(positionLabel),
      [positionLabel(expected)],
      `definition at ${describeSite(site)} is not the declaration of ${entityKey}` +
        `\nanswered: ${describeSites(answer)}\n${indexed.sources}`,
    );
    assert.equal(
      answer[0].text,
      entity.name,
      `definition at ${describeSite(site)} points at "${answer[0].text}", not the label ` +
        `"${entity.name}"\n${indexed.sources}`,
    );
  }
}

/**
 * `x ∈ references(d)` exactly when `definition(x) = d`.
 *
 * Stated as one biconditional over every (site, entity) pair, so both failure
 * directions are caught by the same assertion: a site the definition provider
 * binds to `d` but `references(d)` omits, and a site `references(d)` claims but
 * the definition provider binds elsewhere.
 */
function assertReferenceDefinitionDuality(workspace) {
  const { indexed, entities } = indexWithGroundTruth(workspace);
  const keys = new Set(entities.map((entity) => entity.key));

  const declarationOf = new Map(
    entities.map((entity) => [entity.key, declarationSite(indexed, entity)]),
  );
  const referencesOf = new Map(
    entities.map((entity) => [
      entity.key,
      new Set(
        findReferenceSites(indexed, entity.key, declarationOf.get(entity.key)).map(positionLabel),
      ),
    ]),
  );

  const probes = resolvableProbeSites(indexed, keys);
  assert.ok(probes.length > 0, `no usage site to probe:\n${indexed.sources}`);

  for (const { site } of probes) {
    const answer = definitionSites(indexed, site);
    const declared = entities.filter(
      (entity) =>
        answer.length === 1 &&
        positionLabel(answer[0]) === positionLabel(declarationOf.get(entity.key)),
    );
    // Without this the biconditional could hold vacuously: a provider that
    // answered nothing anywhere would make both sides false for every pair.
    assert.equal(
      declared.length,
      1,
      `definition at ${describeSite(site)} is not exactly one declared entity's declaration` +
        `\nanswered: ${describeSites(answer)}\n${indexed.sources}`,
    );

    const definedEntity = declared[0].key;
    for (const entity of entities) {
      const reported = referencesOf.get(entity.key).has(positionLabel(site));
      const isDefinition = entity.key === definedEntity;
      assert.equal(
        reported,
        isDefinition,
        isDefinition
          ? `${describeSite(site)} resolves to ${entity.key} but is missing from ` +
              `references(${entity.key})\n${indexed.sources}`
          : `references(${entity.key}) reported ${describeSite(site)}, which resolves to ` +
              `${definedEntity}\n${indexed.sources}`,
      );
    }
  }
}

/** `includeDeclaration` adds exactly the declaration site, and removes nothing. */
function assertIncludeDeclarationTogglesOnlyTheDeclaration(workspace) {
  const { indexed, entities } = indexWithGroundTruth(workspace);

  for (const entity of entities) {
    const declaration = declarationSite(indexed, entity);
    const without = findReferenceSites(indexed, entity.key, declaration, false).map(positionLabel);
    const with_ = findReferenceSites(indexed, entity.key, declaration, true).map(positionLabel);

    assert.deepEqual(
      with_.filter((position) => !without.includes(position)).sort(),
      [positionLabel(declaration)],
      `includeDeclaration did not add exactly the declaration of ${entity.key}\n${indexed.sources}`,
    );
    assert.deepEqual(
      without.filter((position) => !with_.includes(position)),
      [],
      `includeDeclaration dropped a reference to ${entity.key}\n${indexed.sources}`,
    );
  }
}

/**
 * The usage sites both providers are expected to agree about: every reference
 * the index recorded, in a context the definition provider handles, that names a
 * declared entity.
 *
 * The probe set comes from the raw index rather than from `findReferences`,
 * deliberately: a query that dropped a site would otherwise also drop the probe
 * that would have caught it, and the property would pass by asking nothing.
 * Field-level entries (`field_0`, `s0.field_0`) are filtered out by the
 * declared-entity test, which is sound because a generated workspace never names
 * a field and an entity alike.
 */
function resolvableProbeSites(indexed, declaredKeys) {
  return indexedReferenceSites(indexed)
    .filter((site) => RESOLVABLE_USAGE_KINDS.includes(site.kind))
    .map((site) => ({ site, entityKey: entityKeyForRef(site.key, site.namespace, declaredKeys) }))
    .filter(({ entityKey }) => declaredKeys.has(entityKey));
}

// ── Properties ─────────────────────────────────────────────────────────────

describe("references(declaration) is exactly the workspace's declared usage sites", () => {
  it("reports every declared usage of every entity, and nothing else, on any generated shape", () => {
    // The general statement, over one axis at a time. A missing site is a
    // reference the editor cannot find; an extra one is a reference it invented,
    // and rename would then rewrite text nothing asked it to.
    fc.assert(
      fc.property(workspaceScenarioArbitrary, assertReferencesAreTheDeclaredSites),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("reports the usages of a namespaced entity written out in full", () => {
    // Stated on the namespace axis so a counterexample is a namespaced workspace
    // rather than whichever shape `oneof` happened to draw. Here the qualified
    // spelling *is* the index key, which is the easy half of namespace handling.
    fc.assert(
      fc.property(
        namespacedWorkspaceArbitrary.map(({ workspace }) => workspace),
        assertReferencesAreTheDeclaredSites,
      ),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("reports the usages of a bare reference that binds to a namespace-local entity (sl-p256)", () => {
    // The hard half: `source { s0 }` inside `namespace ns_a` is a usage of
    // `ns_a::s0`, so a query keyed by the authored spelling finds nothing at all.
    fc.assert(
      fc.property(bareNamespacedWorkspaceArbitrary, assertReferencesAreTheDeclaredSites),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("reports usages in every file, including the import that made them legal", () => {
    // Stated on the multi-file axis: an `import` name is a usage site of its own,
    // and cross-file references are where the LSP's whole-folder index and the
    // CLI's import-graph loader diverge (`sl-rw3e`).
    fc.assert(
      fc.property(
        multiFileWorkspaceArbitrary.map(({ workspace }) => workspace),
        assertReferencesAreTheDeclaredSites,
      ),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("covers exactly the entity's name with every reported range", () => {
    // A range one character wide of the name is invisible in find-references and
    // destructive in rename (`sl-xf3f`, `sl-kf1r`).
    fc.assert(
      fc.property(workspaceScenarioArbitrary, assertReferenceRangesCoverOnlyTheName),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

describe("definition(usage) is the declaration", () => {
  it("resolves every usage site back to the declaring block's label", () => {
    // The inverse direction of the same relation, checked against the position of
    // the declaration in the rendered text rather than against the index.
    fc.assert(
      fc.property(workspaceScenarioArbitrary, assertDefinitionResolvesEveryUsage),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("resolves a bare usage to the namespace-local declaration, not a global one", () => {
    // Same rule, on the shape where the authored spelling alone cannot decide the
    // answer.
    fc.assert(
      fc.property(bareNamespacedWorkspaceArbitrary, assertDefinitionResolvesEveryUsage),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

describe("references and definition are inverses", () => {
  it("puts a usage site in references(d) exactly when definition(site) is d", () => {
    // Rename depends on this: it rewrites `references(d)` after resolving `d`
    // from the cursor, so a site the two providers disagree about is either left
    // stale or rewritten to the wrong name.
    fc.assert(
      fc.property(workspaceScenarioArbitrary, assertReferenceDefinitionDuality),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("holds when the reference key is not the authored spelling (sl-p256)", () => {
    // The duality's sharpest case, and the one the mutation check for this ticket
    // targets: canonicalising a bare name to its namespace-local key is what puts
    // the site in `references(ns_a::s0)` at all.
    fc.assert(
      fc.property(bareNamespacedWorkspaceArbitrary, assertReferenceDefinitionDuality),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

describe("includeDeclaration toggles exactly the declaration site", () => {
  it("adds the declaration and changes nothing else", () => {
    // The flag is a filter, not a different query: it may add the declaration
    // site and it may never alter the reference set around it.
    fc.assert(
      fc.property(workspaceScenarioArbitrary, assertIncludeDeclarationTogglesOnlyTheDeclaration),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});

// ── Pinned gaps ────────────────────────────────────────────────────────────
//
// ⚠️ The four tests below assert what the LSP does **today**, not what it
// should do. They exist because the properties above exclude these usage kinds,
// and an exclusion nobody can see is how a gap becomes permanent. Each will go
// red the moment its gap is fixed — at which point delete the pin and remove the
// exclusion from RESOLVABLE_USAGE_KINDS (or from declaredEntities, for the
// namespace case). All four were found by this suite while implementing gpt-21jp;
// none is endorsed here. They are filed as:
//
//   - `gpt-jwek` — the three go-to-definition gaps (metric `source` token, the
//     schema prefix of a qualified arrow path, a `namespace` name). One cause
//     seen three times: `findNodeContext`'s case list is narrower than what
//     `workspace-index` indexes.
//   - `gpt-bc1x` — the import-scope gap, which is a *rename correctness* bug
//     rather than a navigation one: rename is scoped identically, so renaming
//     from a downstream declaration leaves an upstream import naming a symbol
//     that no longer exists.

describe("gaps these properties therefore exclude", () => {
  it("answers nothing at a metric `source` token, though find-references reports it", () => {
    // `findNodeContext` has no case for a metadata value, so a metric's declared
    // provenance is navigable in one direction only.
    fc.assert(
      fc.property(
        metricWorkspaceArbitrary.map(({ workspace }) => workspace),
        (workspace) => {
          const { indexed } = indexWithGroundTruth(workspace);
          const tokens = indexedReferenceSites(indexed).filter(
            (site) => site.kind === USAGE_KIND.metricSource,
          );
          assert.equal(
            tokens.length,
            1,
            `the metric domain must produce exactly one source token:\n${indexed.sources}`,
          );
          assert.deepEqual(
            definitionSites(indexed, tokens[0]).map(positionLabel),
            [],
            `go-to-definition now answers at a metric source token — read this test's ` +
              `comment before updating it\n${indexed.sources}`,
          );
        },
      ),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("answers nothing at the schema prefix of a qualified arrow path", () => {
    // `s0.field_0` on a multi-schema side indexes `s0` as a reference to the
    // schema — which is what makes renaming the schema rewrite the prefix — but
    // the definition provider looks the first segment up as a *field* of the
    // mapping's schemas, and a schema name never is one.
    fc.assert(
      fc.property(
        multiSourceWorkspaceArbitrary.map(({ workspace }) => workspace),
        (workspace) => {
          const { indexed, entities } = indexWithGroundTruth(workspace);
          const keys = new Set(entities.map((entity) => entity.key));
          const prefixes = indexedReferenceSites(indexed).filter(
            (site) => site.kind === USAGE_KIND.arrow && keys.has(site.key),
          );
          assert.equal(
            prefixes.length,
            2,
            `the multi-source domain must qualify both arrow sources:\n${indexed.sources}`,
          );
          for (const site of prefixes) {
            assert.deepEqual(
              definitionSites(indexed, site).map(positionLabel),
              [],
              `go-to-definition now answers at ${describeSite(site)} — read this test's ` +
                `comment before updating it\n${indexed.sources}`,
            );
          }
        },
      ),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("loses the usages in an importing file once import scope is applied", () => {
    // The properties above ask the whole-folder index — what a client
    // establishes by opening a folder. Every real request asks
    // `scopeIndex(uri)` instead: the files import-reachable *from the cursor's
    // own document*. In a chain split across files the imports point one way
    // only, so from the declaration of `s1` in part1.stm the entry file is
    // unreachable and both of its sites — the `target { s1 }` and the
    // `import { s1 }` that made it legal — vanish from the answer. Rename is
    // scoped identically (`server.ts` onRenameRequest), so a rename driven from
    // a declaration leaves that import naming a schema that no longer exists.
    // Pinned, not endorsed: this is the exclusion the four properties above rely
    // on, and R4's round-trip has to choose which index it asks.
    fc.assert(
      fc.property(
        multiFileWorkspaceArbitrary.map(({ workspace }) => workspace),
        (workspace) => {
          const { indexed, entities, expected } = indexWithGroundTruth(workspace);

          // Non-vacuity: the domain must contain something cross-file to lose,
          // or "the scoped answer is the declaring file's usages" would hold for
          // the uninteresting reason that there are no others.
          assert.ok(
            entities.some((entity) =>
              expected.get(entity.key).some((site) => site.file !== entity.file),
            ),
            `no cross-file usage for import scope to drop:\n${indexed.sources}`,
          );

          for (const entity of entities) {
            const scoped = findReferenceSitesInImportScope(
              indexed,
              entity.key,
              declarationSite(indexed, entity),
            );
            assert.deepEqual(
              scoped.map(usageLabel).sort(),
              expected
                .get(entity.key)
                .filter((site) => site.file === entity.file)
                .map(usageLabel)
                .sort(),
              `import-scoped references for ${entity.keyword} ${entity.key} are not exactly the ` +
                `usages in its own file — read this test's comment before updating it` +
                `\nreported: ${describeSites(scoped)}\n${indexed.sources}`,
            );
          }
        },
      ),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });

  it("answers neither references nor a definition at a namespace name", () => {
    // A `namespace` name is not a `block_label`, so `findNodeContext` returns
    // nothing there — even `includeDeclaration` cannot report the declaration the
    // cursor is sitting on.
    fc.assert(
      fc.property(namespacedWorkspaceArbitrary, ({ workspace, namespaces }) => {
        const { indexed } = indexWithGroundTruth(workspace);
        // The domain guarantees at least one namespaced schema.
        const namespace = namespaces.find(Boolean);
        const site = declarationSite(indexed, {
          file: indexed.files[0].path,
          name: namespace,
          keyword: "namespace",
        });
        assert.deepEqual(
          findReferenceSites(indexed, namespace, site, true).map(positionLabel),
          [],
          `find-references now answers at a namespace name — read this test's comment ` +
            `before updating it\n${indexed.sources}`,
        );
        assert.deepEqual(
          definitionSites(indexed, site).map(positionLabel),
          [],
          `go-to-definition now answers at a namespace name — read this test's comment ` +
            `before updating it\n${indexed.sources}`,
        );
      }),
      GENERATED_PROPERTY_PARAMETERS,
    );
  });
});
