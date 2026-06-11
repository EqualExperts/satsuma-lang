/**
 * validate.ts — Semantic validation for Satsuma workspaces
 *
 * Semantic checks catch errors that tree-sitter cannot: undefined references,
 * duplicate definitions, arrows pointing to undeclared fields, and NL @refs
 * that don't resolve to workspace entities. These require a fully-built
 * workspace index, not just individual file parses.
 *
 * The main export is collectSemanticDiagnostics(index). Its input is the
 * SemanticIndex structural interface, which the CLI WorkspaceIndex satisfies
 * via TypeScript duck typing. Outputs are plain SemanticDiagnostic objects
 * with no CLI- or LSP-specific types.
 *
 * Check categories (each has its own section below):
 *   1. Duplicate definitions — same name declared twice
 *   2. Fragment spread references — spreads to unknown fragments
 *   3. Mapping source/target references — mappings pointing to unknown schemas
 *   4. Metric source references — metrics referencing unknown schemas
 *   5. NL @ref validation — @refs in NL transforms that don't resolve
 *   6. Arrow field references — arrow paths not declared in their schema
 *   7. Transform spread references — ...spread in arrow transforms
 *   8. Ref metadata targets — (ref @schema) annotations pointing to unknown schemas
 *   9. Import scope — symbols used but not reachable through the file's imports (ADR-022)
 */

import { capitalize } from "./string-utils.js";
import { extractAtRefs, classifyRef, resolveRef, isSchemaInMappingSources, stripNLRefScopePrefix, computeNLRefPosition } from "./nl-ref.js";
import type { DefinitionLookup } from "./nl-ref.js";
import { expandSpreads, collectFieldPaths } from "./spread-expand.js";
import type { SpreadEntity } from "./spread-expand.js";
import { resolveScopedEntityRef } from "./canonical-ref.js";
import type { FieldDecl, MetaEntry, PipeStep } from "./types.js";
import { computeImportReachability } from "./import-reachability.js";
import type { ImportReachability, ResolvedFileImport } from "./import-reachability.js";

// ---------- Output type ----------

/**
 * A single semantic diagnostic produced by the validator.
 * All positions are 1-indexed (row and column both start at 1), matching
 * the convention used in CLI output. LSP consumers must subtract 1.
 */
export interface SemanticDiagnostic {
  /** Absolute path or URI of the source file containing the issue. */
  file: string;
  /** 1-indexed line number of the entity or arrow that triggered the diagnostic. */
  line: number;
  /** 1-indexed column number (always 1 for entity-level checks). */
  column: number;
  severity: "error" | "warning";
  /** Short machine-readable rule identifier, e.g. "duplicate-definition". */
  rule: string;
  /** Human-readable diagnostic message. */
  message: string;
}

// ---------- Structural input interface ----------
//
// SemanticIndex is the minimal structural interface that collectSemanticDiagnostics
// requires. The CLI WorkspaceIndex and LSP WorkspaceIndex both satisfy it via
// TypeScript structural typing — no code changes needed in consumers.

export interface SemanticSchema {
  name: string;
  namespace?: string;
  file: string;
  row: number;
  fields: FieldDecl[];
  spreads?: string[];
  hasSpreads?: boolean;
  blockMetadata?: MetaEntry[];
}

export interface SemanticFragment {
  name: string;
  namespace?: string;
  file: string;
  row: number;
  fields: FieldDecl[];
  spreads?: string[];
  hasSpreads?: boolean;
}

export interface SemanticMapping {
  name: string | null;
  namespace?: string;
  file: string;
  row: number;
  sources: string[];
  targets: string[];
}

export interface SemanticMetric {
  namespace?: string;
  file: string;
  row: number;
  sources?: string[];
}

export interface SemanticArrow {
  mapping: string | null;
  namespace: string | null;
  sources: string[];
  target: string | null;
  steps?: PipeStep[];
  line: number;
  file: string;
}

export interface SemanticNLRef {
  text: string;
  mapping: string;
  namespace: string | null;
  line: number;
  column: number;
  file: string;
}

export interface SemanticDuplicate {
  kind: string;
  name: string;
  file: string;
  row: number;
  previousKind: string;
  previousFile: string;
  previousRow: number;
  tag?: string;
  value?: string;
  previousValue?: string;
}

/**
 * Policy for a single import-scope violation.
 *
 * Most consumers should keep the default. Adapters that need a different
 * public diagnostic contract (for example, LSP quick-fix wording) can override
 * the rule/message without reimplementing the import reachability check.
 */
export interface ImportScopeDiagnosticPolicy {
  /** Machine-readable rule code for the emitted diagnostic. */
  rule?: string;
  /**
   * Builds the human-readable message. The input carries the resolved symbol
   * and definition file so callers can produce actionable import suggestions.
   */
  message?: (violation: ImportScopeViolation) => string;
}

/**
 * Details for a reference that resolved to a workspace symbol but is not
 * reachable from the referencing file's import declarations.
 */
