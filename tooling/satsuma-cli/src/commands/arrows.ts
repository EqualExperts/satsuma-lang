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
import { resolveIndexKey, canonicalKey, arrowPathInSchema } from "../index-builder.js";
import { arrowEndpoint } from "../field-endpoints.js";
import { resolveAllNLRefs } from "../nl-ref-extract.js";
import { expandDeclaredFields } from "../spread-expand.js";
import { findDeclaredFields } from "../field-lookup.js";
import type { DeclaredFieldMatch } from "../field-lookup.js";
import { collectFieldNames } from "@satsuma/core";
import type { ExtractedWorkspace, ArrowRecord, FieldDecl } from "../types.js";

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

          // Resolve the queried field against the schema's declared tree, seeing
          // through fragment spreads at any depth (bsw-ep0m). Every later step —
          // candidate filtering, the direction filters and the text grouping —
          // asks one question of an arrow path: is it one of these declared paths?
          const schema = resolvedSchema.entry;
          const allFields = expandDeclaredFields(schema, schema.namespace ?? null, index);
          const matches = findDeclaredFields(schema, fieldName.split("."), index);
          if (matches.length === 0) {
            // Suggest close matches from top-level and nested fields
            const allNames = collectFieldNames(allFields);
            const close = allNames.find((n) => n.toLowerCase() === fieldName.toLowerCase());
            const lines = [`Field '${fieldName}' not found in schema '${schemaName}'.`];
            if (close) lines.push(`Did you mean '${close}'?`);
            throw new CommandError(lines.join("\n"), EXIT_NOT_FOUND);
          }
          const schemaKey = resolvedSchema.key;
          const isQueriedField = queriedFieldMatcher(matches, schemaKey, allFields);

          // Find matching arrows using schema-qualified key
          const qualifiedField = `${schemaKey}.${fieldName}`;
          let arrows = findFieldArrows(qualifiedField, index);

          // Also search by bare path and leaf name: nested arrows are indexed under
          // both, so this is how a leaf-name query reaches `orders.lines.id`.
          // Those keys are shared by every schema, and by every path ending in the
          // same segment, so a candidate is kept only when its mapping involves the
          // queried schema and its own path is one the query resolved to.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- Safe: split always produces at least one element
          const leafName = fieldName.split(".").pop()!;
          const seen = new Set(
            arrows.map(
              (a) => `${a.mapping}:${a.namespace}:${a.sources.join(",")}:${a.target}:${a.line}`,
            ),
          );
          for (const altKey of [fieldName, leafName]) {
            for (const a of findFieldArrows(altKey, index)) {
              const dedupKey = `${a.mapping}:${a.namespace}:${a.sources.join(",")}:${a.target}:${a.line}`;
              if (seen.has(dedupKey)) continue;
              const qMapping = a.namespace ? `${a.namespace}::${a.mapping}` : (a.mapping ?? "");
              const mapping = index.mappings.get(qMapping);
              if (!mapping) continue;

              const asSourceMatch =
                mapping.sources.includes(schemaKey) && a.sources.some((s) => isQueriedField(s));
              const asTargetMatch = mapping.targets.includes(schemaKey) && isQueriedField(a.target);

              if (!asSourceMatch && !asTargetMatch) continue;
              seen.add(dedupKey);
              arrows.push(a);
            }
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
              // Arrow sources are authored paths (e.g. "c", "s1.c") while resolvedTo
              // is canonical (e.g. "::s1.c"). Try each source schema as the owner of
              // an unprefixed path, so a multi-source mapping matches whichever
              // schema the ref names; with no source schema the path stands alone.
              const srcSchemas = nlMapping?.sources ?? [];
              const owners = srcSchemas.length > 0 ? srcSchemas : [undefined];
              return a.sources.some((s) =>
                owners.some((owner) => endpointText(s, srcSchemas, owner) === resolvedTo),
              );
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
              // An inferred arrow has no declaration to read a kind off, so it
              // takes the one that asserts least. Prose naming a record is a
              // reference to it, never a claim that everything beneath it maps
              // (ADR-036), and `computed` is the kind that carries exactly that
              // — the same conservative default `arrowDeclarationKind` falls back
              // to for an unrecognised shape.
              kind: "computed",
              enumeratesChildren: false,
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
                m?.sources.includes(resolvedSchema.key) && a.sources.some((s) => isQueriedField(s))
              );
            });
          } else if (opts.asTarget) {
            arrows = arrows.filter((a) => {
              const qMapping = a.namespace ? `${a.namespace}::${a.mapping}` : (a.mapping ?? "");
              const m = index.mappings.get(qMapping);
              return m?.targets.includes(resolvedSchema.key) && isQueriedField(a.target);
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

              // An unprefixed target belongs to the queried schema when it is a
              // target here. An unprefixed source belongs to the source schema
              // that declares its first segment: a multi-source arrow's fields
              // are not all the queried schema's.
              const targetOwner = resolvedSchema.key;
              // A mapping the index cannot find declares no schemas; attribute its
              // paths to the queried schema rather than leave them unqualified.
              const sideOrQueried = (schemas: readonly string[]): readonly string[] =>
                schemas.length > 0 ? schemas : [resolvedSchema.key];
              const sourceOwner = (path: string): string | undefined => {
                const head = path.replace(/^\./, "").split(".")[0];
                return sourceSchemas.find((key) => {
                  const s = index.schemas.get(key);
                  return s
                    ? expandDeclaredFields(s, s.namespace ?? null, index).some(
                        (f) => f.name === head,
                      )
                    : false;
                });
              };

              const result: Record<string, unknown> = {
                mapping: qMapping ? canonicalKey(qMapping) : null,
                source:
                  a.sources.length === 0
                    ? null
                    : a.sources
                        .map((s) => endpointText(s, sideOrQueried(sourceSchemas), sourceOwner(s)))
                        .join(", "),
                target: a.target
                  ? endpointText(a.target, sideOrQueried(targetSchemas), targetOwner)
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
          printDefault(fieldRef, arrows, index, resolvedSchema.key, isQueriedField);
        },
      ),
    );
}

