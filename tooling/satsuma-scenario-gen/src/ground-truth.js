/**
 * ground-truth.js — what a scenario declares, computed from the scenario alone.
 *
 * **Nothing in this module imports, mirrors or restates production code.** Every
 * function here reads the scenario data structure and nothing else. That is what
 * makes it a usable oracle rather than a second implementation: a scenario
 * already *is* a graph, so the expected upstream set of a field is the set of its
 * ancestors under reachability over the arrows the scenario declared. There is no
 * Satsuma-specific rule to get wrong (Feature 41 PRD, "Why lineage needs no
 * independent oracle").
 *
 * This is why lineage is a better generated-input target than coverage was.
 * Coverage needed a hand-written oracle restating ADR-034–041, and the Feature 39
 * PRD rightly warns that two implementations can share one misunderstanding. Here
 * the oracle is a breadth-first search.
 *
 * ## What is deliberately outside the generated domain
 *
 * Two production rules in the `nl-derived` edge tier are *not* modelled, because
 * the generator never produces input that reaches them:
 *
 * - **self-reference**, where an `@ref` names the arrow's own target; and
 * - **duplicate suppression**, where an `@ref` names a field that is already a
 *   declared source of the same arrow in the same mapping.
 *
 * Modelling either would mean copying a production branch into the oracle — the
 * exact failure mode this module exists to avoid. The arbitraries instead avoid
 * generating those shapes, and the hand-written tests in the CLI's
 * `field-lineage` and `graph` suites keep covering them.
 *
 * Owns: declared paths, declared edges, and reachability over them. Does not own:
 * anything the *toolchain* is expected to do with them.
 */

import {
  canonicalEndpoint,
  canonicalEntityRef,
  flattenArrows,
  workspaceMappings,
  workspaceSchemas,
} from "./workspace-model.js";

// ── Declared field paths ───────────────────────────────────────────────────

/**
 * Every declared path of one field tree — containers as well as leaves.
 *
 * Containers are included because an arrow may legitimately name one (`each
 * orders -> shipments` names two containers), so the endpoint-existence property
 * must accept them. Coverage's *denominator* counts leaves only (ADR-034); that
 * is a different question from "is this a declared path".
 */
function declaredPaths(fields, prefix = "") {
  return fields.flatMap((field) => {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    return field.kind === "record" ? [path, ...declaredPaths(field.fields, path)] : [path];
  });
}

/**
 * Resolve a schema's fields including the fragments it spreads.
 *
 * A body declaration shadows a spread field of the same name rather than
 * duplicating it (ADR-041), which here needs no special handling beyond
 * preferring the body's own name — the result is a *set* of paths.
 */
function fieldsWithSpreads(schema, fragmentsByName) {
  const spreadFields = (schema.spreads ?? []).flatMap(
    (name) => fragmentsByName.get(name)?.fields ?? [],
  );
  const ownNames = new Set(schema.fields.map((field) => field.name));
  return [...schema.fields, ...spreadFields.filter((field) => !ownNames.has(field.name))];
}

/** Index every fragment in the workspace by its authored name. */
function fragmentsOf(workspace) {
  return new Map(
    workspace.files.flatMap((file) => file.fragments.map((fragment) => [fragment.name, fragment])),
  );
}

/**
 * Every qualified path the workspace declares, as `[ns]::schema.path`, sorted.
 *
 * This is the set an emitted edge endpoint must belong to. An endpoint outside it
 * names a field nobody declared, which is `r0-7w76`'s failure: `qualifyField`
 * cannot see the declared field set and so cannot tell a bare field name from a
 * container header naming the schema root.
 */
export function scenarioDeclaredFieldPaths(workspace) {
  const fragments = fragmentsOf(workspace);
  const paths = workspaceSchemas(workspace).flatMap(({ schema }) => {
    const prefix = canonicalEntityRef(
      schema.namespace ? `${schema.namespace}::${schema.name}` : schema.name,
    );
    return declaredPaths(fieldsWithSpreads(schema, fragments)).map((path) => `${prefix}.${path}`);
  });
  return [...new Set(paths)].sort();
}

// ── Declared field edges ───────────────────────────────────────────────────