export interface ImportScopeViolation {
  /** File containing the out-of-scope reference. */
  file: string;
  /** 0-indexed row of the entity or arrow that owns the reference. */
  row: number;
  /** Kind of entity containing the reference, e.g. "mapping" or "schema". */
  entityKind: string;
  /** Name of the entity containing the reference. */
  entityName: string;
  /** Kind of referenced symbol, e.g. "source" or "fragment". */
  refKind: string;
  /** Reference text as authored. */
  ref: string;
  /** Resolved symbol key in the workspace index. */
  resolved: string;
  /** File containing the referenced symbol definition, when the index exposes it. */
  definitionFile: string | null;
}

/**
 * Shared entry-point options for semantic validation.
 *
 * Callers can pass already-computed reachability, or pass resolved file imports
 * and let core compute the reachability graph. Passing neither keeps the
 * legacy single-workspace behaviour and skips import-scope diagnostics.
 */
export interface SemanticValidationOptions {
  /** Resolved imports by file, used to compute import reachability. */
  fileImports?: Map<string, ResolvedFileImport[]>;
  /** Precomputed import reachability, useful when a caller already has it. */
  reachability?: ImportReachability;
  /** Optional presentation policy for import-scope diagnostics. */
  importScopeDiagnostic?: ImportScopeDiagnosticPolicy;
}

/**
 * Minimal workspace index required by the semantic validator.
 * The CLI WorkspaceIndex satisfies this interface structurally.
 * nlRefData and duplicates are optional — absent means "none found".
 */
export interface SemanticIndex {
  schemas: Map<string, SemanticSchema>;
  fragments: Map<string, SemanticFragment>;
  mappings: Map<string, SemanticMapping>;
  metrics: Map<string, SemanticMetric>;
  /** Transform name map — only Map membership is checked (no field access needed). */
  transforms: Map<string, unknown>;
  fieldArrows: Map<string, SemanticArrow[]>;
  nlRefData?: SemanticNLRef[];
  duplicates?: SemanticDuplicate[];
}

// ---------- Entry point ----------

/**
 * Run all semantic checks against a workspace index, returning a flat list of
 * diagnostics. All positions in the output are 1-indexed.
 *
 * The checks are independent: a failure in one category does not suppress
 * diagnostics from another. Order within each category matches declaration order.
 *
 * When `reachability` is provided (computed by computeImportReachability from
 * import-reachability.ts), an additional import-scope check verifies that every
 * cross-file reference is reachable through the file's import declarations.
 * Without reachability data the check is skipped (backward compatible).
 */
export function collectSemanticDiagnostics(
  index: SemanticIndex,
  reachability?: ImportReachability,
): SemanticDiagnostic[] {
  return collectSemanticDiagnosticsWithOptions(index, { reachability });
}

/**
 * Validate a semantic workspace using the shared core pipeline.
 *
 * This is the preferred consumer entry point: CLI and LSP adapters provide the
 * same SemanticIndex shape and, when available, the same resolved import map.
 * Core then owns the rule order and reachability integration in one place.
 */
export function validateSemanticWorkspace(
  index: SemanticIndex,
  options: SemanticValidationOptions = {},
): SemanticDiagnostic[] {
  const reachability = options.reachability
    ?? (options.fileImports ? computeImportReachability(index, options.fileImports) : undefined);
  return collectSemanticDiagnosticsWithOptions(index, {
    ...options,
    reachability,
  });
}

function collectSemanticDiagnosticsWithOptions(
  index: SemanticIndex,
  options: SemanticValidationOptions,
): SemanticDiagnostic[] {
  const diagnostics: SemanticDiagnostic[] = [];

  checkDuplicates(index, diagnostics);
  checkFragmentSpreads(index, diagnostics);
  checkMappingRefs(index, diagnostics);
  checkMetricRefs(index, diagnostics);
  checkNLRefs(index, diagnostics);
  checkArrowFieldRefs(index, diagnostics);
  checkTransformSpreads(index, diagnostics);
  checkRefMetadata(index, diagnostics);
  if (options.reachability) {
    checkImportScope(index, options.reachability, diagnostics, options.importScopeDiagnostic);
  }

  return diagnostics;
}

// ---------- Section 1: Duplicate definitions ----------

/**
 * Report every entry in the duplicates log. Two sub-cases:
 *   - namespace-metadata-conflict: conflicting @label values in the same namespace
 *   - duplicate-definition: same name used for two entities (possibly of different kinds)
 */
function checkDuplicates(index: SemanticIndex, diagnostics: SemanticDiagnostic[]): void {
  for (const dup of index.duplicates ?? []) {
    // kind "namespace-metadata" is how the index builder records conflicting
    // namespace-level metadata (e.g. two files disagree on the @note for "pos").
    if (dup.kind === "namespace-metadata") {
      diagnostics.push({
        file: dup.file,
        line: dup.row + 1,
        column: 1,
        severity: "error",
        rule: "namespace-metadata-conflict",
        message: `Namespace '${dup.name}' has conflicting '${dup.tag}' values: "${dup.value}" vs "${dup.previousValue}" in ${dup.previousFile}:${dup.previousRow + 1}`,
      });
      continue;
    }
    const sameKind = dup.kind === dup.previousKind;
    const msg = sameKind
      ? `${capitalize(dup.kind)} '${dup.name}' is already defined in ${dup.previousFile}:${dup.previousRow + 1}`
      : `${capitalize(dup.kind)} '${dup.name}' conflicts with ${dup.previousKind} already defined in ${dup.previousFile}:${dup.previousRow + 1}`;
    diagnostics.push({
      file: dup.file,
      line: dup.row + 1,
      column: 1,
      severity: "error",
      rule: "duplicate-definition",
      message: msg,
    });
  }
}

