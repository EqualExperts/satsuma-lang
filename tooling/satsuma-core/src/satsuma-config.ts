/**
 * satsuma-config.ts — the shape, parsing, and validation of `satsuma.config.yaml`.
 *
 * Owns the workspace config *semantics*: the typed shape, what makes a document
 * valid, and the one precedence rule that decides which lint rules a run
 * suppresses. Every consumer that honours the config — the CLI today, the LSP
 * when it mirrors lint diagnostics — must go through this module rather than
 * reading YAML keys itself, so a config means the same thing in an editor as it
 * does in CI.
 *
 * It does **not** own reading the file. Core imports no Node built-ins (the viz
 * component bundles core for the browser), and each consumer already has its own
 * way of resolving a workspace root and reading files. Consumers pass the text
 * in and map {@link SatsumaConfigParseResult} errors onto their own exit codes
 * or diagnostics.
 *
 * Deliberately not re-exported from `index.ts`: reaching it through the
 * `@satsuma/core/config` subpath keeps the `yaml` dependency out of the
 * browser bundle for consumers that never read a config.
 */

import { parse as parseYaml } from "yaml";

/**
 * Default config file name, resolved relative to the workspace root by each
 * consumer.
 *
 * Not a dotfile: `.satsuma` is a first-class Satsuma *source* extension
 * (`SATSUMA_FILE_EXTENSIONS`), so a config named `.satsumacfg` would sit one
 * character from a source-file glob and would get no editor YAML association or
 * schema support. Settled in doc review 2026-07-31 (PRD 37 R4).
 */
export const SATSUMA_CONFIG_FILENAME = "satsuma.config.yaml";

/** Recognised top-level config sections. Anything else earns a warning. */
const KNOWN_TOP_LEVEL_KEYS = ["lint"] as const;

/** Recognised keys inside the `lint` section. Anything else earns a warning. */
const KNOWN_LINT_KEYS = ["suppress", "typeAliases", "strict"] as const;

/**
 * An alias group declares a set of declared-type tokens as equivalent for the
 * `type-mismatch-direct-arrow` rule — e.g. `["STRING", "TEXT", "VARCHAR"]` in a
 * workspace where three layers spell the same type three ways.
 *
 * Groups stay separate rather than being flattened into one set: flattening
 * would make `STRING` equivalent to `INT` as soon as a workspace declares both
 * a string group and an integer group. Tokens are stored exactly as authored;
 * how they are compared (case, parameters) is the consuming rule's business.
 */
export type TypeAliasGroup = readonly string[];

/** The `lint` section of the config. */
export interface LintConfig {
  /**
   * Rule ids excluded from every run — the persistent form of `--ignore`.
   * Empty by default: a workspace with no config runs every rule.
   */
  readonly suppress: readonly string[];

  /**
   * Declared-type equivalence groups consumed by the type-mismatch rule.
   * Empty by default, meaning types are compared without any aliasing.
   */
  readonly typeAliases: readonly TypeAliasGroup[];

  /**
   * When true, warning-severity findings make `lint` exit non-zero. Off by
   * default so adding a config file cannot break an existing CI job.
   */
  readonly strict: boolean;
}

/** A fully resolved workspace config. Every section is present after parsing. */
export interface SatsumaConfig {
  readonly lint: LintConfig;
}

/**
 * The config a workspace gets when it has no config file — every rule runs,
 * nothing is aliased, warnings stay advisory.
 */
export const DEFAULT_SATSUMA_CONFIG: SatsumaConfig = {
  lint: { suppress: [], typeAliases: [], strict: false },
};

/**
 * Outcome of parsing a config document.
 *
 * `ok: false` means the document cannot be used at all — the consumer must
 * abort rather than fall back to defaults, because silently ignoring a config
 * the author wrote is how suppression and strictness get lost. Warnings are
 * non-fatal: they carry forward-compatibility notes such as unrecognised keys.
 */
export type SatsumaConfigParseResult =
  | { readonly ok: true; readonly config: SatsumaConfig; readonly warnings: string[] }
  | { readonly ok: false; readonly errors: string[] };

