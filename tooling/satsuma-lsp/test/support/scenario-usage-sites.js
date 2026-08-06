/**
 * scenario-usage-sites.js — the entities a generated workspace declares, and
 * every place it uses them.
 *
 * This is the oracle the reference properties assert against. It reads the
 * scenario **data** only: no parsing, no index, nothing from `dist/`. A
 * generated workspace declares its schemas, fragments and mappings outright and
 * names every entity it references, so what `references` must return is already
 * stated — the toolchain's job is only to find it again.
 *
 * ## The one place a rule is restated, and why
 *
 * `import` statements are not authored by a scenario: `workspace-render.js`
 * derives them from usage, so that a generated workspace can never claim an
 * import graph its declarations contradict. An imported name is nevertheless a
 * reference site, and a big part of what the multi-file domain is for, so the
 * derivation is restated in {@link importedRefs} below. The alternative — read
 * the emitted `import` lines back out of the rendered text — would make this
 * oracle a parser, which is the thing it must not be. The duplicated rule is
 * ten lines of test-only string logic, not production behaviour, so it cannot
 * mask a toolchain defect: if the two ever disagree, a property fails and one of
 * them is wrong.
 *
 * ## What is deliberately not a usage site
 *
 * - **`namespace` blocks.** The scenario model has no namespace *declaration* to
 *   name, and nothing in a generated workspace refers to a namespace by itself —
 *   a qualified reference is filed under the whole `ns::name` key. The index does
 *   register a definition for the namespace, but the LSP finds no context at that
 *   position, so neither references nor definition answer there.
 * - **NL `@ref` mentions.** `@raw.field_1` mentions the schema `raw` in prose,
 *   but the index files the reference under the *field path* `raw.field_1`, not
 *   under `raw`. It is a reference to a field, and the schema mention inside it
 *   is not a site of its own. It still matters here: an NL ref to another file's
 *   schema is one of the things that forces an `import`, which *is* a site.
 *
 * Owns: the declared entities of a scenario workspace and their declared usage
 * sites. Does not own: rendering, indexing, positions, or any assertion.
 */

/**
 * Usage kinds, spelled exactly as the workspace index's
 * `ReferenceEntry.context`, so an expected site and an observed one compare as
 * plain strings with no translation layer between them.
 */
const USAGE_KIND = Object.freeze({
  /** An entity named in a mapping's `source { }` list. */
  source: "source",
  /** An entity named in a mapping's `target { }` list. */
  target: "target",
  /** A fragment spread into a schema or fragment body. */
  spread: "spread",
  /** A name listed in an `import { }` declaration. */
  import: "import",
  /** A schema named by a metric's `source` metadata token. */
  metricSource: "metric_source",
  /** The schema prefix of a qualified arrow path, e.g. the `s0` of `s0.field`. */
  arrow: "arrow",
});

/**
 * The usage kinds the LSP's definition provider resolves back to a declaration
 * today.
 *
 * `metric_source` and `arrow` are absent because the provider answers nothing at
 * either: `findNodeContext` has no case for a metadata value, and an arrow
 * path's first segment is looked up as a *field* of the mapping's schemas, which
 * a schema name never is. Both are pinned by their own tests in
 * `generated-reference-duality.test.js` rather than quietly skipped, so the day
 * either is fixed a test says so.
 */
const RESOLVABLE_USAGE_KINDS = Object.freeze([
  USAGE_KIND.source,
  USAGE_KIND.target,
  USAGE_KIND.spread,
  USAGE_KIND.import,
]);

/**
 * An entity a generated workspace declares.
 *
 * @typedef {{
 *   key: string,
 *   name: string,
 *   namespace: string | null,
 *   keyword: "schema" | "fragment" | "mapping",
 *   file: string,
 * }} DeclaredEntity
 *
 * `key` is the workspace index's definition key — `name` at file scope,
 * `ns::name` inside a namespace — and therefore the key a reference query must
 * arrive at. `name` is the block label as authored, which is what appears at the
 * declaration site and inside a namespace is *not* the key. `keyword` is the
 * declaration keyword, which is how the declaration is located in the rendered
 * text. `file` is the workspace-relative path of the declaring file.
 */

/**
 * Every entity a workspace declares, in declaration order.
 *
 * Mappings are included even though nothing references them: "no references"
 * is an assertion worth making, and it is the half of the property that catches
 * an invented reference rather than a missing one.
 *
 * @param {import("@satsuma/scenario-gen").ScenarioWorkspace} workspace
 * @returns {DeclaredEntity[]}
 */