// ---------- Section 2: Fragment spread references ----------

/**
 * A schema that spreads a fragment must reference a fragment that exists in
 * the index. Cross-namespace spreads require a qualified reference.
 */
function checkFragmentSpreads(index: SemanticIndex, diagnostics: SemanticDiagnostic[]): void {
  for (const [name, schema] of index.schemas) {
    const currentNs = schema.namespace ?? null;
    for (const spread of (schema.spreads ?? [])) {
      if (!resolveScopedEntityRef(spread, currentNs, index.fragments as Map<string, unknown>)) {
        diagnostics.push({
          file: schema.file,
          line: schema.row + 1,
          column: 1,
          severity: "warning",
          rule: "undefined-ref",
          message: `Schema '${name}' spreads undefined fragment '${spread}'`,
        });
      }
    }
  }
}

// ---------- Section 3: Mapping source/target references ----------

/**
 * Every schema reference in a mapping's source and target lists must resolve
 * to a known schema or fragment. A hint is appended when the name exists in
 * another namespace, making the likely fix obvious.
 */
function checkMappingRefs(index: SemanticIndex, diagnostics: SemanticDiagnostic[]): void {
  const allDefinitions = new Map([
    ...index.schemas as Map<string, unknown>,
    ...index.fragments as Map<string, unknown>,
  ]);

  for (const [name, mapping] of index.mappings) {
    const currentNs = mapping.namespace ?? null;
    for (const src of mapping.sources) {
      if (!resolveScopedEntityRef(src, currentNs, allDefinitions)) {
        let msg = `Mapping '${name}' references undefined source '${src}'`;
        const hints = suggestAlternatives(src, allDefinitions);
        if (hints.length > 0) msg += `\n  hint: did you mean ${hints.map((h) => `'${h}'`).join(" or ")}?`;
        diagnostics.push({ file: mapping.file, line: mapping.row + 1, column: 1, severity: "warning", rule: "undefined-ref", message: msg });
      }
    }
    for (const tgt of mapping.targets) {
      if (!resolveScopedEntityRef(tgt, currentNs, allDefinitions)) {
        let msg = `Mapping '${name}' references undefined target '${tgt}'`;
        const hints = suggestAlternatives(tgt, allDefinitions);
        if (hints.length > 0) msg += `\n  hint: did you mean ${hints.map((h) => `'${h}'`).join(" or ")}?`;
        diagnostics.push({ file: mapping.file, line: mapping.row + 1, column: 1, severity: "warning", rule: "undefined-ref", message: msg });
      }
    }
  }
}

// ---------- Section 4: Metric source references ----------

/**
 * Metric source references must resolve to known schemas (not fragments).
 */
function checkMetricRefs(index: SemanticIndex, diagnostics: SemanticDiagnostic[]): void {
  for (const [name, metric] of index.metrics) {
    const currentNs = metric.namespace ?? null;
    for (const src of (metric.sources ?? [])) {
      if (!resolveScopedEntityRef(src, currentNs, index.schemas as Map<string, unknown>)) {
        diagnostics.push({
          file: metric.file,
          line: metric.row + 1,
          column: 1,
          severity: "warning",
          rule: "undefined-ref",
          message: `Metric '${name}' references undefined source '${src}'`,
        });
      }
    }
  }
}

// ---------- Section 5: NL @ref validation ----------

/**
 * @refs in NL transform text must resolve to known workspace entities AND
 * must reference schemas that appear in the mapping's source or target list.
 *
 * Note contexts (file-level, schema-level, metric-level) are checked for
 * unresolved refs but not for source-list membership — notes have no binding
 * mapping context so source-list checks are always meaningless there.
 *
 * Rule names match lint-engine.ts so that consumers running both commands can
 * deduplicate by (rule, file, line, column).
 */