/**
 * Build the test for "does this arrow path name the queried field?".
 *
 * Rule (bsw-kvj9): the query names exactly the declared paths `findDeclaredFields`
 * resolved it to. A query that is itself a declared path — top-level `id` or
 * nested `orders.id` — resolves to that one path, so `orders.id` and
 * `orders.lines.id` are other fields even though they end in `id`. Only a name
 * that is not a declared path falls back to every field of that name at any
 * depth (sl-xj4p's leaf-name shorthand), and then each of those paths matches.
 *
 * An arrow path is first reduced to a path inside the queried schema by
 * `arrowPathInSchema`, which removes a leading `.` and any spelling of the
 * schema's name: the index key (`src.`, `ns::src.`), the canonical form
 * (`::src.`, which nl-derived sources carry) and, inside a namespace, the bare
 * name (`src.`, which a flatten to the target schema writes, bsw-tzc6). A
 * top-level field that shares the schema's name is not mistaken for that
 * prefix. Paths are then compared whole, never by suffix: a suffix match is how
 * a shallower or deeper field with the same leaf name used to slip in
 * (gpt-qhfo, bsw-kvj9).
 */
function queriedFieldMatcher(
  matches: DeclaredFieldMatch[],
  schemaKey: string,
  schemaFields: readonly FieldDecl[],
): (arrowPath: string | null) => boolean {
  const queried = new Set(matches.map((m) => m.path.join(".")));
  const declaresTopLevel = (name: string) => schemaFields.some((f) => f.name === name);
  return (arrowPath) => {
    if (!arrowPath) return false;
    const local = arrowPathInSchema(arrowPath, schemaKey, [], declaresTopLevel);
    return local !== null && queried.has(local);
  };
}

/**
 * Canonical endpoint text for an authored arrow path on one side of a mapping.
 *
 * Core's `resolveFieldEndpoint` (through `arrowEndpoint`) decides ownership: a
 * path that names a side schema, in any spelling, belongs to it; an unprefixed
 * path belongs to the first schema. `owner`, when it is on this side, is put
 * first so it claims the unprefixed paths. The queried-field filters have
 * already chosen the arrow; this only spells its endpoints for `--json`.
 */
function endpointText(
  path: string,
  sideSchemas: readonly string[],
  owner: string | undefined,
): string {
  const ordered =
    owner !== undefined && sideSchemas.includes(owner)
      ? [owner, ...sideSchemas.filter((schema) => schema !== owner)]
      : sideSchemas;
  return arrowEndpoint(path, ordered);
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
 * @param matchesField - The command's queried-field test, so the source/target
 *   split here uses the same rule that chose the arrows.
 */
function printDefault(
  fieldRef: string,
  arrows: ArrowRecord[],
  index: ExtractedWorkspace,
  resolvedSchemaKey: string,
  matchesField: (arrowPath: string | null) => boolean,
): void {
  const schemaName = resolvedSchemaKey;

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
