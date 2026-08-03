/**
 * coverage-oracle.js — Independent expected coverage for semantic scenarios.
 *
 * This test-only module interprets R3's deliberately small generated domain:
 * file-scope schemas, schema-local arrow refs, nested scalar/record fields, and
 * schema-level fragment spreads. It imports no production coverage, extraction,
 * spread, or path helper. Keeping the domain explicit and the implementation
 * plain is what makes this a useful differential oracle rather than a second
 * production walker.
 *
 * Rule                                      Authority
 * ----------------------------------------  ---------------------------
 * Count declared leaves, never containers   ADR-034
 * Identify coverage by qualified path       ADR-035
 * Derive container state from child state   ADR-037
 * Expand source record correspondences      ADR-037
 * Expand target records only from records   ADR-038
 * Reserve 0% and 100% for exact endpoints   ADR-040
 * Let explicit fields shadow spread fields  ADR-041
 */

/** @typedef {{ name: string, kind: "scalar" }} ScalarField */
/**
 * @typedef {{
 *   name: string,
 *   kind: "record",
 *   fields: SemanticField[],
 * }} RecordField
 */
/** @typedef {ScalarField | RecordField} SemanticField */
/**
 * @typedef {{
 *   name: string,
 *   fields: SemanticField[],
 *   spreads?: string[],
 * }} SemanticEntity
 */
/** @typedef {{ sources: string[], target: string }} SemanticArrow */
/**
 * @typedef {{
 *   sources: string[],
 *   targets: string[],
 *   arrows: SemanticArrow[],
 * }} SemanticMapping
 */
/**
 * @typedef {{
 *   fragments: SemanticEntity[],
 *   schemas: SemanticEntity[],
 *   mapping: SemanticMapping,
 * }} SemanticScenario
 */

// ── Declarations and paths ────────────────────────────────────────────────

/** Copy a semantic field tree so the oracle never mutates generated input. */
function copyField(field) {
  return field.kind === "record" ? { ...field, fields: field.fields.map(copyField) } : { ...field };
}

/**
 * Materialise schema-level spreads, with body declarations and then earlier
 * spreads winning each name exactly once (ADR-041).
 */
function materializeFields(entity, fragments) {
  const fields = entity.fields.map(copyField);
  const declaredNames = new Set(fields.map((field) => field.name));
  for (const spreadName of entity.spreads ?? []) {
    const fragment = fragments.get(spreadName);
    if (!fragment) continue;
    for (const field of fragment.fields) {
      if (declaredNames.has(field.name)) continue;
      declaredNames.add(field.name);
      fields.push(copyField(field));
    }
  }
  return fields;
}

/** Find the field declared at one schema-local dotted path. */
function findField(fields, path) {
  let level = fields;
  let found = null;
  for (const segment of path.split(".")) {
    found = level.find((field) => field.name === segment) ?? null;
    if (!found) return null;
    level = found.kind === "record" ? found.fields : [];
  }
  return found;
}

/** Every declared path below a record, retaining full qualification. */
function descendantPaths(record, path) {
  return record.fields.flatMap((field) => {
    const fieldPath = `${path}.${field.name}`;
    return field.kind === "record"
      ? [fieldPath, ...descendantPaths(field, fieldPath)]
      : [fieldPath];
  });
}

// ── Arrow membership ──────────────────────────────────────────────────────

/** Register one endpoint and, when asserted, its declared record subtree. */
function registerEndpoint(coveredPaths, fields, path, expandRecord) {
  coveredPaths.add(path);
  const field = findField(fields, path);
  if (expandRecord && field?.kind === "record") {
    for (const descendant of descendantPaths(field, path)) coveredPaths.add(descendant);
  }
}

/** True when at least one resolved source endpoint names a non-empty record. */
function sourceCarriesRecord(sourceRefs, sourceSchemas) {
  return sourceRefs.some((ref) =>
    sourceSchemas.some((schema) => {
      const field = findField(schema.fields, ref);
      return field?.kind === "record" && field.fields.length > 0;
    }),
  );
}