function checkNLRefs(index: SemanticIndex, diagnostics: SemanticDiagnostic[]): void {
  if (!index.nlRefData) return;

  for (const item of index.nlRefData) {
    const refs = extractAtRefs(item.text);
    const mappingKey = item.namespace ? `${item.namespace}::${item.mapping}` : item.mapping;
    const mapping = index.mappings.get(mappingKey);
    const mappingContext = {
      sources: mapping?.sources ?? [],
      targets: mapping?.targets ?? [],
      namespace: item.namespace,
    };

    // Note contexts have no source/target list, so hidden-source checks are
    // suppressed. Unresolved-ref checks still apply — an @ref in a note should
    // resolve to some known workspace entity. Tested against item.mapping, not
    // mappingKey: the key is namespace-qualified first ("crm::note:schema:foo"),
    // which would hide the note: scope prefix for namespaced notes (sl-1don).
    const isNoteContext = item.mapping.startsWith("note:");

    // Build a human-readable scope label for diagnostic messages.
    // Strip internal prefixes (e.g. "note:metric:") so messages say
    // "in metric 'revenue'" rather than "in mapping 'note:metric:revenue'".
    const displayScope = isNoteContext
      ? noteDisplayScope(item.mapping, item.namespace)
      : `mapping '${mappingKey}'`;

    const lookup = makeSemanticLookup(index);

    for (const { ref, offset } of refs) {
      const classification = classifyRef(ref);
      const resolution = resolveRef(ref, mappingContext, lookup);
      const { line, column } = computeNLRefPosition(item, offset);

      if (!resolution.resolved) {
        // Rule name "unresolved-nl-ref" matches lint-engine.ts for consistency (sl-tslm).
        diagnostics.push({
          file: item.file,
          line,
          column,
          severity: "warning",
          rule: "unresolved-nl-ref",
          message: `NL reference \`${ref}\` in ${displayScope} does not resolve to any known identifier`,
        });
      } else if (!isNoteContext) {
        // Check that a resolved schema ref is part of the mapping's source/target list.
        // Note contexts are excluded — they have no binding source/target list.
        const referencedSchema = extractReferencedSchema(classification, resolution, index);
        if (referencedSchema && !isSchemaInMappingSources(referencedSchema, mapping)) {
          diagnostics.push({
            file: item.file,
            line,
            column,
            severity: "warning",
            rule: "nl-ref-not-in-source",
            message: `NL reference \`${ref}\` in mapping '${mappingKey}' is not declared in its source or target list`,
          });
        }
      }
    }
  }
}

/**
 * Build a human-readable scope label for a note-context NL ref item.
 * Strips internal prefixes (e.g. "note:metric:") so messages say
 * "in metric 'revenue'" rather than "in mapping 'note:metric:revenue'".
 */
function noteDisplayScope(mapping: string, namespace: string | null): string {
  const entityName = stripNLRefScopePrefix(mapping);
  const qualifiedName = namespace && entityName !== "(file-level note)"
    ? `${namespace}::${entityName}`
    : entityName;

  if (mapping === "note:") return "file-level note";
  if (mapping.startsWith("note:metric:")) return `metric '${qualifiedName}'`;
  if (mapping.startsWith("note:schema:")) return `schema '${qualifiedName}'`;
  if (mapping.startsWith("note:fragment:")) return `fragment '${qualifiedName}'`;
  return `note '${qualifiedName}'`;
}

/**
 * Extract the schema key from a resolved @ref, used to check mapping membership.
 * Returns null when the ref doesn't point to a schema directly or via a field.
 */
function extractReferencedSchema(
  classification: string,
  resolution: { resolved: boolean; resolvedTo: { kind: string; name: string } | null },
  index: SemanticIndex,
): string | null {
  if (classification === "namespace-qualified-schema" || classification === "bare") {
    if (resolution.resolvedTo?.kind === "schema") return resolution.resolvedTo.name;
  } else if (classification === "dotted-field" || classification === "namespace-qualified-field") {
    if (resolution.resolvedTo?.kind === "field") {
      const fieldPath = resolution.resolvedTo.name;
      const parts = fieldPath.split(".");
      for (let i = parts.length - 1; i > 0; i--) {
        const candidate = parts.slice(0, i).join(".");
        if (index.schemas.has(candidate)) return candidate;
      }
      if (fieldPath.includes("::")) {
        const dotIdx = fieldPath.indexOf(".", fieldPath.indexOf("::") + 2);
        if (dotIdx > 0) return fieldPath.slice(0, dotIdx);
      }
    }
  }
  return null;
}

// ---------- Section 6: Arrow field references ----------

/**
 * Arrow source and target paths must be declared in the mapping's source/target
 * schemas. Convention-inferred fields (Data Vault, Kimball) are excluded from
 * false-positive reporting. Field checks are suppressed for schemas with
 * unresolved spreads (can't know their full field set).
 */
