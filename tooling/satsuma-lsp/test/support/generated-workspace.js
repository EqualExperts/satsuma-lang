/**
 * generated-workspace.js — the LSP's adapter for a generated scenario workspace.
 *
 * `@satsuma/scenario-gen` builds workspaces, renders them to Satsuma text and
 * states the ground truth that follows by construction; it knows nothing about
 * the toolchain. This module is the LSP's half of that arrangement: render a
 * workspace into **in-memory documents**, index them the way the server indexes
 * an open folder, and hand a property the positions it needs in order to ask a
 * question somewhere.
 *
 * ## Why this is deliberately not the CLI's adapter
 *
 * `satsuma-cli/test/support/generated-workspace.ts` writes the same rendered
 * files to a temporary directory and loads them through the CLI's own loader,
 * which **follows the entry file's `import` declarations** to decide which files
 * belong to the workspace. The LSP does the opposite: the client hands it every
 * document in the folder, `indexFile` records them all, and import scope is
 * applied afterwards and per query (`createScopedIndex`). Those are two
 * different pipelines over the same source text, and `sl-rw3e` exists precisely
 * because they scoped duplicate definitions differently. An adapter shared
 * between them would run one pipeline twice and hide exactly the class of defect
 * this suite exists to catch.
 *
 * ## Which index the providers are asked against
 *
 * {@link findReferenceSites} and {@link definitionSites} query the **whole-folder
 * index**, which is the state the client establishes by opening a folder — every
 * document indexed, nothing scoped away. `server.ts` narrows that per request
 * (`scopeIndex(uri)` = `createScopedIndex` over the files import-reachable *from
 * the document the cursor is in*), and that narrowing is not neutral: a
 * declaration in a downstream file cannot reach the upstream file that imports
 * it, so the upstream usages disappear from the answer. That is a property of the
 * scoping layer rather than of reference resolution, so it is asked separately by
 * {@link findReferenceSitesInImportScope} and pinned by its own test — it must
 * not be folded silently into a property about which sites reference an entity.
 *
 * ## CommonJS loading an ESM-only generator
 *
 * This package's test script runs `node --test` over plain JavaScript in `test/`
 * against the tsc-compiled `dist/`, with no loader — so every file here is
 * CommonJS, while `@satsuma/scenario-gen` is ESM-only. `require()` of an ES
 * module bridges that, exactly as `test/helper.js` already does for the ESM
 * `@satsuma/core`. It is also why this file is `.js` rather than the `.ts` the
 * ticket named: a TypeScript support module would never be loaded at all.
 *
 * Owns: rendering a scenario to documents, building the index, and locating a
 * declaration or a usage site. Does not own: expected values (that is
 * `scenario-usage-sites.js`) or any assertion.
 */

const { collectParseErrors } = require("@satsuma/core");
const { renderWorkspace } = require("@satsuma/scenario-gen");
const { parse } = require("../helper");
const {
  canonicalizeFileUri,
  createScopedIndex,
  createWorkspaceIndex,
  findReferences,
  getImportReachableUris,
  indexFile,
} = require("../../dist/workspace-index");
const { computeReferences } = require("../../dist/references");
const { computeDefinition } = require("../../dist/definition");

/**
 * Directory the generated documents are given URIs under.
 *
 * Nothing is written to disk — the LSP never needs the file to exist, only a
 * stable `file://` URI per document, because that is all the client sends and
 * all the index keys on. A generated workspace is flat, so one directory is
 * enough for the relative `./other.stm` import paths the renderer emits.
 */
const RENDERED_URI_PREFIX = "file:///generated/";

/**
 * Kind recorded for a reported reference the index has no entry for.
 *
 * Deliberately not a real context spelling: an invented location must never
 * compare equal to a usage site the scenario declares.
 */
const UNINDEXED_USAGE_KIND = "<no index entry>";