/** Apply the arrow rules directly for one schema and mapping role. */
function coveredPathsForSchema(schema, role, mapping, sourceSchemas) {
  const coveredPaths = new Set();
  for (const arrow of mapping.arrows) {
    if (role === "source") {
      for (const ref of arrow.sources) {
        registerEndpoint(coveredPaths, schema.fields, ref, true);
      }
    } else {
      registerEndpoint(
        coveredPaths,
        schema.fields,
        arrow.target,
        sourceCarriesRecord(arrow.sources, sourceSchemas),
      );
    }
  }
  return coveredPaths;
}

// ── Per-field state and leaf rollups ──────────────────────────────────────

/** Roll a non-empty record up from its direct children's states (ADR-037). */
function containerState(children) {
  if (children.every((child) => child.entry.state === "covered")) return "covered";
  if (children.every((child) => child.entry.state === "uncovered")) return "uncovered";
  return "partial";
}

/** Build one field entry and its descendants in declaration-first order. */
function oracleField(field, prefix, coveredPaths) {
  const path = prefix ? `${prefix}.${field.name}` : field.name;
  if (field.kind === "scalar" || field.fields.length === 0) {
    const state = coveredPaths.has(path) ? "covered" : "uncovered";
    return { entry: { path, mapped: state === "covered", state }, descendants: [] };
  }

  const children = field.fields.map((child) => oracleField(child, path, coveredPaths));
  const state = containerState(children);
  return {
    entry: { path, mapped: state !== "uncovered", state },
    descendants: children.flatMap(({ entry, descendants }) => [entry, ...descendants]),
  };
}

/** Flatten a semantic field tree in the order production coverage reports it. */
function oracleFields(fields, coveredPaths) {
  return fields.flatMap((field) => {
    const { entry, descendants } = oracleField(field, "", coveredPaths);
    return [entry, ...descendants];
  });
}

/** Qualified paths of the scalar leaves that form ADR-034's denominator. */
function leafPaths(fields, prefix = "") {
  return fields.flatMap((field) => {
    const path = prefix ? `${prefix}.${field.name}` : field.name;
    return field.kind === "record" ? leafPaths(field.fields, path) : [path];
  });
}

/** Whole-number percentage with exact endpoint meanings from ADR-040. */
function coveragePercentage(covered, total) {
  if (total === 0 || covered === 0) return 0;
  if (covered === total) return 100;
  return Math.max(1, Math.min(99, Math.floor((covered / total) * 100)));
}

/** Build the independent leaf rollup compared with production's public result. */
function oracleTotals(fields, entries) {
  const paths = leafPaths(fields);
  const stateByPath = new Map(entries.map((entry) => [entry.path, entry.state]));
  const covered = paths.filter((path) => stateByPath.get(path) === "covered").length;
  return {
    covered,
    coveredDeclared: covered,
    coveredNl: 0,
    total: paths.length,
    pct: coveragePercentage(covered, paths.length),
  };
}

/** Build one role's oracle results in authored participant order. */
function schemasForRole(role, names, mapping, schemas, sourceSchemas) {
  return names.flatMap((name) => {
    const schema = schemas.get(name);
    if (!schema) return [];
    const coveredPaths = coveredPathsForSchema(schema, role, mapping, sourceSchemas);
    const fields = oracleFields(schema.fields, coveredPaths);
    return [{ schemaId: name, role, fields, totals: oracleTotals(schema.fields, fields) }];
  });
}

/**
 * Interpret one generated semantic scenario without using production helpers.
 *
 * Only state and rollup facts are returned. Parser positions, URIs, tiers, and
 * protocol details remain production concerns rather than duplicated behaviour.
 */
export function coverageOracleForScenario(scenario) {
  const fragments = new Map(scenario.fragments.map((fragment) => [fragment.name, fragment]));
  const schemas = new Map(
    scenario.schemas.map((schema) => [
      schema.name,
      { ...schema, fields: materializeFields(schema, fragments) },
    ]),
  );
  const sourceSchemas = scenario.mapping.sources.flatMap((name) => {
    const schema = schemas.get(name);
    return schema ? [schema] : [];
  });
  return [
    ...schemasForRole("source", scenario.mapping.sources, scenario.mapping, schemas, sourceSchemas),
    ...schemasForRole("target", scenario.mapping.targets, scenario.mapping, schemas, sourceSchemas),
  ];
}