function checkArrowFieldRefs(index: SemanticIndex, diagnostics: SemanticDiagnostic[]): void {
  if (!index.fieldArrows) return;

  // De-duplicate arrows (the same arrow may appear under multiple index keys).
  const seenArrows = new Set<SemanticArrow>();
  const uniqueArrows: SemanticArrow[] = [];
  for (const [, arrows] of index.fieldArrows) {
    for (const arrow of arrows) {
      if (!seenArrows.has(arrow)) { seenArrows.add(arrow); uniqueArrows.push(arrow); }
    }
  }

  // Use the index key (not just mapping.name) so that anonymous mappings
  // (name=null, key="<anon>@path:row") can be matched against arrow.mapping
  // (which carries the same synthetic key). Named mappings still match by name.
  for (const [indexKey, mapping] of index.mappings) {
    const currentNs = mapping.namespace ?? null;
    // For namespaced anonymous mappings the key is "ns::<anon>@path:row" — strip
    // the namespace prefix so we can compare against arrow.mapping directly.
    const bareIndexKey = currentNs ? indexKey.slice(currentNs.length + 2) : indexKey;

    const resolvedSrcKeys = mapping.sources
      .map((s) => resolveScopedEntityRef(s, currentNs, index.schemas as Map<string, unknown>))
      .filter((k): k is string => k != null);
    const resolvedTgtKey = mapping.targets[0]
      ? resolveScopedEntityRef(mapping.targets[0], currentNs, index.schemas as Map<string, unknown>)
      : null;

    const srcSchema = resolvedSrcKeys[0];

    // Build the set of valid source field paths (flat, possibly multi-schema).
    const srcFieldPaths = new Set<string>();
    for (const s of resolvedSrcKeys) {
      collectFieldPaths(index.schemas.get(s)?.fields ?? [], "", srcFieldPaths);
    }
    if (resolvedSrcKeys.length > 1) {
      for (let i = 0; i < mapping.sources.length; i++) {
        const key = resolveScopedEntityRef(mapping.sources[i]!, currentNs, index.schemas as Map<string, unknown>);
        if (!key) continue;
        collectFieldPaths(index.schemas.get(key)?.fields ?? [], mapping.sources[i]! + ".", srcFieldPaths);
      }
    }

    const tgtFieldPaths = new Set<string>();
    collectFieldPaths(resolvedTgtKey ? (index.schemas.get(resolvedTgtKey)?.fields ?? []) : [], "", tgtFieldPaths);

    // Expand spreads; suppress field checks if any spread is unresolvable.
    const resolveRef = (ref: string, _ns: string | null) =>
      resolveScopedEntityRef(ref, currentNs, index.fragments as Map<string, unknown>);
    const lookupFragment = (key: string): SpreadEntity | undefined => {
      const f = index.fragments.get(key);
      return f ? { fields: f.fields, hasSpreads: f.hasSpreads ?? false, spreads: f.spreads, file: f.file, row: f.row } : undefined;
    };
    const lookupSchema = (key: string): SpreadEntity | undefined => {
      const s = index.schemas.get(key);
      return s ? { fields: s.fields, hasSpreads: s.hasSpreads ?? false, spreads: s.spreads, file: s.file, row: s.row } : undefined;
    };
    const srcHasUnresolved = expandSpreads(resolvedSrcKeys, currentNs, resolveRef, lookupFragment, srcFieldPaths, diagnostics as never[], lookupSchema);
    const tgtHasUnresolved = resolvedTgtKey
      ? expandSpreads([resolvedTgtKey], currentNs, resolveRef, lookupFragment, tgtFieldPaths, diagnostics as never[], lookupSchema)
      : false;

    // Add convention-inferred fields so they don't trigger false positives.
    for (const key of resolvedSrcKeys) {
      const sch = index.schemas.get(key);
      if (sch) for (const f of getConventionFields(sch)) srcFieldPaths.add(f);
    }
    for (let i = 0; i < mapping.sources.length; i++) {
      const key = resolveScopedEntityRef(mapping.sources[i]!, currentNs, index.schemas as Map<string, unknown>);
      if (!key) continue;
      const sch = index.schemas.get(key);
      if (sch) for (const f of getConventionFields(sch)) srcFieldPaths.add(`${mapping.sources[i]}.${f}`);
    }
    if (resolvedTgtKey) {
      const sch = index.schemas.get(resolvedTgtKey);
      if (sch) for (const f of getConventionFields(sch)) tgtFieldPaths.add(f);
    }

    for (const arrow of uniqueArrows) {
      // Named mappings match by bare name; anonymous mappings (name=null) match
      // by the synthetic index key (e.g. "<anon>@path:row") stored in arrow.mapping.
      const mappingMatch = mapping.name !== null
        ? arrow.mapping === mapping.name
        : arrow.mapping === bareIndexKey;
      if (!mappingMatch || (arrow.namespace ?? null) !== currentNs) continue;
      if (arrow.file !== mapping.file) continue; // guard against cross-file duplicate mapping names

      for (const source of arrow.sources) {
        if (
          srcSchema && index.schemas.has(srcSchema) && !srcHasUnresolved &&
          !resolveFieldPath(source, resolvedSrcKeys, index, srcFieldPaths)
        ) {
          diagnostics.push({
            file: arrow.file, line: arrow.line + 1, column: 1, severity: "warning",
            rule: "field-not-in-schema",
            message: `Arrow source '${source}' not declared in schema '${srcSchema}'`,
          });
        }
      }
      if (
        arrow.target && resolvedTgtKey && index.schemas.has(resolvedTgtKey) && !tgtHasUnresolved &&
        !resolveFieldPath(arrow.target, [resolvedTgtKey], index, tgtFieldPaths)
      ) {
        diagnostics.push({
          file: arrow.file, line: arrow.line + 1, column: 1, severity: "warning",
          rule: "field-not-in-schema",
          message: `Arrow target '${arrow.target}' not declared in schema '${resolvedTgtKey}'`,
        });
      }
    }
  }
}

