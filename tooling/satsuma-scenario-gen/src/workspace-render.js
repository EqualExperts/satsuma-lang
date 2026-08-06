/**
 * workspace-render.js — turn a scenario workspace into Satsuma source files.
 *
 * Two things happen here that are the whole point of the renderer existing:
 *
 * 1. **Authored spellings are derived, not authored.** The model records every
 *    endpoint as `{ schema, path }`. This module decides how it is *written* —
 *    bare when the mapping has one schema on that side, `schema.path` when it has
 *    several, `.suffix` inside a container block. Production code has to invert
 *    that choice; the ground truth never does, because it reads the model.
 *
 * 2. **`import` statements are derived from usage.** A file that references an
 *    entity declared in another file gets exactly the import it needs. Satsuma
 *    scopes symbols explicitly (spec §5.3), so a workspace whose imports did not
 *    match its usage would be *semantically invalid* — a generator bug the
 *    properties would misreport as a toolchain bug.
 *
 * Owns: Satsuma text for every workspace construct, and the assertions that keep
 * a malformed scenario from being rendered as invalid Satsuma. Does not own: the
 * scenario shapes (workspace-model.js) or any expectation about behaviour.
 */

import { renderDeclaration, renderEntity } from "./render.js";
import { flattenArrows } from "./workspace-model.js";

/** Indent one level of a mapping body; two spaces, matching the formatter. */
const INDENT = "  ";

// ── Endpoint spelling ──────────────────────────────────────────────────────

/**
 * How an endpoint is written on one side of an arrow, given that side's schemas.
 *
 * A single-schema side may write the path bare, which is the common Satsuma form
 * and the one `resolveFieldEndpoint` has to attach to the mapping's first schema.
 * A multi-schema side must qualify, because a bare path would be ambiguous — and
 * that qualified spelling is the branch of `resolveFieldEndpoint` that matches a
 * prefix against the declared schema list.
 *
 * Exported for `mutators.js`, whose predicted diagnostics have to name a field the
 * way the *source text* names it — a diagnostic message quotes the authored path,
 * not the model's `{ schema, path }`. Deriving that spelling twice is how the two
 * would drift.
 */
export function authoredEndpoint({ schema, path }, sideSchemas) {
  return sideSchemas.length === 1 && sideSchemas[0] === schema ? path : `${schema}.${path}`;
}

/**
 * How an endpoint is written *inside* a container block: relative to the block.
 *
 * Satsuma has no notation for reaching an ancestor, so a child endpoint that is
 * not under the block's own path could not be spelled at all. That is a scenario
 * defect, not a renderable state, so it throws rather than emitting Satsuma that
 * resolves to a field nobody declared.
 */
function relativeEndpoint(child, blockSchema, blockPath) {
  if (child.schema !== blockSchema) {
    throw new Error(
      `scenario error: arrow inside a block on '${blockSchema}' names schema ` +
        `'${child.schema}'; Satsuma has no notation for that (spec §4.4)`,
    );
  }
  if (child.path !== blockPath && !child.path.startsWith(`${blockPath}.`)) {
    throw new Error(
      `scenario error: '${child.path}' is not under block path '${blockPath}'; ` +
        `Satsuma has no notation for reaching an ancestor (spec §4.4)`,
    );
  }
  // The leading dot documents the relativity the block already imposes.
  return `.${child.path.slice(blockPath.length + 1)}`;
}

// ── Transform bodies ───────────────────────────────────────────────────────

/**
 * Render an NL transform body, mentioning each `@ref` inside the prose.
 *
 * The refs are appended as a sentence rather than interpolated into `text`, so
 * that the generated mention is always well-formed regardless of the prose.
 */
function renderTransform(transform) {
  const mentions = transform.refs.map((ref) => `@${ref.schema}.${ref.path}`);
  const sentence = mentions.length > 0 ? ` Derived from ${mentions.join(" and ")}.` : "";
  return `"${transform.text}${sentence}"`;
}

/** `{ "…" }` when the arrow has an NL body, and nothing at all when it does not. */
function renderArrowBody(arrow) {
  return arrow.transform ? ` { ${renderTransform(arrow.transform)} }` : "";
}

// ── Arrows ─────────────────────────────────────────────────────────────────

/**
 * Render one arrow and, for a container block, everything nested inside it.
 *
 * `context` carries the enclosing block's schema and path, or nulls at mapping
 * level. It is what decides whether an endpoint is written absolutely or as a
 * `.suffix`.
 */
