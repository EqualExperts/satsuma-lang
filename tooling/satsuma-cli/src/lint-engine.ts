/**
 * lint-engine.ts — Lint rule registry, runner, and fix applier
 *
 * Provides a policy-oriented linting layer on top of the shared
 * parser/index pipeline.  Rules receive a ExtractedWorkspace and return
 * LintDiagnostic objects.  Fixable rules additionally supply a LintFix
 * whose `apply` function rewrites source text deterministically.
 */

import { capitalize, stripNLRefScopePrefix } from "@satsuma/core";
import {
  extractAtRefs,
  computeNLRefPosition,
  classifyRef,
  resolveRef,
  isSchemaInMappingSources,
} from "./nl-ref-extract.js";
import { resolveCanonicalKey } from "./index-builder.js";
import type { LintDiagnostic, LintFix, LintRule, ExtractedWorkspace } from "./types.js";

// ── Rule registry ──────────────────────────────────────────────────────────

export const RULES: LintRule[] = [
  {
    id: "hidden-source-in-nl",
    description: "NL references schema not in source/target list",
    check: checkHiddenSourceInNl,
  },
  {
    id: "unresolved-nl-ref",
    description: "NL @ref does not resolve",
    check: checkUnresolvedNlRef,
  },
  {
    id: "duplicate-definition",
    description: "Named definition is declared more than once in a namespace",
    check: checkDuplicateDefinition,
  },
];

// ── Rule implementations ───────────────────────────────────────────────────

function checkHiddenSourceInNl(index: ExtractedWorkspace): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  if (!index.nlRefData) return diagnostics;

  for (const item of index.nlRefData) {
    const refs = extractAtRefs(item.text);
    const mappingKey = item.namespace
      ? `${item.namespace}::${item.mapping}`
      : item.mapping;
    const mapping = index.mappings.get(mappingKey);
    if (!mapping) continue;

    const mappingContext = {
      sources: mapping.sources ?? [],
      targets: mapping.targets ?? [],
      namespace: item.namespace,
    };

    for (const { ref, raw, offset } of refs) {
      // raw keeps backtick quoting so literal names with "." / "::" classify
      // and resolve correctly (sl-g6ga); ref is the flattened display form.
      const classification = classifyRef(raw);
      const resolution = resolveRef(raw, mappingContext, index);

      if (!resolution.resolved) continue;

      // Determine the schema name being referenced
      let referencedSchema: string | null = null;
      if (classification === "namespace-qualified-schema" || classification === "bare") {
        // Bare or ns-qualified schema name — check if it resolves to a schema
        if (resolution.resolvedTo?.kind === "schema") {
          referencedSchema = resolution.resolvedTo.name;
        }
      } else if (classification === "dotted-field" || classification === "namespace-qualified-field") {
        // Dotted field ref like `hidden.code` — extract the schema part.
        // Use the FIRST dot (after any `::` prefix) so that nested sub-field
        // paths like `schema.RECORD.CHILD` correctly yield the schema name
        // rather than `schema.RECORD`.
        if (resolution.resolvedTo?.kind === "field") {
          const fieldName = resolution.resolvedTo.name;
          const nsEnd = fieldName.indexOf("::");
          const firstDot = fieldName.indexOf(".", nsEnd >= 0 ? nsEnd + 2 : 0);
          if (firstDot > 0) {
            referencedSchema = fieldName.slice(0, firstDot);
          }
        }
      }

      if (referencedSchema && !isSchemaInMappingSources(referencedSchema, mapping)) {
        const { line, column } = computeNLRefPosition(item, offset);
        const displayRef = item.namespace && referencedSchema.startsWith(`${item.namespace}::`)
          ? referencedSchema.slice(item.namespace.length + 2)
          : referencedSchema;
        const sourceBlockFix = makeAddSourceFix(mappingKey, referencedSchema);
        const fixApply = item.targetField
          ? composeFixes(
              makeAddArrowSourceFix(mappingKey, referencedSchema, item.targetField),
              sourceBlockFix,
            )
          : sourceBlockFix;
        const fixDesc = item.targetField
          ? `Added '${displayRef}' to arrow source list and mapping source block in '${mappingKey}'`
          : `Added '${displayRef}' to source list of mapping '${mappingKey}'`;
        diagnostics.push({
          file: item.file,
          line,
          column,
          severity: "error",
          rule: "hidden-source-in-nl",
          message: `NL reference \`${ref}\` in mapping '${mappingKey}' is not declared in its source or target list`,
          fixable: true,
          fix: {
            file: item.file,
            rule: "hidden-source-in-nl",
            description: fixDesc,
            apply: fixApply,
          },
        });
      }
    }
  }

  return diagnostics;
}