// ---------- Section 7: Transform spread references ----------

/**
 * Fragment spread steps inside arrow transforms (...fragName) must reference
 * a known transform (not a schema fragment — these are transform fragments).
 */
function checkTransformSpreads(index: SemanticIndex, diagnostics: SemanticDiagnostic[]): void {
  if (!index.fieldArrows) return;
  const seen = new Set<SemanticArrow>();
  for (const [, arrows] of index.fieldArrows) {
    for (const arrow of arrows) {
      if (seen.has(arrow)) continue;
      seen.add(arrow);
      for (const step of arrow.steps ?? []) {
        if (step.type === "fragment_spread") {
          const spreadName = step.text.replace(/^\.\.\./, "");
          const currentNs = arrow.namespace ?? null;
          if (!resolveScopedEntityRef(spreadName, currentNs, index.transforms)) {
            diagnostics.push({
              file: arrow.file, line: arrow.line + 1, column: 1, severity: "warning",
              rule: "undefined-ref",
              message: `Arrow in mapping '${arrow.mapping}' spreads undefined transform '${spreadName}'`,
            });
          }
        }
      }
    }
  }
}

// ---------- Section 8: Ref metadata targets ----------

/**
 * Fields annotated with (ref @schema) or (ref @schema.field) must point to a
 * known schema. Recurses into record children.
 */
function checkRefMetadata(index: SemanticIndex, diagnostics: SemanticDiagnostic[]): void {
  for (const [schemaName, schema] of index.schemas) {
    checkFieldRefMetadata(schema.fields, schemaName, schema.file, schema.row, schema.namespace ?? null, index, diagnostics);
  }
  for (const [fragName, frag] of index.fragments) {
    checkFieldRefMetadata(frag.fields, fragName, frag.file, frag.row, frag.namespace ?? null, index, diagnostics);
  }
}

function checkFieldRefMetadata(
  fields: FieldDecl[],
  entityName: string,
  file: string,
  row: number,
  currentNs: string | null,
  index: SemanticIndex,
  diagnostics: SemanticDiagnostic[],
): void {
  for (const field of fields) {
    if (field.metadata) {
      for (const m of field.metadata) {
        if (m.kind === "kv" && m.key === "ref") {
          const refTarget = m.value.replace(/^@/, "").split(".")[0]!;
          if (!resolveScopedEntityRef(refTarget, currentNs, index.schemas as Map<string, unknown>)) {
            diagnostics.push({
              file, line: row + 1, column: 1, severity: "warning",
              rule: "undefined-ref",
              message: `Field '${field.name}' in '${entityName}' references undefined schema '${refTarget}' via (ref ${m.value})`,
            });
          }
        }
      }
    }
    if (field.children) {
      checkFieldRefMetadata(field.children, entityName, file, row, currentNs, index, diagnostics);
    }
  }
}

// ---------- Section 9: Import scope (ADR-022) ----------

/**
 * Verify that every cross-file reference is reachable through the file's
 * import declarations. A symbol that exists in the workspace but is not in
 * the file's reachable set is an import-scope violation.
 *
 * This check is additive: existing checks (sections 2-8) validate against the
 * full index, catching genuinely undefined refs. This check catches refs that
 * exist but are out of scope — a distinct error class with a distinct fix
 * ("add an import" vs "fix the typo").
 *
 * Skipped when no reachability data is provided (single-file workspaces,
 * backward-compatible callers).
 */