function renderArrow(arrow, mapping, indent, context) {
  const source = (ep) =>
    context.sourcePath === null
      ? authoredEndpoint(ep, mapping.sources)
      : relativeEndpoint(ep, context.sourceSchema, context.sourcePath);
  const target = (ep) =>
    context.targetPath === null
      ? authoredEndpoint(ep, mapping.targets)
      : relativeEndpoint(ep, context.targetSchema, context.targetPath);

  if (arrow.kind === "map") {
    const sources = arrow.sources.map(source).join(", ");
    return `${indent}${sources} -> ${target(arrow.target)}${renderArrowBody(arrow)}`;
  }
  if (arrow.kind === "computed") {
    // A computed arrow always carries a body: `-> t` with nothing to say would
    // declare a target with neither a source nor a description.
    const body = arrow.transform ? renderArrowBody(arrow) : ` { "Computed." }`;
    return `${indent}-> ${target(arrow.target)}${body}`;
  }

  const header = `${indent}${arrow.kind} ${source(arrow.source)} -> ${target(arrow.target)}`;
  const nested = arrow.children.map((child) =>
    renderArrow(child, mapping, indent + INDENT, {
      sourceSchema: arrow.source.schema,
      sourcePath: arrow.source.path,
      targetSchema: arrow.target.schema,
      targetPath: arrow.target.path,
    }),
  );
  return [`${header} {`, ...nested, `${indent}}`].join("\n");
}

/** Mapping-level context: every path is written absolutely. */
const MAPPING_SCOPE = {
  sourceSchema: null,
  sourcePath: null,
  targetSchema: null,
  targetPath: null,
};

// ── Declarations ───────────────────────────────────────────────────────────

/** Render a schema, including the metadata block that makes it a metric. */
function renderSchema(schema, indent) {
  const metadata = [];
  if (schema.metric) {
    metadata.push("metric", `metric_name "${schema.name}"`);
    for (const source of schema.metricSources ?? []) metadata.push(`source ${source}`);
  }
  const header =
    metadata.length > 0
      ? `schema ${schema.name} (${metadata.join(", ")})`
      : `schema ${schema.name}`;
  return indentBlock(renderDeclaration(header, schema), indent);
}

/**
 * Render a mapping block.
 *
 * The source and target lists are emitted in model order because that order is
 * semantically load-bearing: an unqualified arrow path is attached to the *first*
 * schema on its side.
 */
function renderMapping(mapping, indent) {
  const lines = [
    `mapping ${mapping.name} {`,
    `${INDENT}source { ${mapping.sources.join(", ")} }`,
    `${INDENT}target { ${mapping.targets.join(", ")} }`,
    ...mapping.arrows.map((arrow) => renderArrow(arrow, mapping, INDENT, MAPPING_SCOPE)),
    "}",
  ];
  return indentBlock(lines.join("\n"), indent);
}

/** Re-indent an already rendered block, for placing it inside a namespace. */
function indentBlock(text, indent) {
  if (indent === "") return text;
  return text
    .split("\n")
    .map((line) => (line.length > 0 ? indent + line : line))
    .join("\n");
}

// ── Namespaces ─────────────────────────────────────────────────────────────

/**
 * Namespace names used by a file's declarations, in first-appearance order.
 *
 * `null` (file scope) is not a namespace and is rendered before any of them, so
 * a global fragment or schema is in scope for every namespaced declaration.
 */
function namespacesOf(file) {
  const seen = [];
  for (const decl of [...file.schemas, ...file.mappings]) {
    if (decl.namespace !== null && !seen.includes(decl.namespace)) seen.push(decl.namespace);
  }
  return seen;
}

/**
 * Render one `namespace name { … }` block with the declarations it owns.
 *
 * A `note` tag is emitted only when the file carries one for this namespace. A
 * namespace block may be reopened in several files, and the index merges their
 * metadata — two files disagreeing about the same tag is what
 * `namespace-metadata-conflict` reports, and the only way a scenario can say it.
 */
function renderNamespace(name, file) {
  const note = file.namespaceNotes?.[name];
  const header =
    note === undefined ? `namespace ${name} {` : `namespace ${name} (note "${note}") {`;
  const body = [
    ...file.schemas.filter((s) => s.namespace === name).map((s) => renderSchema(s, INDENT)),
    ...file.mappings.filter((m) => m.namespace === name).map((m) => renderMapping(m, INDENT)),
  ];
  return [header, body.join("\n\n"), "}"].join("\n");
}