/**
 * A generated workspace rendered to documents and indexed.
 *
 * @typedef {{
 *   index: import("../../dist/workspace-index").WorkspaceIndex,
 *   files: Array<{ path: string, source: string, uri: string }>,
 *   sources: string,
 *   parseErrorCount: number,
 * }} IndexedGeneratedWorkspace
 *
 * `files` is in render order, so `files[0]` is the entry file. `sources` is the
 * whole workspace as one printable block, for inclusion in a failure message —
 * a shrunk counterexample is only useful if the Satsuma that produced it is in
 * the report. `parseErrorCount` counts tree-sitter ERROR and MISSING nodes
 * across every document: a property whose input did not parse is testing
 * nothing, so callers assert it is zero before asserting anything else.
 */

/**
 * Index already-rendered files as in-memory documents.
 *
 * Exposed separately from {@link indexGeneratedWorkspace} for the cases that
 * need Satsuma the scenario model cannot express — the same reason the CLI's
 * adapter splits the two.
 *
 * @param {Array<{ path: string, source: string }>} files entry file first
 * @returns {IndexedGeneratedWorkspace}
 */
function indexRenderedFiles(files) {
  const index = createWorkspaceIndex();
  const indexed = [];
  let parseErrorCount = 0;

  for (const file of files) {
    // Canonicalize here rather than trusting the spelling: `indexFile` keys its
    // entries by the canonical URI, so a lookup by the raw string would miss
    // them (sl-akz6).
    const uri = canonicalizeFileUri(`${RENDERED_URI_PREFIX}${file.path}`);
    const tree = parse(file.source);
    indexFile(index, uri, tree);
    parseErrorCount += collectParseErrors(tree).length;
    indexed.push({ path: file.path, source: file.source, uri, tree });
  }

  return {
    index,
    files: indexed.map(({ path, source, uri }) => ({ path, source, uri })),
    sources: files.map((file) => `-- ${file.path}\n${file.source}`).join("\n"),
    parseErrorCount,
    // Trees are kept out of the public shape: a property asks questions at
    // positions, and every question here needs the tree of the file the
    // position is in, which `treeAt` looks up.
    _trees: new Map(indexed.map(({ uri, tree }) => [uri, tree])),
  };
}

/**
 * Render a scenario workspace to documents and index all of them.
 *
 * Every document is indexed, not only those the entry file imports — that is the
 * LSP's model of a workspace, and the difference from the CLI's loader.
 *
 * @param {import("@satsuma/scenario-gen").ScenarioWorkspace} workspace
 * @returns {IndexedGeneratedWorkspace}
 */
function indexGeneratedWorkspace(workspace) {
  return indexRenderedFiles(renderWorkspace(workspace));
}

/** The document URI for a workspace-relative file path, e.g. `"entry.stm"`. */
function documentUri(indexed, filePath) {
  const file = indexed.files.find((candidate) => candidate.path === filePath);
  if (!file) throw new Error(`no generated document for '${filePath}'`);
  return file.uri;
}

/** The document a URI names, whatever spelling the URI arrived in. */
function documentAt(indexed, uri) {
  const canonical = canonicalizeFileUri(uri);
  const file = indexed.files.find((candidate) => candidate.uri === canonical);
  if (!file) throw new Error(`no generated document for URI '${uri}'`);
  return file;
}

/** The workspace-relative path of a document URI — the inverse of {@link documentUri}. */
function filePathOf(indexed, uri) {
  return documentAt(indexed, uri).path;
}

/** The parsed tree of one document. */
function treeAt(indexed, uri) {
  const tree = indexed._trees.get(canonicalizeFileUri(uri));
  if (!tree) throw new Error(`no parsed tree for URI '${uri}'`);
  return tree;
}

/**
 * The source text an LSP range covers.
 *
 * A property uses this to check that a reported range covers *exactly* the name
 * it claims to — the defect class where a range swallowed the surrounding path
 * or the `@` sigil, so a rename rewrote more than the name (`sl-xf3f`,
 * `sl-kf1r`). Multi-line ranges are reported rather than joined, because no
 * name a generated workspace declares spans a line break.
 */
function textAt(indexed, uri, range) {
  if (range.start.line !== range.end.line) return "<multi-line range>";
  const line = documentAt(indexed, uri).source.split("\n")[range.start.line];
  return line.slice(range.start.character, range.end.character);
}

