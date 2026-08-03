/**
 * lint-type-mismatch.ts — the `type-mismatch-direct-arrow` lint rule (PRD 37 R1).
 *
 * Owns one question: when an arrow says "this value passes through unchanged",
 * do the two ends agree about what type that value is? A bare `src -> tgt`
 * between a `STRING` and a `DATE` is almost always a mis-picked field, a schema
 * edit that outran its mappings, or a transform nobody wrote down — and until
 * this rule existed, nothing in the toolchain remarked on it.
 *
 * Owns: which arrows carry a type assertion, how two declared types are compared
 * (base token, case-insensitively, plus the author's own alias groups), and the
 * message. Does not own rule registration, suppression, or how the config is
 * read — those belong to the consumer and to satsuma-config.ts respectively.
 *
 * **The rule is deliberately narrow.** It fires only where the spec's own
 * classification says an assertion was made, and stays silent everywhere the
 * answer would be a guess. Every exemption below is a decision, not an omission.
 */

import { schemaLocalFieldPath } from "./coverage-paths.js";
import type { LintFinding } from "./lint-findings.js";
import { createAuthoredEntityRef, createContainerQualifiedFieldRef } from "./reference-stages.js";
import type { AuthoredEntityRef, CanonicalEntityRef, SchemaLocalPath } from "./reference-stages.js";
import type { TypeAliasGroup } from "./satsuma-config.js";
import type { Classification } from "./types.js";

/** Rule id. Stable — CI jobs and `lint.suppress` entries key off it. */
export const TYPE_MISMATCH_RULE_ID = "type-mismatch-direct-arrow";

// ── Structural inputs ───────────────────────────────────────────────────────
//
// The minimal shapes the detector needs. The CLI's `ExtractedWorkspace` records
// and the LSP's index satisfy them by structural typing, so neither package has
// to build an adapter object — the same arrangement validate.ts uses.

/** A declared field, as far as this rule is concerned: a name, a type, children. */
export interface DeclaredTypeField {
  /** Field name as declared, Satsuma backtick quoting already stripped. */
  readonly name: string;
  /**
   * Declared type text exactly as authored (`STRING`, `DECIMAL(10,2)`,
   * `UUID(pk)`, or `record` for a record body). Absent or empty means the author
   * declared no type, which this rule treats as "nothing to compare".
   */
  readonly type?: string;
  /** Nested declarations for record / `list_of record` fields. */
  readonly children?: readonly DeclaredTypeField[];
}

/** One schema resolved for type comparison. */
export interface DeclaredTypeSchema {
  /**
   * Stable id to name this schema by in messages (`crm::customers`, or the bare
   * key for a global schema). Consumers pass their own workspace key so the
   * message quotes the spelling the rest of their output uses.
   */
  readonly schemaId: string;
  /**
   * Unique workspace identity, used to strip a qualified prefix off an arrow
   * path (`crm_customers.email -> email`). Obtained by canonicalizing the
   * authored reference against the consumer's index.
   */
  readonly canonicalRef: CanonicalEntityRef;
  /** Top-level declared fields, with fragment spreads already inlined. */
  readonly fields: readonly DeclaredTypeField[];
}

/**
 * Resolve a schema reference as written in a `source {}` / `target {}` block to
 * its declared fields, or null when the workspace declares no such schema.
 *
 * Unresolvable references are skipped rather than reported: `validate` already
 * flags a mapping pointing at a schema that does not exist, and a lint rule
 * repeating it would double-report one mistake.
 */
export type DeclaredTypeSchemaResolver = (
  writtenRef: AuthoredEntityRef,
  mappingNamespace: string | null,
) => DeclaredTypeSchema | null;

/** The mapping an arrow sits in — only its schema references matter here. */
export interface TypeMismatchMapping {
  /** Namespace the mapping is declared in, or null/absent at file scope. */
  readonly namespace?: string | null;
  /** Schema references from the `source {}` block, as written. */
  readonly sources: readonly string[];
  /** Schema references from the `target {}` block, as written. */
  readonly targets: readonly string[];
}