// ── Imports ────────────────────────────────────────────────────────────────

/**
 * Every entity reference a file makes: mapping source/target lists, arrow
 * endpoint schemas, NL `@ref` schemas, metric `source` tokens and fragment
 * spreads. Anything declared elsewhere in the workspace must be imported, so
 * this list is what the import derivation is computed from.
 */
function referencedEntities(file) {
  const refs = new Set();
  for (const schema of file.schemas) {
    for (const source of schema.metricSources ?? []) refs.add(source);
    for (const spread of schema.spreads ?? []) refs.add(spread);
  }
  for (const mapping of file.mappings) {
    for (const ref of [...mapping.sources, ...mapping.targets]) refs.add(ref);
    for (const arrow of flattenArrows(mapping.arrows)) {
      const endpoints = [
        ...(arrow.sources ?? []),
        ...(arrow.source ? [arrow.source] : []),
        arrow.target,
        ...(arrow.transform?.refs ?? []),
      ];
      for (const ep of endpoints) refs.add(ep.schema);
    }
  }
  return refs;
}

/** Every entity a file declares, in the authored `ns::name` spelling. */
function declaredEntities(file) {
  return new Set([
    ...file.fragments.map((fragment) => fragment.name),
    ...file.schemas.map(
      (schema) => (schema.namespace ? `${schema.namespace}::` : "") + schema.name,
    ),
  ]);
}

/**
 * `import { … } from "…"` statements for every cross-file reference a file makes.
 *
 * Grouped by declaring file and sorted, so that permuting declarations changes
 * the rendered imports only where it genuinely changes what is referenced. Paths
 * are written `./name.stm` because Satsuma resolves them relative to the
 * importing file, and every generated workspace is flat.
 */
function renderImports(file, workspace) {
  const own = declaredEntities(file);
  // `withheldImports` is the one hole in the derivation, and it is deliberate: a
  // file that always imports what it references can never violate import scope,
  // so the mutator that reaches ADR-022's check needs a way to drop one statement
  // the file's own declarations still depend on.
  const withheld = new Set(file.withheldImports ?? []);
  const wanted = [...referencedEntities(file)].filter((ref) => !own.has(ref) && !withheld.has(ref));

  const byFile = new Map();
  for (const other of workspace.files) {
    if (other.path === file.path) continue;
    const declared = declaredEntities(other);
    const names = wanted.filter((ref) => declared.has(ref)).sort();
    if (names.length > 0) byFile.set(other.path, names);
  }

  return [...byFile.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([path, names]) => `import { ${names.join(", ")} } from "./${path}"`);
}

// ── Public surface ─────────────────────────────────────────────────────────

/**
 * Render one file of a workspace to Satsuma source.
 *
 * Order is fixed: imports, then file-scope fragments and declarations, then each
 * namespace block. File-scope declarations come first so they are in scope for
 * the namespaced ones.
 *
 * @param {import("./workspace-model.js").ScenarioFile} file
 * @param {import("./workspace-model.js").ScenarioWorkspace} workspace
 * @returns {string}
 */
export function renderWorkspaceFile(file, workspace) {
  const imports = renderImports(file, workspace);
  const sections = [
    // One section, so the statements sit together as a block the way an author
    // would write them.
    ...(imports.length > 0 ? [imports.join("\n")] : []),
    ...file.fragments.map((fragment) => renderEntity("fragment", fragment)),
    ...file.schemas.filter((s) => s.namespace === null).map((s) => renderSchema(s, "")),
    ...file.mappings.filter((m) => m.namespace === null).map((m) => renderMapping(m, "")),
    ...namespacesOf(file).map((name) => renderNamespace(name, file)),
  ];
  return `${sections.join("\n\n")}\n`;
}

/**
 * Render a whole workspace as `path → source`, entry file first.
 *
 * Callers write these to a temporary directory and point a command at
 * `files[0]`'s path; the derived `import` statements make the rest reachable.
 *
 * @param {import("./workspace-model.js").ScenarioWorkspace} workspace
 * @returns {Array<{ path: string, source: string }>}
 */
export function renderWorkspace(workspace) {
  return workspace.files.map((file) => ({
    path: file.path,
    source: renderWorkspaceFile(file, workspace),
  }));
}
