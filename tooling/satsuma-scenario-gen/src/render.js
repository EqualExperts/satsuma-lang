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

/** Render one scalar or record field declaration. */
function renderField(field, indent) {
  if (field.kind === "scalar") return `${indent}${field.name} STRING`;

  const body = renderMembers(field.fields, field.spreads, `${indent}  `);
  return body.length > 0
    ? `${indent}${field.name} record {\n${body}\n${indent}}`
    : `${indent}${field.name} record {}`;
}

/** Render a schema-shaped fragment or schema declaration. */
export function renderEntity(keyword, entity) {
  const body = renderMembers(entity.fields, entity.spreads, "  ");
  return body.length > 0
    ? `${keyword} ${entity.name} {\n${body}\n}`
    : `${keyword} ${entity.name} {}`;
}

/** Render the generated mapping, preserving the semantic arrow order. */
export function renderMapping(mapping) {
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