/** An arrow, reduced to what decides whether it asserts type identity. */
export interface TypeMismatchArrow {
  /** Mapping label, or the consumer's synthetic key for an anonymous mapping. */
  readonly mapping: string | null;
  /** Namespace the arrow's mapping is declared in, or null at file scope. */
  readonly namespace: string | null;
  /** Source paths, already made absolute against any enclosing container. */
  readonly sources: readonly string[];
  /** Target path, already made absolute against any enclosing container. */
  readonly target: string | null;
  /** Transform classification — `none` is the whole applicability criterion. */
  readonly classification: Classification;
  /** Absolute path or URI of the declaring file. */
  readonly file: string;
  /** 0-indexed declaration row, as extraction records it. */
  readonly line: number;
}

/** Everything {@link detectTypeMismatches} reads. */
export interface TypeMismatchInput {
  /**
   * Every arrow in the workspace, once each. A rule that visited an index keyed
   * by field would report one arrow once per field it names.
   */
  readonly arrows: readonly TypeMismatchArrow[];
  /**
   * Mappings by index key — `ns::label` inside a namespace, the bare label
   * otherwise. Matches how {@link TypeMismatchArrow.mapping} and
   * {@link TypeMismatchArrow.namespace} combine, which is core's existing
   * convention (validate.ts uses the same key).
   */
  readonly mappings: ReadonlyMap<string, TypeMismatchMapping>;
  /** See {@link DeclaredTypeSchemaResolver}. */
  readonly resolveSchema: DeclaredTypeSchemaResolver;
  /**
   * Alias groups from `lint.typeAliases`. Nothing is presumed equivalent
   * without them: deciding on the author's behalf that `TEXT` is a `STRING` is
   * a convention decision this feature explicitly does not make (PRD 37, Out of
   * Scope).
   */
  readonly typeAliases?: readonly TypeAliasGroup[];
}

// ── Detection ───────────────────────────────────────────────────────────────

/**
 * Report bare arrows whose two ends declare different types.
 *
 * Findings are in arrow order, one per offending arrow. Severity is `warning`:
 * a mismatch can be intentional (the author knows the target column is a string
 * holding a date), so this is policy, not correctness — `validate` semantics are
 * untouched.
 */
export function detectTypeMismatches(input: TypeMismatchInput): LintFinding[] {
  const aliasGroups = indexAliasGroups(input.typeAliases ?? []);
  const findings: LintFinding[] = [];

  for (const arrow of input.arrows) {
    // Applicability: only arrows the spec classifies `none`.
    //
    // Any transform body classifies `nl`, and judging whether an NL transform
    // preserves type is interpretation the CLI leaves to agents (PRD 37 R1).
    // `nl-derived` arrows are synthetic — inferred from an NL `@ref` — so they
    // carry no authored assertion at all.
    //
    // **A `map { … }` value map needs no branch of its own, and must not get
    // one.** `map_literal` is a `pipe_step`, and `classifyTransform` returns
    // `nl` for any non-empty pipe chain, so a value-map arrow is already
    // excluded here. A future refactor that classified map literals separately
    // would silently start type-checking value maps — which convert values and
    // so may legitimately change type. `type-mismatch-direct-arrow.test.js`
    // locks that.
    if (arrow.classification !== "none") continue;

    // A single source only. A bare `first, last -> full_name` asserts something
    // about the combination, and no one of its sources is *the* type of the
    // result — picking one to compare would invent an assertion the author did
    // not make. Derived arrows (`-> tgt` with no source path) land here too.
    if (arrow.sources.length !== 1 || !arrow.target) continue;

    const mapping = input.mappings.get(mappingIndexKey(arrow));
    if (!mapping) continue;
    const namespace = mapping.namespace ?? null;

    const source = resolveDeclaredType(
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- length checked above
      arrow.sources[0]!,
      mapping.sources,
      namespace,
      input.resolveSchema,
      aliasGroups,
    );
    const target = resolveDeclaredType(
      arrow.target,
      mapping.targets,
      namespace,
      input.resolveSchema,
      aliasGroups,
    );

    // Silent skips: either side undeclared, unresolvable, or ambiguous across
    // several participating schemas. All three mean the rule does not know what
    // the author asserted, and guessing is how a lint rule loses its audience.
    if (!source || !target) continue;
    if (typesAgree(source.token, target.token, aliasGroups)) continue;

    findings.push({
      rule: TYPE_MISMATCH_RULE_ID,
      severity: "warning",
      file: arrow.file,
      line: arrow.line + 1,
      column: 1,
      message:
        `Bare arrow '${source.qualifiedPath} -> ${target.qualifiedPath}' connects declared type ` +
        `${source.declaredType} to ${target.declaredType}. A bare arrow asserts the value passes ` +
        `through unchanged — add a transform body if a conversion is intended, correct the field ` +
        `reference, or declare the types as equivalent in lint.typeAliases.`,
    });
  }

  return findings;
}