/**
 * Build a fix closure that inserts `schemaRef` into the `source { }` block of the
 * named (or anonymous) mapping. The fix is text-based.
 *
 * Algorithm:
 *   1. Locate the mapping header by name or, for anonymous mappings, by 0-indexed
 *      row number encoded in the key as "<anon>@path:row".
 *   2. Track brace depth to stay inside the mapping body and stop at its closing `}`.
 *   3. Find the single-line `source { ... }` form and append `insertRef` to its list.
 *   4. If the ref is already present (qualified or unqualified), return source unchanged.
 */
function makeAddSourceFix(mappingKey: string, schemaRef: string): (source: string) => string {
  const nsIdx = mappingKey.indexOf("::");
  const displayName = nsIdx !== -1
    ? mappingKey.slice(nsIdx + 2)
    : mappingKey;
  const mappingNs = nsIdx !== -1 ? mappingKey.slice(0, nsIdx) : null;

  // Convert canonical ref (::name) back to source-level form for insertion
  let insertRef = resolveCanonicalKey(schemaRef);
  if (mappingNs && schemaRef.startsWith(`${mappingNs}::`)) {
    insertRef = schemaRef.slice(mappingNs.length + 2);
  }

  // Anonymous mappings have no name — encode the 0-indexed row so we can
  // locate them by source position instead of by label text.
  const anonMatch = displayName.match(/^<anon>@.+:(\d+)$/);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: anonMatch[1] is always defined when anonMatch is truthy (regex has a capture group)
  const anonRow = anonMatch ? parseInt(anonMatch[1]!, 10) : null;

  return (source: string): string => {
    const lines = source.split("\n");
    let inMapping = false;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: i is within lines.length bounds
      const trimmed = lines[i]!.trim();

      // Step 1: find the mapping header.
      // Named mappings: match by label text (backtick, double-quoted, or bare).
      // Anonymous mappings: match by 0-indexed row number stored in the key.
      if (!inMapping) {
        if (anonRow !== null) {
          // Anonymous mapping — located by source position, not by name.
          if (i === anonRow && /^mapping\b/.test(trimmed)) {
            inMapping = true;
            braceDepth = (trimmed.match(/\{/g) ?? []).length - (trimmed.match(/\}/g) ?? []).length;
          }
          continue;
        }
        const mappingRe = /^mapping\s+(?:`([^`]+)`|"([^"]+)"|(.+?))\s*(?:\(|$|\{)/;
        const m = trimmed.match(mappingRe);
        if (m) {
          const name = (m[1] ?? m[2] ?? m[3] ?? "").trim();
          if (name === displayName) {
            inMapping = true;
            braceDepth = (trimmed.match(/\{/g) ?? []).length - (trimmed.match(/\}/g) ?? []).length;
          }
        }
        continue;
      }

      // Step 2: track brace depth; stop when we exit the mapping body
      for (const ch of trimmed) {
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
      }
      if (braceDepth <= 0) break;

      // Step 3: find and rewrite the single-line `source { ref, ref }` form
      // Matches: `source { ... }` where `...` is the comma-separated ref list
      const sourceLineRe = /^source\s*\{([^}]*)\}\s*$/;
      const sm = trimmed.match(sourceLineRe);
      // Safe: sm[1] always matches when sm is non-null; lines[i] is within bounds; /^(\s*)/ always matches
      /* eslint-disable @typescript-eslint/no-non-null-assertion */
      if (sm) {
        const existing = sm[1]!.trim();
        // Step 4: skip if the ref is already present (qualified or unqualified)
        const existingRefs = existing.split(/\s*,\s*/).map((r) => r.replace(/^`|`$/g, ""));
        if (existingRefs.includes(schemaRef) || existingRefs.includes(insertRef)) return source;
        // Use backtick wrapping if existing entries use backticks, or always for spec compliance
        const useBackticks = existing.includes("`");
        const wrappedRef = useBackticks ? `\`${insertRef}\`` : insertRef;
        const indent = lines[i]!.match(/^(\s*)/)![1];
        const newRefs = existing ? `${existing}, ${wrappedRef}` : wrappedRef;
        lines[i] = `${indent}source { ${newRefs} }`;
        return lines.join("\n");
      }
      /* eslint-enable @typescript-eslint/no-non-null-assertion */
    }

    return source;
  };
}