function checkImportScope(
  index: SemanticIndex,
  reachability: ImportReachability,
  diagnostics: SemanticDiagnostic[],
  policy: ImportScopeDiagnosticPolicy = {},
): void {
  const allDefinitions = new Map<string, unknown>([
    ...index.schemas as Map<string, unknown>,
    ...index.fragments as Map<string, unknown>,
  ]);

  // Helper: check if a resolved symbol key is reachable from a given file.
  // Returns false (no diagnostic) when the symbol is undefined — that's
  // already handled by undefined-ref checks.
  function checkRef(
    ref: string,
    currentNs: string | null,
    lookupMap: Map<string, unknown>,
    file: string,
    entityKind: string,
    entityName: string,
    row: number,
    refKind: string,
  ): void {
    const resolved = resolveScopedEntityRef(ref, currentNs, lookupMap);
    if (!resolved) return; // Undefined — handled by other checks
    const reachable = reachability.reachableSymbols.get(file);
    if (!reachable) return; // No reachability data for this file
    if (reachable.has(resolved)) return; // In scope — all good
    const violation: ImportScopeViolation = {
      file,
      row,
      entityKind,
      entityName,
      refKind,
      ref,
      resolved,
      definitionFile: definitionFileFor(lookupMap.get(resolved)),
    };

    diagnostics.push({
      file,
      line: row + 1,
      column: 1,
      severity: "error",
      rule: policy.rule ?? "import-scope",
      message: policy.message?.(violation)
        ?? `${capitalize(entityKind)} '${entityName}' references ${refKind} '${resolved}' which is not reachable from this file's imports`,
    });
  }

  // --- Schema spread fragments ---
  for (const [name, schema] of index.schemas) {
    for (const spread of (schema.spreads ?? [])) {
      checkRef(spread, schema.namespace ?? null, index.fragments as Map<string, unknown>,
        schema.file, "schema", name, schema.row, "fragment");
    }
  }

  // --- Fragment spread fragments ---
  for (const [name, fragment] of index.fragments) {
    for (const spread of (fragment.spreads ?? [])) {
      checkRef(spread, fragment.namespace ?? null, index.fragments as Map<string, unknown>,
        fragment.file, "fragment", name, fragment.row, "fragment");
    }
  }

  // --- Mapping source/target refs ---
  for (const [name, mapping] of index.mappings) {
    const ns = mapping.namespace ?? null;
    for (const src of mapping.sources) {
      checkRef(src, ns, allDefinitions, mapping.file, "mapping", name ?? "<anonymous>", mapping.row, "source");
    }
    for (const tgt of mapping.targets) {
      checkRef(tgt, ns, allDefinitions, mapping.file, "mapping", name ?? "<anonymous>", mapping.row, "target");
    }
  }

  // --- Metric source refs ---
  for (const [name, metric] of index.metrics) {
    const ns = metric.namespace ?? null;
    for (const src of (metric.sources ?? [])) {
      checkRef(src, ns, index.schemas as Map<string, unknown>,
        metric.file, "metric", name, metric.row, "source");
    }
  }

  // --- Transform spread refs in arrows ---
  if (index.fieldArrows) {
    const seen = new Set<object>();
    for (const [, arrows] of index.fieldArrows) {
      for (const arrow of arrows) {
        if (seen.has(arrow)) continue;
        seen.add(arrow);
        for (const step of arrow.steps ?? []) {
          if (step.type === "fragment_spread") {
            const spreadName = step.text.replace(/^\.\.\./, "");
            const ns = arrow.namespace ?? null;
            const resolved = resolveScopedEntityRef(spreadName, ns, index.transforms);
            if (!resolved) continue;
            const reachable = reachability.reachableSymbols.get(arrow.file);
            if (!reachable || reachable.has(resolved)) continue;
            diagnostics.push({
              file: arrow.file,
              line: arrow.line + 1,
              column: 1,
              severity: "error",
              rule: policy.rule ?? "import-scope",
              message: policy.message?.({
                file: arrow.file,
                row: arrow.line,
                entityKind: "arrow",
                entityName: arrow.mapping ?? "<anonymous>",
                refKind: "transform",
                ref: spreadName,
                resolved,
                definitionFile: definitionFileFor(index.transforms.get(resolved)),
              }) ?? `Arrow in mapping '${arrow.mapping}' references transform '${resolved}' which is not reachable from this file's imports`,
            });
          }
        }
      }
    }
  }
}

function definitionFileFor(definition: unknown): string | null {
  if (!definition || typeof definition !== "object") return null;
  const file = (definition as { file?: unknown }).file;
  return typeof file === "string" ? file : null;
}

// ---------- Helpers ----------

/**
 * Suggest fully-qualified alternatives when a bare name exists in other namespaces.
 * Only fires for unqualified refs — callers of ns::name already know exactly what they want.
 */
function suggestAlternatives(ref: string, entityMap: Map<string, unknown>): string[] {
  if (ref.includes("::")) return [];
  const hints: string[] = [];
  for (const key of entityMap.keys()) {
    if (key.endsWith(`::${ref}`)) hints.push(key);
  }
  return hints;
}

// ---------- Convention field tables ----------
//
// These constants enumerate the field names that Data Vault and Kimball standards
// place on each entity type by convention. They are used in getConventionFields()
// to suppress "field not in schema" false positives for columns that are populated
// by the ETL layer and therefore not declared in the schema body.
//
// Sources: Data Vault 2.0 standard (Linstedt & Olschimke, 2nd ed.);
//          The Data Warehouse Toolkit (Kimball & Ross, 3rd ed.).
// These lists are opinionated approximations — full implementations vary, and we
// cover the most common field names seen in practice rather than every possible variant.

/** Standard audit columns on a Data Vault hub. The composite hash key ({name}_hk) is derived separately. */
const DV_HUB_FIELDS = ["load_date", "record_source"] as const;

/** Standard audit columns on a Data Vault link. Hash key and hub foreign keys are derived separately. */
const DV_LINK_FIELDS = ["load_date", "record_source"] as const;

/** Full set of standard DV satellite audit columns. The parent hash key ({parent}_hk) is derived separately. */
const DV_SAT_FIELDS = ["load_date", "load_end_date", "hash_diff", "record_source"] as const;

/** Slowly-changing dimension tracking columns added to Kimball dimensions under scd: 2 or scd: 6. */
const KIMBALL_SCD_FIELDS = ["surrogate_key", "valid_from", "valid_to", "is_current", "row_hash"] as const;

/** ETL audit columns present on all Kimball fact tables. */
const KIMBALL_FACT_FIELDS = ["etl_batch_id", "loaded_at"] as const;