/** Options accepted by {@link parseSatsumaConfig}. */
export interface ParseSatsumaConfigOptions {
  /**
   * The rule ids that exist, used to reject typos in `lint.suppress`. Optional
   * because a consumer may parse a config before its rule registry is known;
   * when omitted, rule ids are accepted as authored. Validation must be opt-in
   * rather than assumed-empty, or an unvalidated parse would reject every id.
   */
  readonly knownRuleIds?: readonly string[];
}

/**
 * Parse and validate a `satsuma.config.yaml` document.
 *
 * @param text     raw file contents. An empty document yields the defaults —
 *                 a file someone created but has not filled in is not broken.
 * @param options  see {@link ParseSatsumaConfigOptions}.
 * @returns the resolved config plus warnings, or the errors that make the
 *          document unusable. Never throws: a YAML syntax error is returned as
 *          an error string so consumers own the failure policy.
 */
export function parseSatsumaConfig(
  text: string,
  options: ParseSatsumaConfigOptions = {},
): SatsumaConfigParseResult {
  let document: unknown;
  try {
    document = parseYaml(text);
  } catch (err: unknown) {
    const message = (err as { message?: string })?.message ?? String(err);
    return { ok: false, errors: [`invalid YAML: ${message}`] };
  }

  // An empty file, or one containing only comments, parses to null/undefined.
  if (document === null || document === undefined) {
    return { ok: true, config: DEFAULT_SATSUMA_CONFIG, warnings: [] };
  }

  if (!isPlainObject(document)) {
    return {
      ok: false,
      errors: [
        `expected the document root to be a mapping of sections, found ${describe(document)}`,
      ],
    };
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  warnUnknownKeys(document, KNOWN_TOP_LEVEL_KEYS, "", warnings);

  const lint = parseLintSection(document.lint, options.knownRuleIds, errors, warnings);

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, config: { lint }, warnings };
}

/**
 * Parse the `lint` section, defaulting each key the author omitted.
 *
 * Accumulates into `errors`/`warnings` rather than returning early so one run
 * reports every problem in the file — an author fixing a config should not have
 * to re-run once per mistake.
 */
function parseLintSection(
  raw: unknown,
  knownRuleIds: readonly string[] | undefined,
  errors: string[],
  warnings: string[],
): LintConfig {
  if (raw === undefined || raw === null) return DEFAULT_SATSUMA_CONFIG.lint;

  if (!isPlainObject(raw)) {
    errors.push(`lint: expected a mapping of settings, found ${describe(raw)}`);
    return DEFAULT_SATSUMA_CONFIG.lint;
  }

  warnUnknownKeys(raw, KNOWN_LINT_KEYS, "lint.", warnings);

  return {
    suppress: parseSuppress(raw.suppress, knownRuleIds, errors),
    typeAliases: parseTypeAliases(raw.typeAliases, errors),
    strict: parseStrict(raw.strict, errors),
  };
}

/** Parse `lint.suppress`, rejecting rule ids that do not exist. */
function parseSuppress(
  raw: unknown,
  knownRuleIds: readonly string[] | undefined,
  errors: string[],
): readonly string[] {
  if (raw === undefined || raw === null) return DEFAULT_SATSUMA_CONFIG.lint.suppress;

  if (!isStringArray(raw)) {
    errors.push(`lint.suppress: expected a list of rule ids, found ${describe(raw)}`);
    return DEFAULT_SATSUMA_CONFIG.lint.suppress;
  }

  const suppress = raw.map((id) => id.trim());

  if (knownRuleIds) {
    const unknown = unknownRuleIds(suppress, knownRuleIds);
    for (const id of unknown) {
      errors.push(
        `lint.suppress: unknown lint rule "${id}". Valid rules: ${[...knownRuleIds].sort().join(", ")}`,
      );
    }
  }

  return suppress;
}

/** A group naming fewer than two types declares nothing equivalent to anything. */
const MIN_ALIAS_GROUP_MEMBERS = 2;