function composeFixes(...fns: ((s: string) => string)[]): (s: string) => string {
  return (source: string): string => fns.reduce((s, fn) => fn(s), source);
}

/**
 * Build a fix closure that prepends `schemaRef` to the source list of the arrow
 * targeting `targetField` inside the named (or anonymous) mapping. The fix is text-based.
 *
 * Algorithm (mirrors makeAddSourceFix for the mapping-location phase):
 *   1. Locate the mapping header by name or, for anonymous mappings, by row number.
 *   2. Track brace depth to stay inside the mapping body.
 *   3. Find the arrow whose target matches `targetField` (bare or schema-qualified).
 *   4. Prepend `insertRef` to the arrow's source list before the `->`.
 *   5. If the ref is already present, return source unchanged.
 */
function makeAddArrowSourceFix(
  mappingKey: string,
  schemaRef: string,
  targetField: string,
): (source: string) => string {
  const nsIdx = mappingKey.indexOf("::");
  const displayName = nsIdx !== -1 ? mappingKey.slice(nsIdx + 2) : mappingKey;
  const mappingNs = nsIdx !== -1 ? mappingKey.slice(0, nsIdx) : null;

  let insertRef = resolveCanonicalKey(schemaRef);
  if (mappingNs && schemaRef.startsWith(`${mappingNs}::`)) {
    insertRef = schemaRef.slice(mappingNs.length + 2);
  }

  // Strip namespace prefix from targetField for matching inside namespace block
  let matchTarget = targetField;
  if (mappingNs && matchTarget.startsWith(`${mappingNs}::`)) {
    matchTarget = matchTarget.slice(mappingNs.length + 2);
  }
  // Also strip schema prefix — arrow targets in source use bare field names, not schema.field
  const dotIdx = matchTarget.indexOf(".");
  const bareTarget = dotIdx >= 0 ? matchTarget.slice(dotIdx + 1) : matchTarget;

  // Anonymous mappings: locate by row number encoded in the key.
  const anonMatch = displayName.match(/^<anon>@.+:(\d+)$/);
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: anonMatch[1] is always defined when anonMatch is truthy (regex has a capture group)
  const anonRow = anonMatch ? parseInt(anonMatch[1]!, 10) : null;

  // Safe: lines[i] accesses are within bounds; regex capture groups are guaranteed by match checks
  /* eslint-disable @typescript-eslint/no-non-null-assertion */
  return (source: string): string => {
    const lines = source.split("\n");
    let inMapping = false;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const trimmed = lines[i]!.trim();

      // Step 1: find the mapping header — named by label text or anonymous by row number.
      if (!inMapping) {
        if (anonRow !== null) {
          if (i === anonRow && /^mapping\b/.test(trimmed)) {
            inMapping = true;
            braceDepth = (trimmed.match(/\{/g) ?? []).length - (trimmed.match(/\}/g) ?? []).length;
          }
          continue;
        }
        const mappingRe = /^mapping\s+(?:`([^`]+)`|"([^"]+)"|(.+?))\s*(?:\(|$|\{)/;
        const m = trimmed.match(mappingRe);
        if (m) {
          const name = (m[1] ?? m[2] ?? m[3] ?? "").trim();
          if (name === displayName) {
            inMapping = true;
            braceDepth = (trimmed.match(/\{/g) ?? []).length - (trimmed.match(/\}/g) ?? []).length;
          }
        }
        continue;
      }

      // Step 2: track brace depth; stop when we exit the mapping body
      for (const ch of trimmed) {
        if (ch === "{") braceDepth++;
        else if (ch === "}") braceDepth--;
      }
      if (braceDepth <= 0) break;

      // Step 3: match an arrow line — `src -> target` or `src1, src2 -> target { ... }`
      // Captures: [1] source list, [2] target field, [3] optional trailing transform block
      const arrowMatch = trimmed.match(/^(.+?)\s*->\s*(.+?)(\s*\{.*)?$/);
      if (!arrowMatch) continue;

      const arrowTargetPart = arrowMatch[2]!.trim();
      // Match target by bare field name, ignoring any schema prefix or backticks
      const targetBare = arrowTargetPart.replace(/^`|`$/g, "");
      const targetDotIdx = targetBare.indexOf(".");
      const targetFieldOnly = targetDotIdx >= 0 ? targetBare.slice(targetDotIdx + 1) : targetBare;

      if (targetFieldOnly !== bareTarget && targetBare !== matchTarget) continue;

      // Step 5: skip if the ref is already in the source list
      const srcPart = arrowMatch[1]!.trim();
      const existingSrcs = srcPart.split(/\s*,\s*/).map((s) => s.replace(/^`|`$/g, ""));
      if (existingSrcs.some((s) => s === insertRef || s === schemaRef)) return source;

      // Step 4: prepend the new schema ref before the `->`
      const indent = lines[i]!.match(/^(\s*)/)![1];
      const rest = arrowMatch[2]! + (arrowMatch[3] ?? "");
      lines[i] = `${indent}${srcPart}, ${insertRef} -> ${rest}`;
      return lines.join("\n");
    }

    return source;
  };
  /* eslint-enable @typescript-eslint/no-non-null-assertion */
}

// Pipeline function names from SATSUMA-V2-SPEC.md §7.2 (pipeline step catalog).
// Used to suppress false-positive `unresolved-nl-ref` warnings: @ref tokens in NL
// strings that match a known pipeline function name are skips — they are transform
// instructions, not field or schema references.
//
// This list covers the commonly-used built-ins as of v2. It may not be exhaustive;
// if a valid function triggers a warning, add it here and cite the spec section.
const KNOWN_PIPELINE_FUNCTIONS = new Set([
  "trim", "lowercase", "uppercase", "coalesce", "round", "split", "first",
  "last", "to_utc", "to_iso8601", "parse", "null_if_empty", "null_if_invalid",
  "drop_if_invalid", "drop_if_null", "warn_if_invalid", "warn_if_null",
  "error_if_invalid", "error_if_null", "validate_email", "now_utc",
  "title_case", "escape_html", "truncate", "to_number", "prepend", "max_length",
]);

function checkUnresolvedNlRef(index: ExtractedWorkspace): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  if (!index.nlRefData) return diagnostics;

  for (const item of index.nlRefData) {
    const refs = extractAtRefs(item.text);
    const mappingKey = item.namespace
      ? `${item.namespace}::${item.mapping}`
      : item.mapping;
    const mapping = index.mappings.get(mappingKey);

    const mappingContext = {
      sources: mapping?.sources ?? [],
      targets: mapping?.targets ?? [],
      namespace: item.namespace,
    };

    // Classify the scope of this NL item so messages say "in metric 'revenue'"
    // rather than "in mapping 'note:metric:revenue'".
    //
    // stripNLRefScopePrefix("note:metric:revenue") → "revenue"
    // stripNLRefScopePrefix("note:schema:customers") → "customers"
    // stripNLRefScopePrefix("note:") → "(file-level note)"
    const isNoteContext = item.mapping.startsWith("note:");
    let scopeLabel = "mapping";
    let displayName = mappingKey; // default: full key for regular mapping contexts

    if (isNoteContext) {
      const entityName = stripNLRefScopePrefix(item.mapping);
      const nsEntityName = item.namespace && entityName !== "(file-level note)"
        ? `${item.namespace}::${entityName}`
        : entityName;

      if (item.mapping.startsWith("note:metric:")) {
        scopeLabel = "metric";
        displayName = nsEntityName;
        // Enrich mapping context with the metric's own source schemas so bare
        // field refs from that schema resolve correctly inside metric notes.
        const metric = index.metrics?.get(nsEntityName) ?? index.metrics?.get(entityName);
        if (metric) {
          mappingContext.sources = [...mappingContext.sources, ...(metric.sources ?? [])];
        }
      } else if (item.mapping.startsWith("note:schema:")) {
        scopeLabel = "schema";
        displayName = nsEntityName;
      } else if (item.mapping.startsWith("note:fragment:")) {
        scopeLabel = "fragment";
        displayName = nsEntityName;
      } else {
        // File-level note block (item.mapping === "note:").
        scopeLabel = "note";
        displayName = "file-level note";
      }
    } else if (item.mapping.startsWith("transform:")) {
      scopeLabel = "transform";
    }

    for (const { ref, raw, offset } of refs) {
      // Skip known pipeline function names — they appear in transform bodies and
      // are interpreted by the runtime, not resolved to workspace identifiers.
      if (KNOWN_PIPELINE_FUNCTIONS.has(ref)) continue;

      // For metric notes: suppress warnings for refs to the metric's own fields
      // (e.g. "@total_revenue" inside a metric that declares "total_revenue").
      if (item.mapping.startsWith("note:metric:")) {
        const entityName = stripNLRefScopePrefix(item.mapping);
        const nsEntityName = item.namespace ? `${item.namespace}::${entityName}` : entityName;
        const metric = index.metrics?.get(nsEntityName) ?? index.metrics?.get(entityName);
        if (metric && metric.fields.some((f) => f.name === ref)) continue;
      }

      // Resolve on the raw form — backticked literal names must not be
      // re-split on "." or "::" (sl-g6ga).
      const resolution = resolveRef(raw, mappingContext, index);
      if (!resolution.resolved) {
        const { line, column } = computeNLRefPosition(item, offset);
        diagnostics.push({
          file: item.file,
          line,
          column,
          severity: "warning",
          rule: "unresolved-nl-ref",
          message: `NL reference \`${ref}\` in ${scopeLabel} '${displayName}' does not resolve to any known identifier`,
          fixable: false,
        });
      }
    }
  }

  return diagnostics;
}

