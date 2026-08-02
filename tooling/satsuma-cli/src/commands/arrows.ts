/**
 * arrows.js — `satsuma arrows <schema.field>` command
 *
 * Returns all arrows involving a field (as source or target) with transform
 * classification. The most important structural primitive — agents use it
 * for impact tracing, coverage, and audit.
 *
 * Flags:
 *   --as-source   only arrows where the field is the source
 *   --as-target   only arrows where the field is the target
 *   --json        structured JSON with decomposed pipe steps
 */

import type { Command } from "commander";
import { loadWorkspace } from "../load-workspace.js";
import { runCommand, CommandError, EXIT_NOT_FOUND, EXIT_PARSE_ERROR } from "../command-runner.js";
import { resolveIndexKey, canonicalKey } from "../index-builder.js";
import { resolveAllNLRefs } from "../nl-ref-extract.js";
import { expandEntityFields } from "../spread-expand.js";
import { collectFieldNames, findFieldByPath } from "@satsuma/core";
import type { ExtractedWorkspace, ArrowRecord } from "../types.js";

export function register(program: Command): void {
  program
    .command("arrows <schema.field> [path]")
    .description("Show all arrows involving a field with transform classification")
    .option("--as-source", "only arrows where the field is the source")
    .option("--as-target", "only arrows where the field is the target")
    .option("--json", "structured JSON output")
    .addHelpText(
      "after",
      `
The field reference is <schema>.<field> — the schema name followed by a
dot and the field name. Namespace-qualified names work (e.g. pos::stores.STORE_ID).

Each arrow is classified: [none], [nl], or [nl-derived].

JSON shape (--json): array of arrow objects
  [{
    "mapping":        str,   # canonical mapping key, e.g. "::m" or "ns::m"
    "source":         str | null,  # canonical field path, comma-sep for multi-source, null if derived
    "target":         str | null,  # canonical field path
    "classification": "none" | "nl" | "nl-derived",
    "transform_raw":  str,   # raw transform text (all pipe steps are NL)
    "steps":          [{"type": str, "text": str}, ...],
    "derived":        bool,  # true when no declared source field
    "file":           str,
    "line":           int
  }, ...]

Examples:
  satsuma arrows hub_customer.email                  # all arrows for this field
  satsuma arrows hub_customer.email --as-source      # only outbound arrows
  satsuma arrows pos::stores.STORE_ID --json         # namespace-qualified`,
    )
    .action(
      runCommand(
        async (
          fieldRef: string,
          pathArg: string | undefined,
          opts: { asSource?: boolean; asTarget?: boolean; json?: boolean },
        ) => {
          const dot = fieldRef.indexOf(".");
          if (dot === -1) {
            throw new CommandError(
              `Invalid field reference '${fieldRef}'. Expected format: schema.field`,
              EXIT_PARSE_ERROR,
            );
          }

          const schemaName = fieldRef.slice(0, dot);
          const fieldName = fieldRef.slice(dot + 1);

          const { index } = await loadWorkspace(pathArg);

          // Validate schema exists
          const resolvedSchema = resolveIndexKey(schemaName, index.schemas);
          if (!resolvedSchema) {
            const close = [...index.schemas.keys()].find(
              (k) => k.toLowerCase() === schemaName.toLowerCase(),
            );
            const lines = [`Schema '${schemaName}' not found.`];
            if (close) lines.push(`Did you mean '${close}'?`);
            throw new CommandError(lines.join("\n"), EXIT_NOT_FOUND);
          }

          // Validate field exists in schema (including fragment spread fields and nested children)
          const schema = resolvedSchema.entry;
          const spreadFields = expandEntityFields(schema, schema.namespace ?? null, index);
          const allFields = [...schema.fields, ...spreadFields];
          const fieldExists =
            findFieldByPath(allFields, fieldName) !== null ||
            collectFieldNames(allFields).includes(fieldName);
          if (!fieldExists) {
            // Suggest close matches from top-level and nested fields
            const allNames = collectFieldNames(allFields);
            const close = allNames.find((n) => n.toLowerCase() === fieldName.toLowerCase());
            const lines = [`Field '${fieldName}' not found in schema '${schemaName}'.`];
            if (close) lines.push(`Did you mean '${close}'?`);
            throw new CommandError(lines.join("\n"), EXIT_NOT_FOUND);
          }

          // Find matching arrows using schema-qualified key
          // Try full dotted path, bare field name, and leaf name for nested fields
          const qualifiedField = `${resolvedSchema.key}.${fieldName}`;
          let arrows = findFieldArrows(qualifiedField, index);

          // Also search by bare field name (handles nested child fields indexed by leaf name)
          // Only include arrows from mappings involving the resolved schema, and only
          // when the arrow's source/target field path actually exists in the queried schema.
          // This prevents false positives from leaf-name collisions across schemas.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: split always produces at least one element
          const leafName = fieldName.includes(".") ? fieldName.split(".").pop()! : fieldName;
          const seen = new Set(
            arrows.map(
              (a) => `${a.mapping}:${a.namespace}:${a.sources.join(",")}:${a.target}:${a.line}`,
            ),
          );
          const schemaKey = resolvedSchema.key;
          for (const altKey of [fieldName, leafName]) {
            for (const a of findFieldArrows(altKey, index)) {
              const dedupKey = `${a.mapping}:${a.namespace}:${a.sources.join(",")}:${a.target}:${a.line}`;
              if (seen.has(dedupKey)) continue;
              const qMapping = a.namespace ? `${a.namespace}::${a.mapping}` : (a.mapping ?? "");
              const mapping = index.mappings.get(qMapping);
              if (!mapping) continue;

              // Verify the arrow's source or target field path exists in the queried schema's
              // field tree. Strip any schema prefix before the lookup.
              const pathExistsInSchema = (rawPath: string): boolean => {
                const bare = rawPath.replace(/^\./, "");
                const path = bare.startsWith(schemaKey + ".")
                  ? bare.slice(schemaKey.length + 1)
                  : bare;
                return (
                  findFieldByPath(allFields, path) !== null ||
                  collectFieldNames(allFields).includes(path)
                );
              };

              const asSourceMatch =
                mapping.sources.includes(schemaKey) && a.sources.some((s) => pathExistsInSchema(s));
              const asTargetMatch =
                mapping.targets.includes(schemaKey) &&
                a.target != null &&
                pathExistsInSchema(a.target);

              if (!asSourceMatch && !asTargetMatch) continue;
              seen.add(dedupKey);
              arrows.push(a);
            }
          }

          // When the user specifies a deeply nested path (e.g. CdtTrfTxInf.DbtrAgt.BIC),
          // filter out arrows whose source/target path doesn't match the requested path.
          // This allows disambiguating fields that share a leaf name at different nesting levels.
          if (fieldName.includes(".")) {
            arrows = arrows.filter((a) => {
              return (
                a.sources.some((s) => arrowPathMatches(s, fieldName)) ||
                arrowPathMatches(a.target, fieldName)
              );
            });
          }

          // Add NL-derived arrows when the queried field is the @ref source.
          //
          // An @ref like `@source8.amount` in `-> total { "Sum @source8.amount" }`
          // produces an nl-derived arrow: source8.amount → target8.total.
          // This arrow is discoverable when querying source8.amount (the ref
          // resolves to the queried field). Target-side discovery uses field-lineage.
          const nlRefs = resolveAllNLRefs(index);
          const canonicalQualified = canonicalKey(qualifiedField);
          for (const nlRef of nlRefs) {
            if (!nlRef.resolved || !nlRef.resolvedTo) continue;
            // NL refs from source blocks describe join conditions, not data flow —
            // skip them to avoid false NL-derived arrows on join-key fields.
            if (nlRef.context === "source_block") continue;
            const resolvedTo = nlRef.resolvedTo.name;

            // nlRef.mapping is already fully qualified by resolveAllNLRefs
            // (it is built as `${namespace}::${mapping}` or bare name before being
            // stored). Double-qualifying by prepending nlRef.namespace again would
            // produce "crm::crm::load_dim_customer", causing the mapping lookup and
            // the alreadyDeclared dedup check to fail, resulting in duplicate
            // nl-derived arrows when @ref references the arrow's own source (sl-qxn5).
            const nlMappingKey = nlRef.mapping;

            if (resolvedTo !== canonicalQualified) continue;
            const nlMapping = index.mappings.get(nlMappingKey);

            // Skip if the queried field is already a declared source for the same
            // arrow (e.g. `c -> d { "clean up @s1.c" }` — don't emit a duplicate
            // nl-derived arrow on top of the existing declared one). Only suppress
            // when the declared arrow actually lists the @ref field as a source;
            // derived arrows (source=null) from `-> tgt { "@src.field" }` lack
            // the source info that the nl-derived arrow adds (sl-k797).
            const alreadyDeclared = arrows.some((a) => {
              if (a.classification === "nl-derived") return false;
              const aMappingKey = a.namespace ? `${a.namespace}::${a.mapping}` : (a.mapping ?? "");
              if (aMappingKey !== nlMappingKey || a.target !== nlRef.targetField) return false;
              // Arrow sources may be bare field names (e.g. "c") while resolvedTo is
              // canonical (e.g. "::s1.c"). Qualify each source against the mapping's
              // source schemas to compare properly.
              const srcSchemas = nlMapping?.sources ?? [];
              return a.sources.some((s) => {
                if (s === resolvedTo || canonicalKey(s) === resolvedTo) return true;
                for (const schema of srcSchemas) {
                  if (canonicalKey(`${schema}.${s}`) === resolvedTo) return true;
                }
                return false;
              });
            });
            if (alreadyDeclared) continue;

            // Deduplicate against nl-derived arrows already added (an NL string may
            // contain multiple @refs resolving to different fields, each producing an
            // arrow with the same target).
            const dedupKey = `${nlMappingKey}:${resolvedTo}:${nlRef.targetField}:${nlRef.line}`;
            if (seen.has(dedupKey)) continue;
            seen.add(dedupKey);

            // Use the fully resolved path as the source so cross-schema refs
            // are correctly attributed (sl-uk9q)
            arrows.push({
              mapping:
                nlRef.namespace && nlRef.mapping?.startsWith(`${nlRef.namespace}::`)
                  ? nlRef.mapping.slice(nlRef.namespace.length + 2)
                  : nlRef.mapping,
              namespace: nlRef.namespace,
              sources: [resolvedTo],
              target: nlRef.targetField,
              transform_raw: `(NL ref)`,
              steps: [],
              classification: "nl-derived",
              derived: true,
              line: nlRef.line,
              file: nlRef.file,
            });
          }

          // Apply direction filters — verify the queried schema is on the correct
          // side of the mapping, not just that the field name matches
          if (opts.asSource) {
            arrows = arrows.filter((a) => {
              const qMapping = a.namespace ? `${a.namespace}::${a.mapping}` : (a.mapping ?? "");
              const m = index.mappings.get(qMapping);
              // For nl-derived arrows, sources may be fully-qualified canonical paths
              // (e.g. "::s1.a") rather than bare field names — match both forms.
              return (
                m?.sources.includes(resolvedSchema.key) &&
                a.sources.some(
                  (s) =>
                    s === fieldName ||
                    s === leafName ||
                    s === canonicalQualified ||
                    s.endsWith(`.${fieldName}`),
                )
              );
            });
          } else if (opts.asTarget) {
            arrows = arrows.filter((a) => {
              const qMapping = a.namespace ? `${a.namespace}::${a.mapping}` : (a.mapping ?? "");
              const m = index.mappings.get(qMapping);
              return (
                m?.targets.includes(resolvedSchema.key) &&
                (a.target === fieldName || a.target === leafName)
              );
            });
          }

          if (arrows.length === 0) {
            console.log(`No arrows found for '${fieldRef}'.`);
            return EXIT_NOT_FOUND;
          }

          if (opts.json) {
            const jsonArrows = arrows.map((a) => {
              const qMapping = a.namespace ? `${a.namespace}::${a.mapping}` : a.mapping;
              const mapping = index.mappings.get(qMapping ?? "");
              const sourceSchemas = mapping?.sources ?? [];
              const targetSchemas = mapping?.targets ?? [];

              // Determine which schema the target field belongs to
              let targetSchema: string;
              if (targetSchemas.includes(resolvedSchema.key)) {
                targetSchema = resolvedSchema.key;
              } else {
                targetSchema = targetSchemas[0] ?? resolvedSchema.key;
              }

              const qualifyPath = (path: string | null, schema: string): string | null => {
                if (!path) return null;
                if (path.startsWith(schema + ".") || path === schema) return path;
                // If path is already schema-qualified (contains a dot and the prefix
                // is a known schema), don't double-qualify
                const dotIdx = path.indexOf(".");
                if (dotIdx > 0) {
                  const prefix = path.slice(0, dotIdx);
                  if (index.schemas.has(prefix)) return path;
                }
                return `${schema}.${path}`;
              };

              // For multi-source arrows, find the actual schema that owns each source field
              // rather than attributing all fields to the queried schema.
              const resolveSourceField = (path: string): string => {
                // Already in canonical form (::schema.field or ns::schema.field)
                if (path.includes("::")) return path;
                // Already fully qualified with a known schema prefix
                const dotIdx = path.indexOf(".");
                if (dotIdx > 0) {
                  const prefix = path.slice(0, dotIdx);
                  if (index.schemas.has(prefix)) return path;
                }
                // Search each source schema for a field matching path
                for (const schemaKey of sourceSchemas) {
                  const s = index.schemas.get(schemaKey);
                  if (!s) continue;
                  const sSpread = expandEntityFields(s, s.namespace ?? null, index);
                  const allNames = [...s.fields, ...sSpread].map((f) => f.name);
                  if (allNames.includes(path)) return `${schemaKey}.${path}`;
                }
                // Fallback: use first source schema
                return `${sourceSchemas[0] ?? resolvedSchema.key}.${path}`;
              };

              const result: Record<string, unknown> = {
                mapping: qMapping ? canonicalKey(qMapping) : null,
                source:
                  a.sources.length === 0
                    ? null
                    : a.sources.map((s) => canonicalKey(resolveSourceField(s))).join(", "),
                target: a.target
                  ? canonicalKey(qualifyPath(a.target, targetSchema) ?? a.target)
                  : null,
                classification: a.classification,
                transform_raw: a.transform_raw,
                steps: a.steps,
                derived: a.derived,
                file: a.file,
                line: a.line + 1,
              };
              if (a.metadata && a.metadata.length > 0) {
                result.metadata = a.metadata;
              }
              return result;
            });
            console.log(JSON.stringify(jsonArrows, null, 2));
            return;
          }

          // Pass the resolved schema key so printDefault can match against index
          // entries even when the user queried with a bare (unqualified) name (sl-ltv6).
          printDefault(fieldRef, arrows, index, resolvedSchema.key);
        },
      ),
    );
}

