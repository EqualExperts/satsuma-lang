/**
 * render.js — turn a semantic scenario into Satsuma source text.
 *
 * Rendering is deliberately pure string building with no dependency on
 * `@satsuma/core`. That is what keeps this package free of the production
 * pipeline: a property that compared generated source against a renderer which
 * itself used the parser would be checking the parser against itself.
 *
 * The layout produced here is intentionally plain rather than canonical — the
 * formatter's own generated properties reformat it and assert idempotence, so
 * emitting already-formatted text would make those properties vacuous.
 *
 * Owns: the Satsuma text form of every scenario construct. Does not own: the
 * scenario shapes (model.js) or any parse/validate step (each consumer's
 * adapter).
 */

/** Render fields and spreads at one declaration level. */
function renderMembers(fields, spreads, indent) {
  const members = fields.map((field) => renderField(field, indent));
  members.push(...(spreads ?? []).map((spread) => `${indent}...${spread}`));
  return members.join("\n");
}

/**
 * Declared type of a generated scalar when the scenario names none.
 *
 * Every generated field was `STRING` before defect mutators existed, and staying
 * `STRING` by default is what keeps `type-mismatch-direct-arrow` silent on a
 * valid workspace: the rule fires on a *difference*, so a domain with one type
 * has nothing for it to report (see mutators.js `retypeBareArrowTarget`).
 */
const DEFAULT_SCALAR_TYPE = "STRING";

/** Render one scalar or record field declaration. */
function renderField(field, indent) {
  if (field.kind === "scalar") {
    return `${indent}${field.name} ${field.type ?? DEFAULT_SCALAR_TYPE}`;
  }

  const keyword = field.isList ? "list_of record" : "record";
  const body = renderMembers(field.fields, field.spreads, `${indent}  `);
  return body.length > 0
    ? `${indent}${field.name} ${keyword} {\n${body}\n${indent}}`
    : `${indent}${field.name} ${keyword} {}`;
}

/**
 * Render a schema-shaped declaration under a caller-supplied header.
 *
 * The header is everything up to the opening brace — `schema orders`, or
 * `schema mrr (metric, metric_name "mrr")`. Splitting it out is what lets the
 * workspace renderer attach a metadata block without restating field rendering.
 */
export function renderDeclaration(header, entity) {
  const body = renderMembers(entity.fields, entity.spreads, "  ");
  return body.length > 0 ? `${header} {\n${body}\n}` : `${header} {}`;
}

/** Render a schema-shaped fragment or schema declaration with no metadata. */
export function renderEntity(keyword, entity) {
  return renderDeclaration(`${keyword} ${entity.name}`, entity);
}

/** Render the generated mapping, preserving the semantic arrow order. */
function renderMapping(mapping) {
  const lines = [
    `mapping ${mapping.name} {`,
    `  source { ${mapping.sources.join(", ")} }`,
    `  target { ${mapping.targets.join(", ")} }`,
    ...mapping.arrows.map((arrow) => `  ${arrow.sources.join(", ")} -> ${arrow.target}`),
    "}",
  ];
  return lines.join("\n");
}

/** Render one semantic scenario into a complete Satsuma source file. */
export function renderScenario(scenario) {
  return [
    ...scenario.fragments.map((fragment) => renderEntity("fragment", fragment)),
    ...scenario.schemas.map((schema) => renderEntity("schema", schema)),
    renderMapping(scenario.mapping),
  ].join("\n\n");
}