function checkDuplicateDefinition(index: ExtractedWorkspace): LintDiagnostic[] {
  const diagnostics: LintDiagnostic[] = [];
  if (!index.duplicates) return diagnostics;

  for (const dup of index.duplicates) {
    if (dup.kind === "namespace-metadata") continue;

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
      fixable: false,
    });
  }

  return diagnostics;
}

// ── Engine ─────────────────────────────────────────────────────────────────

interface LintOptions {
  select?: string[];
  ignore?: string[];
}

/**
 * Run all (or selected) lint rules against a ExtractedWorkspace.
 */
export function runLint(index: ExtractedWorkspace, opts: LintOptions = {}): LintDiagnostic[] {
  let rules: LintRule[] = RULES;
  if (opts.select?.length) {
    const set = new Set(opts.select);
    rules = rules.filter((r) => set.has(r.id));
  }
  if (opts.ignore?.length) {
    const set = new Set(opts.ignore);
    rules = rules.filter((r) => !set.has(r.id));
  }

  const diagnostics: LintDiagnostic[] = [];
  for (const rule of rules) {
    diagnostics.push(...rule.check(index));
  }

  diagnostics.sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column,
  );

  return diagnostics;
}

/**
 * Apply all fixable diagnostics.
 */
export function applyFixes(
  sourceByFile: Map<string, string>,
  diagnostics: LintDiagnostic[],
): { fixedFiles: Map<string, string>; appliedFixes: LintFix[] } {
  const fixable = diagnostics.filter((d) => d.fixable && d.fix);

  // Safe: d.fix is guaranteed non-null by the filter predicate above
  /* eslint-disable @typescript-eslint/no-non-null-assertion */
  const byFile = new Map<string, LintDiagnostic[]>();
  for (const d of fixable) {
    if (!byFile.has(d.fix!.file)) byFile.set(d.fix!.file, []);
    byFile.get(d.fix!.file)!.push(d);
  }

  const fixedFiles = new Map<string, string>();
  const appliedFixes: LintFix[] = [];

  for (const [file, fileDiags] of byFile) {
    const originalSource = sourceByFile.get(file);
    if (originalSource === undefined) continue;
    let source: string = originalSource;

    const sorted = [...fileDiags].sort((a, b) => b.line - a.line || b.column - a.column);
    for (const d of sorted) {
      const before = source;
      source = d.fix!.apply(source);
      if (source !== before) {
        appliedFixes.push(d.fix!);
      }
    }
  /* eslint-enable @typescript-eslint/no-non-null-assertion */

    if (source !== originalSource) {
      fixedFiles.set(file, source);
    }
  }

  return { fixedFiles, appliedFixes };
}