/** Index key for the mapping an arrow belongs to (`ns::label`, or the bare label). */
function mappingIndexKey(arrow: TypeMismatchArrow): string {
  return arrow.namespace ? `${arrow.namespace}::${arrow.mapping}` : (arrow.mapping ?? "");
}

// ── Resolving one endpoint's declared type ──────────────────────────────────

/** What one end of an arrow turned out to declare. */
interface EndpointType {
  /** `schemaId.localPath` — how the message names this end. */
  readonly qualifiedPath: string;
  /** Declared type text as authored, for the message. */
  readonly declaredType: string;
  /** Normalized token, for the comparison. */
  readonly token: string;
}

/**
 * The declared type of an arrow path, resolved against the schemas on its side
 * of the mapping — or null when this rule must stay silent.
 *
 * Null covers four distinct silences, all deliberate:
 *
 *  - no participating schema declares the path (`validate`'s territory);
 *  - the path resolves but the author declared no type for it;
 *  - the schema itself is unresolvable;
 *  - **two participating schemas declare the path with different types.** A bare
 *    `email -> email` in a mapping whose two sources both declare `email` names
 *    no particular one of them, so which type the author meant is unknowable.
 *    Reporting the first match would make the finding depend on source order.
 *
 * A schema whose fragment spreads are unresolved needs no special case: an
 * unexpanded spread makes paths *fail* to resolve, and failing to resolve is
 * already a silent skip. That is the opposite of `unenumerated-record-target`,
 * which reasons about a field's *absence* and so must exclude such schemas.
 */
function resolveDeclaredType(
  path: string,
  schemaRefs: readonly string[],
  mappingNamespace: string | null,
  resolveSchema: DeclaredTypeSchemaResolver,
  aliasGroups: AliasGroupIndex,
): EndpointType | null {
  let resolved: EndpointType | null = null;

  for (const writtenRef of schemaRefs) {
    const schema = resolveSchema(createAuthoredEntityRef(writtenRef), mappingNamespace);
    if (!schema) continue;

    const localPath = localiseAgainst(path, writtenRef, schema, schemaRefs);
    if (localPath === null) continue;

    const declaredType = findDeclaredType(localPath, schema.fields);
    if (!declaredType) continue;

    const candidate: EndpointType = {
      qualifiedPath: `${schema.schemaId}.${localPath}`,
      declaredType,
      token: baseTypeToken(declaredType),
    };

    if (!resolved) {
      resolved = candidate;
      continue;
    }
    // Ambiguous across schemas: silence unless they agree about the type.
    if (!typesAgree(resolved.token, candidate.token, aliasGroups)) return null;
  }

  return resolved;
}

