/**
 * model.js — the semantic model a generated Satsuma scenario is built from.
 *
 * A scenario is plain data: declarations, mappings and arrows. Nothing here
 * parses, formats or interprets Satsuma — {@link ../render.js} turns this data
 * into source text, and each consuming package supplies its own thin adapter
 * that drives the production pipeline with the rendered result.
 *
 * Owns: the scenario data shapes and the constructors and path helpers that
 * build them. Does not own: rendering, arbitraries, or any expectation about
 * what the toolchain should report — those are render.js, arbitraries.js, and
 * the properties themselves.
 */

// ── Field declarations ─────────────────────────────────────────────────────

/** @typedef {{ name: string, kind: "scalar" }} ScenarioScalarField */
/**
 * A record field, which owns nested declarations and may spread a fragment.
 *
 * @typedef {{
 *   name: string,
 *   kind: "record",
 *   fields: ScenarioField[],
 *   spreads?: string[],
 * }} ScenarioRecordField
 */
/** @typedef {ScenarioScalarField | ScenarioRecordField} ScenarioField */

/**
 * A schema-shaped declaration: a `schema` or a `fragment` body.
 *
 * `spreads` names fragments whose fields are merged in at this level, which is
 * what makes a generated scenario able to exercise spread expansion.
 *
 * @typedef {{
 *   name: string,
 *   fields: ScenarioField[],
 *   spreads?: string[],
 * }} ScenarioEntity
 */

// ── Mappings and scenarios ─────────────────────────────────────────────────

/**
 * One arrow inside a mapping body: `sources -> target`.
 *
 * @typedef {{ sources: string[], target: string }} ScenarioArrow
 */
/**
 * One mapping: its declared source and target schemas plus its arrows.
 *
 * @typedef {{
 *   name: string,
 *   sources: string[],
 *   targets: string[],
 *   arrows: ScenarioArrow[],
 * }} ScenarioMapping
 */
/**
 * A single-file scenario: fragments, schemas and one mapping.
 *
 * @typedef {{
 *   fragments: ScenarioEntity[],
 *   schemas: ScenarioEntity[],
 *   mapping: ScenarioMapping,
 * }} Scenario
 */

/** Maximum generated leaves; small bounds make shrunk counterexamples reviewable. */
export const MAX_GENERATED_LEAVES = 5;

/** Construct one scalar declaration in the generated semantic model. */
export function scalarField(name) {
  return { name, kind: "scalar" };
}

/** Construct one record declaration in the generated semantic model. */
export function recordField(name, fields, spreads = []) {
  return { name, kind: "record", fields, ...(spreads.length > 0 ? { spreads } : {}) };
}

/** Stable leaf names derived from a generated count rather than arbitrary text. */
export function leafNames(count) {
  return Array.from({ length: count }, (_, index) => `field_${index}`);
}

/** A minimal two-schema mapping scenario used by most generated properties. */
export function mappingScenario({ sourceFields, targetFields, arrows, fragments = [] }) {
  return {
    fragments,
    schemas: [
      { name: "src", fields: sourceFields },
      { name: "tgt", fields: targetFields },
    ],
    mapping: { name: "load", sources: ["src"], targets: ["tgt"], arrows },
  };
}

// ── Path helpers ───────────────────────────────────────────────────────────

/** Prefix every field path with the same generated record chain. */
export function nestFields(fields, depth) {
  let nested = fields;
  for (let level = depth - 1; level >= 0; level -= 1) {
    nested = [recordField(`group_${level}`, nested)];
  }
  return nested;
}

/** Prefix one leaf path with the record chain produced by {@link nestFields}. */
export function nestedPath(path, depth) {
  const prefixes = Array.from({ length: depth }, (_, level) => `group_${level}`);
  return [...prefixes, path].join(".");
}

/** Turn one dotted path into the smallest semantic field tree declaring it. */
export function fieldTreeForPath(path) {
  const [head, ...tail] = path.split(".");
  return tail.length === 0
    ? [scalarField(head)]
    : [recordField(head, fieldTreeForPath(tail.join(".")))];
}

/** Every semantic leaf path, qualified from the schema root. */
export function semanticLeafPaths(fields, prefix = "") {
  return fields.flatMap((field) => {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    return field.kind === "record" ? semanticLeafPaths(field.fields, path) : [path];
  });
}