function declaredEntities(workspace) {
  const entities = [];
  for (const file of workspace.files) {
    for (const fragment of file.fragments) {
      entities.push({
        key: fragment.name,
        name: fragment.name,
        namespace: null,
        keyword: "fragment",
        file: file.path,
      });
    }
    for (const schema of file.schemas) {
      entities.push({
        key: entityKey(schema.name, schema.namespace),
        name: schema.name,
        namespace: schema.namespace,
        keyword: "schema",
        file: file.path,
      });
    }
    for (const mapping of file.mappings) {
      entities.push({
        key: entityKey(mapping.name, mapping.namespace),
        name: mapping.name,
        namespace: mapping.namespace,
        keyword: "mapping",
        file: file.path,
      });
    }
  }
  return entities;
}

/**
 * Every usage site the workspace declares, grouped by the entity it references.
 *
 * Every declared entity gets an entry, empty when nothing references it. Sites
 * are a **multiset**, not a set: one file legitimately references the same entity
 * from two mappings, and collapsing that to one site would hide a reference the
 * toolchain dropped.
 *
 * @param {import("@satsuma/scenario-gen").ScenarioWorkspace} workspace
 * @returns {Map<string, Array<{ file: string, kind: string }>>}
 */
function declaredUsageSites(workspace) {
  const entities = declaredEntities(workspace);
  const keys = new Set(entities.map((entity) => entity.key));
  const sites = new Map(entities.map((entity) => [entity.key, []]));

  /** Record one site, resolving the authored spelling to the entity it names. */
  const add = (ref, namespace, file, kind) => {
    const key = entityKeyForRef(ref, namespace, keys);
    const forEntity = sites.get(key);
    if (!forEntity) {
      // Not a toolchain failure: the scenario referenced something it never
      // declared, which the renderer would emit as unresolvable Satsuma.
      throw new Error(`scenario error: '${ref}' in ${file} names no declared entity`);
    }
    forEntity.push({ file, kind });
  };

  for (const file of workspace.files) {
    for (const schema of file.schemas) {
      for (const ref of schema.metricSources ?? []) {
        add(ref, schema.namespace, file.path, USAGE_KIND.metricSource);
      }
      for (const ref of schema.spreads ?? []) {
        add(ref, schema.namespace, file.path, USAGE_KIND.spread);
      }
    }
    for (const mapping of file.mappings) {
      for (const ref of mapping.sources) add(ref, mapping.namespace, file.path, USAGE_KIND.source);
      for (const ref of mapping.targets) add(ref, mapping.namespace, file.path, USAGE_KIND.target);
      for (const ref of qualifiedArrowSchemas(mapping)) {
        add(ref, mapping.namespace, file.path, USAGE_KIND.arrow);
      }
    }
    for (const ref of importedRefs(file, workspace)) {
      // Import declarations are top-level, so they are authored in no namespace.
      add(ref, null, file.path, USAGE_KIND.import);
    }
  }

  return sites;
}

/**
 * The entity an authored reference names, given the namespace it was written in.
 *
 * Satsuma's scoping rule (spec §5.3): a name written with `::` names that entity
 * outright; a bare name binds to the enclosing namespace's declaration when
 * there is one, and to the file-scope declaration otherwise. This is a language
 * rule, so restating it here is not a re-derivation of anything the toolchain
 * decides — but it *is* the rule `resolveReferenceKey` implements, and getting
 * it wrong in one place and not the other is `sl-p256`.
 *
 * @param {string} ref authored spelling, e.g. `"s0"` or `"ns_a::s0"`
 * @param {string | null} namespace the namespace block the reference sits in
 * @param {Set<string>} declaredKeys every entity key the workspace declares
 */
function entityKeyForRef(ref, namespace, declaredKeys) {
  if (ref.includes("::")) return ref;
  if (namespace && declaredKeys.has(`${namespace}::${ref}`)) return `${namespace}::${ref}`;
  return ref;
}

/** The index key for a declaration: `ns::name` inside a namespace, `name` outside. */
function entityKey(name, namespace) {
  return namespace ? `${namespace}::${name}` : name;
}

// ── Arrow paths that name their schema ─────────────────────────────────────