/**
 * One expected field-level edge.
 *
 * `from` is null for a computed arrow, which declares a target with no source —
 * the state the graph records as `from: null`.
 *
 * @typedef {{
 *   from: string | null,
 *   to: string,
 *   mapping: string,
 *   classification: "none" | "nl" | "nl-derived",
 *   kind: "map" | "computed" | "each" | "flatten",
 *   file: string,
 * }} ScenarioFieldEdge
 */

/** An arrow's classification: `nl` once it carries a natural-language body. */
function classificationOf(arrow) {
  return arrow.transform ? "nl" : "none";
}

/**
 * Every field edge one arrow declares, iteration headers included.
 *
 * A `map` arrow with several sources declares one edge per source, all to the
 * same target (spec §4.2). An iteration header declares an edge of its own,
 * because it names a source and a target just as any other arrow does.
 */
function edgesForArrow(arrow, mappingKey, file) {
  const base = { mapping: mappingKey, file, kind: arrow.kind };

  if (arrow.kind === "computed") {
    return [
      {
        ...base,
        from: null,
        to: canonicalEndpoint(arrow.target),
        classification: classificationOf(arrow),
      },
    ];
  }
  const sources = arrow.kind === "map" ? arrow.sources : [arrow.source];
  return sources.map((source) => ({
    ...base,
    from: canonicalEndpoint(source),
    to: canonicalEndpoint(arrow.target),
    classification: classificationOf(arrow),
  }));
}

/**
 * The `nl-derived` edges an arrow's `@ref` mentions declare.
 *
 * An `@ref` in a transform body states that the mentioned field is an implicit
 * source for the arrow's target. Only arrows *with a target* contribute: a note
 * with no arrow has nothing to be a source of.
 */
function nlDerivedEdgesForArrow(arrow, mappingKey, file) {
  return (arrow.transform?.refs ?? []).map((ref) => ({
    from: canonicalEndpoint(ref),
    to: canonicalEndpoint(arrow.target),
    mapping: mappingKey,
    classification: "nl-derived",
    kind: arrow.kind,
    file,
  }));
}

/**
 * Every field edge the workspace declares, with fully qualified endpoints.
 *
 * Returned in declaration order, which is what lets a caller assert that a
 * consumer emits each declared edge *exactly once*: duplicates in the expected
 * list are meaningful (two identical arrows in one mapping really are two edges).
 */
export function scenarioFieldEdges(workspace) {
  return workspaceMappings(workspace).flatMap(({ file, mapping }) => {
    const mappingKey = canonicalEntityRef(
      mapping.namespace ? `${mapping.namespace}::${mapping.name}` : mapping.name,
    );
    const arrows = flattenArrows(mapping.arrows);
    return [
      ...arrows.flatMap((arrow) => edgesForArrow(arrow, mappingKey, file)),
      ...arrows.flatMap((arrow) => nlDerivedEdgesForArrow(arrow, mappingKey, file)),
    ];
  });
}

// ── Declared schema edges ──────────────────────────────────────────────────

/**
 * One expected schema-level edge. `role` distinguishes the four ways a schema can
 * be attached to a mapping or metric, which is what the graph's `schema_edges`
 * carries.
 *
 * @typedef {{ from: string, to: string, role: "source" | "target" | "metric_source" }} ScenarioSchemaEdge
 */

/**
 * Every schema-level edge the workspace declares.
 *
 * `source` and `target` come from a mapping's declared lists — *not* from its
 * arrows, so a mapping that declares no arrow at all still contributes topology.
 * `metric_source` comes from a metric schema's `source` metadata token, which is
 * a different mechanism entirely and is why it is a distinct role.
 *
 * `nl_ref` schema edges are not modelled: the CLI emits them only for a schema
 * mentioned in NL text that is *not* already a declared source, and the
 * generator deliberately never produces that shape (see this module's header).
 */