/**
 * The position of an entity's declaration, found in the rendered text.
 *
 * Deliberately **not** read out of the index: this position is what the
 * definition properties compare a `computeDefinition` answer against, so taking
 * it from the same index the answer came from would compare the toolchain with
 * itself. A generated declaration is always `<keyword> <name>` at the start of a
 * line, optionally indented inside a namespace and optionally followed by a
 * metadata block, so scanning for that prefix locates it.
 *
 * Matched by string operations rather than a pattern built from `entity`: a
 * `RegExp` assembled from a value is a ReDoS surface Semgrep blocks
 * (`detect-non-literal-regexp`), and escaping the name to make it safe would be
 * more code than the two comparisons this needs.
 *
 * @param {IndexedGeneratedWorkspace} indexed
 * @param {{ file: string, name: string, keyword: string }} entity
 * @returns {{ uri: string, line: number, character: number }}
 */
function declarationSite(indexed, entity) {
  const uri = documentUri(indexed, entity.file);
  const lines = documentAt(indexed, uri).source.split("\n");

  for (let line = 0; line < lines.length; line += 1) {
    const character = declarationColumn(lines[line], entity);
    if (character !== null) return { uri, line, character };
  }
  throw new Error(
    `no '${entity.keyword} ${entity.name}' declaration in ${entity.file}:\n${indexed.sources}`,
  );
}

/**
 * The column `entity.name` starts at on one line, if that line declares it.
 *
 * A declaration line is leading whitespace, the keyword, one or more spaces, then
 * the name. The character *after* the name must not continue an identifier, which
 * is what stops `s1` from matching the start of `s10`.
 *
 * @returns {number | null} the 0-indexed column, or null if this is not the line
 */
function declarationColumn(line, { keyword, name }) {
  const indent = line.length - line.trimStart().length;
  const afterKeyword = indent + keyword.length;
  if (line.slice(indent, afterKeyword) !== keyword) return null;

  // At least one space must separate the keyword from the name, or `schemas s1`
  // would read as the keyword `schema` followed by the name `s`.
  const gap = line.slice(afterKeyword).length - line.slice(afterKeyword).trimStart().length;
  if (gap === 0) return null;

  const nameStart = afterKeyword + gap;
  if (line.slice(nameStart, nameStart + name.length) !== name) return null;

  const following = line.charAt(nameStart + name.length);
  return following === "" || !IDENTIFIER_CHARACTER.test(following) ? nameStart : null;
}

/**
 * Characters that continue a Satsuma identifier, so a name followed by one of
 * them is a *different, longer* name rather than a match.
 */
const IDENTIFIER_CHARACTER = /[\w-]/;

/**
 * One reported or indexed reference to an entity.
 *
 * @typedef {{
 *   file: string,
 *   uri: string,
 *   line: number,
 *   character: number,
 *   kind: string,
 *   text: string,
 * }} UsageSite
 *
 * `kind` is the index's `ReferenceEntry.context` — `"source"`, `"target"`,
 * `"spread"`, `"import"`, `"metric_source"`, `"arrow"` or `"nl"` — which is the
 * vocabulary `scenario-usage-sites.js` states its expectations in. `text` is the
 * source the range covers, so a failure names the token a reader can search for.
 */

/**
 * Ask the LSP's references provider for every reference to `entityKey`, from
 * `position`, and label each answer with the usage kind the index recorded there.
 *
 * The index queried is the whole-folder one — see this module's header for why
 * the per-document import scoping is a separate question, asked by
 * {@link findReferenceSitesInImportScope}.
 *
 * The labelling is a *description* of the answer, never an expectation: a
 * location the index has no entry for is labelled {@link UNINDEXED_USAGE_KIND}
 * so that an invented location cannot silently match a declared usage site.
 *
 * @returns {UsageSite[]}
 */
function findReferenceSites(indexed, entityKey, position, includeDeclaration = false) {
  return referenceSitesAgainst(indexed, indexed.index, entityKey, position, includeDeclaration);
}