/**
 * The schemas named by *qualified* arrow paths in a mapping.
 *
 * An arrow endpoint is `{ schema, path }` in the model, and the renderer decides
 * how it is spelled: bare when its side of the mapping has exactly that one
 * schema, `schema.path` when the side has several, and `.suffix` inside a
 * container block. Only the middle form writes the schema down, and the index
 * files the first segment of a path as a reference — which is what makes
 * renaming a schema rewrite `s0.field` correctly.
 *
 * The rule is restated from the renderer for the same reason as
 * {@link importedRefs}: the alternative is to read the answer out of rendered
 * text. Note that a *namespaced* schema on a multi-schema side would be spelled
 * `ns::schema.path`, which the index files under the bare `schema` — no
 * generated domain produces that shape today, and if one ever does this oracle
 * will correctly report the site as missing.
 */
function qualifiedArrowSchemas(mapping) {
  const schemas = [];

  const visit = (arrows, insideContainer) => {
    for (const arrow of arrows) {
      // Inside a container block every path is relative (`.suffix`), so it names
      // no schema at all.
      if (!insideContainer) {
        for (const ep of sourceEndpointsOf(arrow)) {
          if (namesItsSchema(ep, mapping.sources)) schemas.push(ep.schema);
        }
        if (namesItsSchema(arrow.target, mapping.targets)) schemas.push(arrow.target.schema);
      }
      if (arrow.children) visit(arrow.children, true);
    }
  };

  visit(mapping.arrows, false);
  return schemas;
}

/** The source endpoints of any arrow kind: several for `map`, one for a container header, none for `computed`. */
function sourceEndpointsOf(arrow) {
  if (arrow.sources) return arrow.sources;
  return arrow.source ? [arrow.source] : [];
}

/** Mirrors the renderer's `authoredEndpoint`: a side with one matching schema writes the path bare. */
function namesItsSchema(ep, sideSchemas) {
  return !(sideSchemas.length === 1 && sideSchemas[0] === ep.schema);
}

// ── Imports derived from usage ─────────────────────────────────────────────

/**
 * The names a file's derived `import` statements list.
 *
 * Restates `workspace-render.js`'s `renderImports`: everything the file
 * references but does not declare, that some other file declares, once per
 * entity, minus anything the scenario deliberately withholds. See this module's
 * header for why the rule is restated rather than read back out of the rendered
 * source.
 */
function importedRefs(file, workspace) {
  const own = declaredRefsOf(file);
  // `withheldImports` is the renderer's one deliberate hole in the derivation —
  // a defect mutator's way of reaching ADR-022's import-scope check. A valid
  // scenario leaves it empty, but honouring it here keeps a withheld import
  // reported as the missing *import statement* it is, rather than as a
  // find-references failure against a site the file never wrote.
  const withheld = new Set(file.withheldImports ?? []);
  const wanted = [...referencedRefsOf(file)].filter((ref) => !own.has(ref) && !withheld.has(ref));

  const imported = [];
  for (const other of workspace.files) {
    if (other.path === file.path) continue;
    const declared = declaredRefsOf(other);
    for (const ref of wanted) {
      if (declared.has(ref)) imported.push(ref);
    }
  }
  return imported;
}

/**
 * Every entity reference a file makes, as authored — the whole list the import
 * derivation is computed from, which is wider than the list of *sites*: an arrow
 * path written bare still needs its schema imported, and so does the schema an
 * NL `@ref` mentions.
 */
function referencedRefsOf(file) {
  const refs = new Set();
  for (const schema of file.schemas) {
    for (const ref of schema.metricSources ?? []) refs.add(ref);
    for (const ref of schema.spreads ?? []) refs.add(ref);
  }
  for (const mapping of file.mappings) {
    for (const ref of [...mapping.sources, ...mapping.targets]) refs.add(ref);
    for (const arrow of allArrowsOf(mapping.arrows)) {
      for (const ep of sourceEndpointsOf(arrow)) refs.add(ep.schema);
      refs.add(arrow.target.schema);
      for (const ep of arrow.transform?.refs ?? []) refs.add(ep.schema);
    }
  }
  return refs;
}

/**
 * Every entity a file declares, spelled the way a reference to it is written.
 *
 * Mappings are absent on purpose: the renderer's import derivation does not
 * consider them either, because nothing may reference a mapping.
 */
function declaredRefsOf(file) {
  return new Set([
    ...file.fragments.map((fragment) => fragment.name),
    ...file.schemas.map((schema) => entityKey(schema.name, schema.namespace)),
  ]);
}

/** Every arrow of a mapping, container headers included, parents before children. */
function allArrowsOf(arrows) {
  return arrows.flatMap((arrow) =>
    arrow.children ? [arrow, ...allArrowsOf(arrow.children)] : [arrow],
  );
}

module.exports = {
  RESOLVABLE_USAGE_KINDS,
  USAGE_KIND,
  declaredEntities,
  declaredUsageSites,
  entityKeyForRef,
};