export function scenarioSchemaEdges(workspace) {
  const edges = [];
  for (const { mapping } of workspaceMappings(workspace)) {
    const mappingKey = canonicalEntityRef(
      mapping.namespace ? `${mapping.namespace}::${mapping.name}` : mapping.name,
    );
    for (const source of mapping.sources) {
      edges.push({ from: canonicalEntityRef(source), to: mappingKey, role: "source" });
    }
    for (const target of mapping.targets) {
      edges.push({ from: mappingKey, to: canonicalEntityRef(target), role: "target" });
    }
  }
  for (const { schema } of workspaceSchemas(workspace)) {
    const metricKey = canonicalEntityRef(
      schema.namespace ? `${schema.namespace}::${schema.name}` : schema.name,
    );
    for (const source of schema.metricSources ?? []) {
      edges.push({ from: canonicalEntityRef(source), to: metricKey, role: "metric_source" });
    }
  }
  return edges;
}

// ── Reachability: the oracle for every traversal property ──────────────────

/**
 * Adjacency built from a scenario's field edges, in one direction.
 *
 * Edges with a null `from` are skipped in the upstream direction: a computed
 * arrow has no source field, so it contributes no upstream hop. It still
 * contributes downstream nothing either — there is no field to walk *from*.
 */
function adjacency(edges, direction) {
  const next = new Map();
  for (const edge of edges) {
    if (edge.from === null) continue;
    const [key, value] = direction === "downstream" ? [edge.from, edge.to] : [edge.to, edge.from];
    if (!next.has(key)) next.set(key, new Set());
    next.get(key).add(value);
  }
  return next;
}

/**
 * Every field within `maxDepth` hops of `start`, and the hop count that reached
 * it, excluding `start` itself.
 *
 * Breadth-first, so the depth recorded for each field is its *shortest* path —
 * which is the property `sl-y89y` violated. A plain visited-set traversal that
 * expands a node once at whatever depth it first arrived can truncate a subtree
 * when a shorter path arrives later with budget still remaining. Returning the
 * shortest distance is what lets a property state depth *exactness* rather than
 * mere monotonicity, which the buggy implementation also satisfied.
 *
 * `maxDepth` counts hops, matching `--depth`: depth 1 is immediate neighbours.
 * Cycles terminate because a field is enqueued at most once.
 *
 * Module-private: the two direction wrappers below are the API, and a caller that
 * chose its own `direction` string would be one typo from a silently empty answer.
 */
function scenarioReachableWithin(edges, start, maxDepth, direction) {
  const next = adjacency(edges, direction);
  const distance = new Map();
  let frontier = [start];

  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth += 1) {
    const following = [];
    for (const field of frontier) {
      for (const neighbour of next.get(field) ?? []) {
        if (neighbour === start || distance.has(neighbour)) continue;
        distance.set(neighbour, depth);
        following.push(neighbour);
      }
    }
    frontier = following;
  }
  return distance;
}

/**
 * The fields that feed into `start` within `maxDepth` hops — the expected
 * `upstream` set. A diamond therefore yields *both* branches, which is the
 * defect behind `sg-pufq`.
 */
export function scenarioAncestorsWithin(edges, start, maxDepth) {
  return scenarioReachableWithin(edges, start, maxDepth, "upstream");
}

/** The fields `start` flows into within `maxDepth` hops — the expected `downstream` set. */
export function scenarioDescendantsWithin(edges, start, maxDepth) {
  return scenarioReachableWithin(edges, start, maxDepth, "downstream");
}

/**
 * Project field edges onto the schemas that own their endpoints.
 *
 * Ties field-level lineage to `graph --schema-only`: two walks that must agree,
 * because one is definitionally the projection of the other. The owning schema is
 * read off the endpoint's structure — everything before the first `.` that
 * follows the `::` separator — rather than by splitting on the first `.`, which
 * would be wrong for a namespaced key.
 */
export function scenarioSchemaProjection(edges) {
  const owning = (endpoint) => {
    if (endpoint === null) return null;
    const separator = endpoint.indexOf("::");
    const dot = endpoint.indexOf(".", separator + 2);
    return dot === -1 ? endpoint : endpoint.slice(0, dot);
  };
  const projected = new Set();
  for (const edge of edges) {
    const from = owning(edge.from);
    const to = owning(edge.to);
    if (from !== null && from !== to) projected.add(`${from}->${to}`);
  }
  return [...projected].sort();
}