/** Parse `lint.typeAliases` into groups, rejecting groups that cannot mean anything. */
function parseTypeAliases(raw: unknown, errors: string[]): readonly TypeAliasGroup[] {
  if (raw === undefined || raw === null) return DEFAULT_SATSUMA_CONFIG.lint.typeAliases;

  if (!Array.isArray(raw)) {
    errors.push(`lint.typeAliases: expected a list of alias groups, found ${describe(raw)}`);
    return DEFAULT_SATSUMA_CONFIG.lint.typeAliases;
  }

  const groups: TypeAliasGroup[] = [];

  raw.forEach((group, index) => {
    const location = `lint.typeAliases[${index}]`;

    if (!isStringArray(group)) {
      errors.push(`${location}: expected a list of type names, found ${describe(group)}`);
      return;
    }

    const members = group.map((type) => type.trim()).filter((type) => type.length > 0);

    if (members.length < MIN_ALIAS_GROUP_MEMBERS) {
      errors.push(
        `${location}: an alias group needs at least two type names to declare an equivalence`,
      );
      return;
    }

    groups.push(members);
  });

  return groups;
}

/** Parse `lint.strict`, refusing to read truthiness into a non-boolean. */
function parseStrict(raw: unknown, errors: string[]): boolean {
  if (raw === undefined || raw === null) return DEFAULT_SATSUMA_CONFIG.lint.strict;

  if (typeof raw !== "boolean") {
    // `strict: "no"` is a non-empty string: treating it as truthy would invert
    // an explicit opt-out.
    errors.push(`lint.strict: expected true or false, found ${describe(raw)}`);
    return DEFAULT_SATSUMA_CONFIG.lint.strict;
  }

  return raw;
}

/**
 * Rule ids from `candidates` that are not in `knownRuleIds`, in the order and
 * spelling the author used.
 *
 * Shared with the CLI's `--select`/`--ignore` validation so a typo is reported
 * the same way wherever it is written. Matching is case-sensitive: rule ids are
 * lowercase-kebab identifiers, not prose.
 */
export function unknownRuleIds(
  candidates: readonly string[],
  knownRuleIds: readonly string[],
): string[] {
  const known = new Set(knownRuleIds);
  return candidates.filter((id) => !known.has(id));
}

/** Inputs to {@link resolveSuppressedRuleIds}. */
export interface SuppressionInputs {
  /** Rule ids named by `--select`, if the caller passed the flag. */
  readonly select?: readonly string[];
  /** Rule ids named by `--ignore`, if the caller passed the flag. */
  readonly ignore?: readonly string[];
  /** Rule ids from `lint.suppress`. */
  readonly configSuppress?: readonly string[];
}

/**
 * Decide which rule ids a run must skip, applying the one precedence rule from
 * PRD 37 R4:
 *
 *   **Flags win over config, and the union of `--ignore` and `lint.suppress`
 *   is suppressed** — except that `--select` still means "run exactly these",
 *   so a rule the author named on the command line runs even when the config
 *   suppresses it. Naming a rule is an unambiguous instruction to run it.
 *
 * `--ignore` keeps beating `--select` when both name the same rule, which is
 * the behaviour the flags already had before the config existed.
 *
 * @returns the ids to skip. Rule *selection* itself stays with the caller; this
 *          function owns only the suppression decision.
 */
export function resolveSuppressedRuleIds(inputs: SuppressionInputs): Set<string> {
  const explicitlySelected = new Set(inputs.select ?? []);

  const suppressed = new Set(inputs.ignore ?? []);
  for (const id of inputs.configSuppress ?? []) {
    if (!explicitlySelected.has(id)) suppressed.add(id);
  }

  return suppressed;
}

// ── Shape helpers ──────────────────────────────────────────────────────────
//
// YAML gives us `unknown`; these narrow it without letting a wrong-shaped
// value through as a silently-coerced default.

/** True for a YAML mapping — an object that is neither null nor an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** True for a YAML sequence whose every member is a string. */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Describe an unexpected value for an error message — enough for the author to
 * recognise what they wrote, without dumping a whole nested document.
 */
function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  if (isPlainObject(value)) return "a mapping";
  if (typeof value === "string") return `the string "${value}"`;
  return String(value);
}

/** Warn about keys we do not recognise, so a misspelled section is visible. */
function warnUnknownKeys(
  container: Record<string, unknown>,
  knownKeys: readonly string[],
  pathPrefix: string,
  warnings: string[],
): void {
  const known = new Set(knownKeys);
  for (const key of Object.keys(container)) {
    if (!known.has(key)) {
      warnings.push(
        `unrecognised setting "${pathPrefix}${key}" ignored. Known: ${knownKeys.map((k) => `${pathPrefix}${k}`).join(", ")}`,
      );
    }
  }
}