/**
 * The same question, asked against the index `server.ts` would actually use:
 * `createScopedIndex` over the files import-reachable from `position.uri`.
 *
 * This is what a real editor request returns, and it is *not* the same set —
 * hence its own export and its own pinned test rather than a flag on
 * {@link findReferenceSites}, which would let the difference pass unnoticed.
 *
 * @returns {UsageSite[]}
 */
function findReferenceSitesInImportScope(indexed, entityKey, position, includeDeclaration = false) {
  const scoped = createScopedIndex(
    indexed.index,
    getImportReachableUris(position.uri, indexed.index),
  );
  return referenceSitesAgainst(indexed, scoped, entityKey, position, includeDeclaration);
}

/**
 * Run the references provider against one index and label every answer.
 *
 * The kinds come from the *whole-folder* index deliberately, even when the query
 * index is scoped: the label describes where a location is in the workspace, and
 * a scoped query dropping a site must show up as a missing site, never as a site
 * that lost its kind.
 */
function referenceSitesAgainst(indexed, queryIndex, entityKey, position, includeDeclaration) {
  const locations = computeReferences(
    treeAt(indexed, position.uri),
    position.line,
    position.character,
    position.uri,
    queryIndex,
    includeDeclaration,
  );

  const kindAt = new Map();
  for (const entry of findReferences(indexed.index, entityKey)) {
    kindAt.set(positionKey(entry.uri, entry.range.start), entry.context);
  }

  return locations.map((location) => ({
    file: filePathOf(indexed, location.uri),
    uri: location.uri,
    line: location.range.start.line,
    character: location.range.start.character,
    kind: kindAt.get(positionKey(location.uri, location.range.start)) ?? UNINDEXED_USAGE_KIND,
    text: textAt(indexed, location.uri, location.range),
  }));
}

/**
 * Every reference the index recorded, whatever name it is keyed under.
 *
 * This is the **probe set** for the duality property, and it comes from the raw
 * index rather than from `findReferences`: a query that drops a site would
 * otherwise also drop the probe that would have caught it. `key` is the name the
 * entry is filed under and `namespace` the block it was authored inside, which
 * together decide which entity the site actually references.
 *
 * @returns {Array<UsageSite & { key: string, namespace: string | null }>}
 */
function indexedReferenceSites(indexed) {
  const sites = [];
  for (const [key, entries] of indexed.index.references) {
    for (const entry of entries) {
      sites.push({
        key,
        namespace: entry.namespace ?? null,
        file: filePathOf(indexed, entry.uri),
        uri: entry.uri,
        line: entry.range.start.line,
        character: entry.range.start.character,
        kind: entry.context,
        text: textAt(indexed, entry.uri, entry.range),
      });
    }
  }
  return sites;
}

/**
 * Ask the LSP's definition provider what is at `position`, as a flat list.
 *
 * `computeDefinition` returns one `Location`, several, or null; a property wants
 * to assert on the count as much as on the answer, so all three collapse to an
 * array here.
 *
 * Asked against the whole-folder index, for the reason in this module's header.
 * A usage always sits in a file that imports what it uses, so import scope only
 * ever narrows this answer to the same declaration — the direction that loses
 * sites is references, not definition.
 *
 * @returns {UsageSite[]} empty when the provider resolved nothing
 */
function definitionSites(indexed, position) {
  const answer = computeDefinition(
    treeAt(indexed, position.uri),
    position.line,
    position.character,
    position.uri,
    indexed.index,
  );
  if (answer === null) return [];

  return (Array.isArray(answer) ? answer : [answer]).map((location) => ({
    file: filePathOf(indexed, location.uri),
    uri: location.uri,
    line: location.range.start.line,
    character: location.range.start.character,
    kind: "declaration",
    text: textAt(indexed, location.uri, location.range),
  }));
}

/** Identity of a position, for set membership and set difference. */
function positionKey(uri, start) {
  return `${uri}:${start.line}:${start.character}`;
}

module.exports = {
  UNINDEXED_USAGE_KIND,
  declarationSite,
  definitionSites,
  documentUri,
  filePathOf,
  findReferenceSites,
  findReferenceSitesInImportScope,
  indexGeneratedWorkspace,
  indexRenderedFiles,
  indexedReferenceSites,
  textAt,
  treeAt,
};