/**
 * Check if an arrow's source/target path matches the user's requested nested path.
 * For example, if the arrow source is "CdtTrfTxInf.DbtrAgt.BIC" and the user
 * requested "CdtTrfTxInf.DbtrAgt.BIC", this returns true.
 * Also matches if the arrow path ends with the requested path (suffix match).
 */
function arrowPathMatches(arrowPath: string | null, requestedPath: string): boolean {
  if (!arrowPath) return false;
  if (arrowPath === requestedPath) return true;
  // Suffix match: arrow path ends with the requested path
  if (arrowPath.endsWith(`.${requestedPath}`)) return true;
  // The requested path ends with the arrow path (arrow has shorter dotted path)
  if (requestedPath.endsWith(`.${arrowPath}`)) return true;
  // Exact match on leaf only when the full path also has matching intermediate segments
  if (requestedPath.endsWith(arrowPath) && arrowPath === requestedPath.split(".").pop()) {
    // Leaf-only match — only accept if no deeper path was specified
    return false;
  }
  return false;
}

/**
 * Find all unique arrow records involving a given field (as source or target).
 * Accepts either a schema-qualified key ("schema.field") or bare field name.
 * Deduplicates since an arrow with source === target gets indexed under both.
 */
function findFieldArrows(fieldKey: string, index: ExtractedWorkspace): ArrowRecord[] {
  if (!index.fieldArrows.has(fieldKey)) return [];
  const seen = new Set<string>();
  const results: ArrowRecord[] = [];
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: .has() check on line above
  for (const arrow of index.fieldArrows.get(fieldKey)!) {
    const key = `${arrow.mapping}:${arrow.namespace}:${arrow.sources.join(",")}:${arrow.target}:${arrow.line}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push(arrow);
    }
  }
  return results;
}

/**
 * Print text-mode output for an arrows query.
 *
 * @param resolvedSchemaKey - The canonical index key for the queried schema
 *   (e.g. "crm::customers"). Must be the resolved key, not the user's raw
 *   query string, so that mapping source/target lookups hit correctly even
 *   when the user queried with a bare unqualified name (sl-ltv6).
 */
function printDefault(
  fieldRef: string,
  arrows: ArrowRecord[],
  index: ExtractedWorkspace,
  resolvedSchemaKey: string,
): void {
  const dot = fieldRef.indexOf(".");
  const schemaName = resolvedSchemaKey;
  const fieldPath = dot >= 0 ? fieldRef.slice(dot + 1) : fieldRef;
  const leafName = fieldPath.split(".").pop();
  const matchesField = (val: string | null) =>
    val === fieldPath ||
    val === leafName ||
    (val != null && (val.endsWith(`.${fieldPath}`) || val.endsWith(`.${leafName}`)));

  // Schema-aware source/target classification: verify the queried schema
  // is on the correct side of the mapping, not just that the field name matches
  const asSource = arrows.filter((a) => {
    if (!a.sources.some((s) => matchesField(s))) return false;
    const qMapping = a.namespace ? `${a.namespace}::${a.mapping}` : (a.mapping ?? "");
    const m = index.mappings.get(qMapping);
    return m ? m.sources.includes(schemaName) : true;
  });
  const asTarget = arrows.filter((a) => {
    if (!matchesField(a.target)) return false;
    const qMapping = a.namespace ? `${a.namespace}::${a.mapping}` : (a.mapping ?? "");
    const m = index.mappings.get(qMapping);
    return m ? m.targets.includes(schemaName) : true;
  });

  const parts: string[] = [];
  if (asSource.length > 0) parts.push(`${asSource.length} as source`);
  if (asTarget.length > 0) parts.push(`${asTarget.length} as target`);
  // arrows that are both (field used on both sides) — avoid double-count
  const total = new Set([...asSource, ...asTarget]).size;

  console.log(`${fieldRef} — ${total} arrow${total !== 1 ? "s" : ""} (${parts.join(", ")})`);
  console.log();

  // Group by qualified mapping name
  const byMapping = new Map<string, ArrowRecord[]>();
  for (const a of arrows) {
    const qMapping = a.namespace ? `${a.namespace}::${a.mapping}` : (a.mapping ?? "");
    if (!byMapping.has(qMapping)) byMapping.set(qMapping, []);
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: key initialized on previous line
    byMapping.get(qMapping)!.push(a);
  }

  for (const [mappingName, mappingArrows] of byMapping) {
    console.log(`  mapping '${mappingName}':`);
    for (const a of mappingArrows) {
      const src = a.sources.length > 0 ? a.sources.join(", ") : "(computed)";
      const tgt = a.target ?? "?";
      let line = `    ${src} -> ${tgt}`;
      if (a.transform_raw) {
        line += ` { ${a.transform_raw} }`;
      }
      line += `  [${a.classification}]`;
      console.log(line);
    }
    console.log();
  }
}