/**
 * Return the set of convention-inferred field names for a schema based on its metadata tags.
 *
 * Fields listed here are implicitly present by Data Vault or Kimball convention —
 * populated by the ETL layer, not declared in the schema body. Adding them to the
 * valid-path set prevents false "field not in schema" warnings on arrows that
 * target these columns. See the DV_* and KIMBALL_* constants for the specific sets.
 *
 * The lists are opinionated approximations and do not constitute a full implementation
 * of either standard.
 */
function getConventionFields(schema: SemanticSchema): Set<string> {
  const fields = new Set<string>();
  const meta = schema.blockMetadata ?? [];
  const tags = new Set(meta.filter((m): m is MetaEntry & { kind: "tag" } => m.kind === "tag").map((m) => m.tag));
  const kvs = meta.filter((m): m is MetaEntry & { kind: "kv" } => m.kind === "kv");

  // --- Data Vault 2.0 conventions ---

  if (tags.has("hub")) {
    // Hub: composite business-key hash + standard DV audit columns
    fields.add(`${schema.name}_hk`);
    for (const f of DV_HUB_FIELDS) fields.add(f);
  }

  if (tags.has("link")) {
    // Link: composite hash key + DV audit columns + a hash key per linked hub (from link_hubs metadata)
    fields.add(`${schema.name}_hk`);
    for (const f of DV_LINK_FIELDS) fields.add(f);
    for (const kv of kvs) {
      if (kv.key === "link_hubs") {
        for (const hub of kv.value.split(",").map((h) => h.trim())) {
          fields.add(`${hub}_hk`);
        }
      }
    }
  }

  if (tags.has("satellite")) {
    // Satellite: full DV audit columns + parent entity hash key (from parent metadata)
    for (const f of DV_SAT_FIELDS) fields.add(f);
    for (const kv of kvs) {
      if (kv.key === "parent") fields.add(`${kv.value}_hk`);
    }
  }

  // --- Kimball dimensional modelling conventions ---

  if (tags.has("dimension")) {
    // SCD types 2 and 6 add slowly-changing dimension history tracking columns
    const hasScd2or6 = kvs.some((kv) => kv.key === "scd" && (kv.value === "2" || kv.value === "6"));
    if (hasScd2or6) {
      for (const f of KIMBALL_SCD_FIELDS) fields.add(f);
    }
  }

  if (tags.has("fact")) {
    // All fact tables carry ETL batch audit columns
    for (const f of KIMBALL_FACT_FIELDS) fields.add(f);
  }

  return fields;
}

/**
 * Resolve an arrow field path against the known field paths for the mapping's schema.
 * Returns true when the path is valid (no diagnostic needed).
 *
 * Special cases:
 *  - Paths starting with "." are always valid (computed / expression paths).
 *  - The schema name itself is valid (for container arrows targeting the schema root).
 *  - Qualified paths like "source_schema.field" are resolved by stripping the prefix.
 */
function resolveFieldPath(path: string, schemaNames: string[], index: SemanticIndex, fieldPaths: Set<string>): boolean {
  if (path.startsWith(".")) return true;
  if (fieldPaths.has(path)) return true;
  if (schemaNames.includes(path)) return true;

  const dotIdx = path.indexOf(".");
  if (dotIdx > 0) {
    const qualifier = path.slice(0, dotIdx);
    const matchedSchema = schemaNames.find((s) => {
      if (s === qualifier) return true;
      const nsIdx = s.indexOf("::");
      return nsIdx !== -1 && s.slice(nsIdx + 2) === qualifier;
    });
    if (matchedSchema) {
      const rest = path.slice(dotIdx + 1);
      const qualPaths = new Set<string>();
      collectFieldPaths(index.schemas.get(matchedSchema)?.fields ?? [], "", qualPaths);
      if (qualPaths.has(rest)) return true;
    }
  }
  return false;
}

/**
 * Build a DefinitionLookup (for resolveRef in nl-ref.ts) from a SemanticIndex.
 * The lookup bridges the callback interface to the SemanticIndex's Maps.
 */
function makeSemanticLookup(index: SemanticIndex): DefinitionLookup {
  return {
    hasSchema: (key) => index.schemas.has(key),
    getSchema: (key) => {
      const s = index.schemas.get(key);
      return s ? { fields: s.fields, hasSpreads: s.hasSpreads ?? false, spreads: s.spreads, namespace: s.namespace } : null;
    },
    hasFragment: (key) => index.fragments.has(key),
    getFragment: (key) => {
      const f = index.fragments.get(key);
      return f ? { fields: f.fields, hasSpreads: f.hasSpreads ?? false, spreads: f.spreads } : null;
    },
    hasTransform: (key) => index.transforms.has(key),
    getMapping: (key) => {
      const m = index.mappings.get(key);
      return m ? { sources: m.sources, targets: m.targets, namespace: m.namespace ?? null } : null;
    },
    iterateSchemas: () => index.schemas.entries() as unknown as Iterable<[string, { fields: FieldDecl[]; hasSpreads: boolean; namespace?: string | null; spreads?: string[] }]>,
  };
}