/**
 * Reduce an authored arrow path to one local to `schema`, or null when it names
 * a different participating schema.
 *
 * Delegates the prefix rules to `schemaLocalFieldPath` so this rule and coverage
 * cannot disagree about which schema a qualified path belongs to — including the
 * shadowing case where a schema declares a top-level field named like another
 * schema (ADR-041).
 */
function localiseAgainst(
  path: string,
  writtenRef: string,
  schema: DeclaredTypeSchema,
  allSchemaRefs: readonly string[],
): SchemaLocalPath | null {
  const topLevelNames = new Set(schema.fields.map((f) => f.name));
  return schemaLocalFieldPath(
    createContainerQualifiedFieldRef(path),
    createAuthoredEntityRef(writtenRef),
    schema.canonicalRef,
    allSchemaRefs.filter((r) => r !== writtenRef).map(createAuthoredEntityRef),
    (name) => topLevelNames.has(name),
  );
}

/**
 * The declared type text at a schema-local dotted path, or null when the schema
 * declares no such path or declares it without a type.
 */
function findDeclaredType(
  path: SchemaLocalPath,
  fields: readonly DeclaredTypeField[],
): string | null {
  let level: readonly DeclaredTypeField[] | undefined = fields;
  let found: DeclaredTypeField | undefined;

  for (const segment of path.split(".")) {
    found = level?.find((f) => f.name === segment);
    if (!found) return null;
    level = found.children;
  }

  const declared = found?.type?.trim();
  return declared ? declared : null;
}

// ── Comparing two declared types ────────────────────────────────────────────

/**
 * The token two declared types are compared on: the part before any `(`,
 * upper-cased.
 *
 * Two business rules, both from PRD 37 R1:
 *
 *  - **Case is not type information.** `String` and `STRING` are one type
 *    spelled two ways, and a workspace assembled from several spreadsheets will
 *    contain both.
 *  - **Parameters are not compared.** Declared lengths and precision
 *    (`VARCHAR(255)` vs `VARCHAR(64)`) do not count as mismatches at the
 *    granularity this rule judges. Satsuma also spells constraint flags inside
 *    the same parentheses (`UUID(pk)` — sl-vryu), which are not type
 *    information at all, so stripping the parenthesised part is the only
 *    reading that does not produce false positives on both.
 */
function baseTypeToken(declaredType: string): string {
  const parameterStart = declaredType.indexOf("(");
  const base = parameterStart >= 0 ? declaredType.slice(0, parameterStart) : declaredType;
  return base.trim().toUpperCase();
}

/**
 * A normalized type token to the alias groups it belongs to.
 *
 * A token can be in several groups (a workspace may declare both a
 * `STRING`/`TEXT` group and a `TEXT`/`CLOB` one), so membership is a set of
 * group indices and two tokens are equivalent when the sets intersect. Groups
 * are never flattened into one pool — that would make `STRING` equivalent to
 * `INT` in any workspace declaring both a string group and an integer group.
 */
type AliasGroupIndex = ReadonlyMap<string, ReadonlySet<number>>;

/** Build the {@link AliasGroupIndex} for the workspace's configured alias groups. */
function indexAliasGroups(groups: readonly TypeAliasGroup[]): AliasGroupIndex {
  const index = new Map<string, Set<number>>();

  groups.forEach((group, groupIndex) => {
    for (const declaredType of group) {
      const token = baseTypeToken(declaredType);
      if (token.length === 0) continue;
      const memberships = index.get(token) ?? new Set<number>();
      memberships.add(groupIndex);
      index.set(token, memberships);
    }
  });

  return index;
}

/** True when two normalized type tokens are equal or share an alias group. */
function typesAgree(left: string, right: string, aliasGroups: AliasGroupIndex): boolean {
  if (left === right) return true;

  const leftGroups = aliasGroups.get(left);
  const rightGroups = aliasGroups.get(right);
  if (!leftGroups || !rightGroups) return false;

  for (const groupIndex of leftGroups) {
    if (rightGroups.has(groupIndex)) return true;
  }
  return false;
}
