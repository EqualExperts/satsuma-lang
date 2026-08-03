/**
 * lint-type-mismatch.test.js — semantics of the `type-mismatch-direct-arrow` rule.
 *
 * This suite owns what the rule *means*: which arrows carry a type assertion,
 * when two declared types count as the same, and every case where the rule must
 * stay silent. The CLI's own suite covers only registration, severity and the
 * `--json` shape — the invariants here are tested once, at this level.
 *
 * Inputs are the smallest snippet that exercises each case, parsed with the real
 * grammar and fed through core's own extraction, so a change to how types or
 * arrow paths are extracted surfaces here rather than in a consumer.
 */

import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  initParser,
  getParser,
  canonicalizeEntityRef,
  detectTypeMismatches,
  extractArrowRecords,
  extractMappings,
  extractSchemas,
  TYPE_MISMATCH_RULE_ID,
} from "@satsuma/core";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = resolve(__dirname, "../../tree-sitter-satsuma/tree-sitter-satsuma.wasm");

const TEST_FILE = "/w/test.stm";

before(async () => {
  await initParser(WASM_PATH);
});

// ── Harness ─────────────────────────────────────────────────────────────────

/** Index key convention shared by core and the CLI: `ns::name`, or the bare name. */
function indexKey(namespace, name) {
  return namespace ? `${namespace}::${name}` : name;
}

/**
 * Build a {@link TypeMismatchInput} from Satsuma source.
 *
 * Deliberately mirrors what the CLI's index-builder produces — schemas keyed by
 * namespace-qualified name, arrows carrying their declaring file, a resolver that
 * canonicalizes the reference as written in the mapping — so these tests exercise
 * the same contract the real consumer satisfies.
 */
function inputFor(source, typeAliases = []) {
  const tree = getParser().parse(source);
  const root = tree.rootNode;

  const schemas = new Map();
  for (const schema of extractSchemas(root)) {
    if (schema.name) schemas.set(indexKey(schema.namespace, schema.name), schema);
  }

  const mappings = new Map();
  for (const mapping of extractMappings(root)) {
    mappings.set(indexKey(mapping.namespace, mapping.name), mapping);
  }

  const arrows = extractArrowRecords(root).map((arrow) => ({ ...arrow, file: TEST_FILE }));

  const resolveSchema = (writtenRef, mappingNamespace) => {
    const canonicalRef = canonicalizeEntityRef(writtenRef, mappingNamespace, schemas);
    if (!canonicalRef) return null;
    const key = canonicalRef.startsWith("::") ? canonicalRef.slice(2) : canonicalRef;
    const schema = schemas.get(key);
    if (!schema) return null;
    return { schemaId: key, canonicalRef, fields: schema.fields };
  };

  return { arrows, mappings, resolveSchema, typeAliases };
}

/** Findings for a snippet, with the alias groups a config would supply. */
function findingsFor(source, typeAliases = []) {
  return detectTypeMismatches(inputFor(source, typeAliases));
}

/** The smallest workspace with one bare arrow between two declared types. */
function bareArrowBetween(sourceType, targetType) {
  return `
schema customers {
  signup ${sourceType}
}

schema profiles {
  signup_date ${targetType}
}

mapping load {
  source { customers }
  target { profiles }
  signup -> signup_date
}
`;
}

// ── The finding itself ──────────────────────────────────────────────────────

describe("reporting a mismatch", () => {
  it("warns on a bare arrow whose two ends declare different types", () => {
    // The rule's whole purpose: `STRING -> DATE` with no transform asserts the
    // value passes through unchanged, which cannot be true of two different types.
    const findings = findingsFor(bareArrowBetween("STRING", "DATE"));

    assert.equal(findings.length, 1);
    assert.equal(findings[0].rule, TYPE_MISMATCH_RULE_ID);
    assert.equal(findings[0].severity, "warning");
    assert.equal(findings[0].file, TEST_FILE);
    assert.equal(findings[0].column, 1);
  });

  it("names both qualified field paths and both declared types in the message", () => {
    // `lint --json` consumers group findings by type-pair, and a reviewer must be
    // able to act without opening the file — so all four facts must be present.
    const [finding] = findingsFor(bareArrowBetween("STRING", "DATE"));

    assert.match(finding.message, /customers\.signup/);
    assert.match(finding.message, /profiles\.signup_date/);
    assert.match(finding.message, /STRING/);
    assert.match(finding.message, /DATE/);
  });

  it("reports the finding against the arrow's own 1-indexed line", () => {
    // The arrow is the thing to change, not the schema or the mapping header.
    // Extraction records rows 0-indexed; a finding that forgot to add one would
    // send every editor jump one line high.
    const source = bareArrowBetween("STRING", "DATE");
    const [finding] = findingsFor(source);
    const arrowLine = source.split("\n").findIndex((l) => l.includes("signup -> signup_date")) + 1;

    assert.equal(finding.line, arrowLine);
  });

  it("checks a nested arrow's absolute path, not just top-level fields", () => {
    // Nested arrow paths are made absolute against their container during
    // extraction, so the rule gets `address.postcode` and can resolve its type.
    // Without that, every mismatch inside a record body would go unreported.
    const findings = findingsFor(`
schema src {
  addr record {
    postcode INT
  }
}

schema dst {
  address record {
    postcode STRING
  }
}

mapping load {
  source { src }
  target { dst }
  addr -> address {
    .postcode -> .postcode
  }
}
`);

    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /src\.addr\.postcode/);
    assert.match(findings[0].message, /dst\.address\.postcode/);
  });
});

// ── Applicability: only arrows that assert type identity ────────────────────

describe("arrows that assert nothing about type", () => {
  it("exempts an arrow with a transform body", () => {
    // Any transform body means the author said "something happens here", and
    // judging whether that something preserves type is NL interpretation the CLI
    // leaves to agents (PRD 37 R1).
    const findings = findingsFor(`
schema customers { signup STRING }
schema profiles { signup_date DATE }

mapping load {
  source { customers }
  target { profiles }
  signup -> signup_date { parse as ISO-8601 }
}
`);

    assert.deepEqual(findings, []);
  });

  it("exempts a value-map arrow without any map-literal special case", () => {
    // Locks the reasoning that makes value maps exempt *structurally*: a
    // `map { … }` is a pipe_step, so the arrow classifies `nl`, so the rule's
    // `none`-only criterion already skips it. A future refactor that classified
    // map literals separately would silently start type-checking value maps —
    // which convert values and so may legitimately change type. This test fails
    // the moment that classification changes, which is the warning we want.
    const source = `
schema customers { status INT }
schema profiles { status STRING }

mapping load {
  source { customers }
  target { profiles }
  status -> status { map { 1 -> "active", 2 -> "closed" } }
}
`;
    const { arrows } = inputFor(source);
    const valueMapArrow = arrows.find((a) => a.target === "status");

    assert.equal(valueMapArrow.classification, "nl");
    assert.deepEqual(findingsFor(source), []);
  });

  it("exempts a multi-source bare arrow", () => {
    // `first, last -> full_name` asserts something about the combination; no one
    // of its sources is *the* type of the result, so picking one to compare would
    // invent an assertion the author never made.
    const findings = findingsFor(`
schema people {
  first STRING
  last STRING
}

schema profiles { full_name INT }

mapping load {
  source { people }
  target { profiles }
  first, last -> full_name
}
`);

    assert.deepEqual(findings, []);
  });
});

// ── Silence: when the rule cannot know what was asserted ────────────────────

describe("cases the rule must stay silent about", () => {
  it("says nothing when either side declares no type", () => {
    // A field with no declared type gives the rule nothing to compare. Demanding
    // one is a different rule than this one.
    assert.deepEqual(
      findingsFor(`
schema customers { signup }
schema profiles { signup_date DATE }

mapping load {
  source { customers }
  target { profiles }
  signup -> signup_date
}
`),
      [],
    );
  });

  it("says nothing when the arrow path is not declared in any participating schema", () => {
    // An arrow naming a field that does not exist is `validate`'s finding
    // (`field-not-in-schema`). Reporting it again here would double-report one
    // mistake under two rule ids.
    assert.deepEqual(
      findingsFor(`
schema customers { signup STRING }
schema profiles { signup_date DATE }

mapping load {
  source { customers }
  target { profiles }
  typo -> signup_date
}
`),
      [],
    );
  });

  it("says nothing when two source schemas declare the same field with different types", () => {
    // A bare `email -> email` in a two-source mapping names no particular source,
    // so which type the author meant is unknowable. Reporting the first match
    // would make the finding depend on the order of the `source { }` list.
    assert.deepEqual(
      findingsFor(`
schema a { email STRING }
schema b { email INT }
schema out { email STRING }

mapping load {
  source { a, b }
  target { out }
  email -> email
}
`),
      [],
    );
  });

  it("still reports a qualified path when a sibling source shadows the field name", () => {
    // The ambiguity above is about *unqualified* paths. Qualifying the source
    // (`b.email`) removes the ambiguity, and the rule must then compare the type
    // the author actually pointed at — otherwise a multi-source mapping could
    // never be checked at all.
    const findings = findingsFor(`
schema a { email STRING }
schema b { email INT }
schema out { email STRING }

mapping load {
  source { a, b }
  target { out }
  b.email -> email
}
`);

    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /b\.email/);
    assert.match(findings[0].message, /INT/);
  });
});

// ── Normalization: what counts as the same declared type ────────────────────

describe("comparing declared types", () => {
  it("treats case differences as one type", () => {
    // A workspace assembled from several spreadsheets will spell one type both
    // ways; case is not type information.
    assert.deepEqual(findingsFor(bareArrowBetween("String", "STRING")), []);
  });

  it("compares parameterized types on their base token", () => {
    // Declared lengths and precision do not count as mismatches at the
    // granularity this rule judges (PRD 37 R1).
    assert.deepEqual(findingsFor(bareArrowBetween("VARCHAR(255)", "VARCHAR")), []);
    assert.deepEqual(findingsFor(bareArrowBetween("DECIMAL(10,2)", "DECIMAL(12,4)")), []);
  });

  it("ignores constraint flags spelled inside the type parentheses", () => {
    // Satsuma puts constraint flags in the same parentheses as parameters
    // (`UUID(pk)`, sl-vryu). Those are not type information, so an arrow between
    // `UUID(pk)` and `UUID` must not be reported.
    assert.deepEqual(findingsFor(bareArrowBetween("UUID(pk)", "UUID")), []);
  });

  it("still reports two genuinely different base tokens", () => {
    // Guards the normalization above from over-reaching: stripping parameters
    // must not collapse distinct types onto each other.
    assert.equal(findingsFor(bareArrowBetween("VARCHAR(255)", "DECIMAL(10,2)")).length, 1);
  });
});

// ── Alias groups from satsuma.config.yaml ───────────────────────────────────

describe("configured type aliases", () => {
  it("accepts a pair declared equivalent by an alias group", () => {
    // Nothing is presumed equivalent by default — deciding that `TEXT` is a
    // `STRING` is a convention decision this feature does not make (PRD 37, Out
    // of Scope). `lint.typeAliases` is how the author makes it.
    assert.equal(findingsFor(bareArrowBetween("STRING", "TEXT")).length, 1);
    assert.deepEqual(findingsFor(bareArrowBetween("STRING", "TEXT"), [["STRING", "TEXT"]]), []);
  });

  it("matches alias members case-insensitively and on their base token", () => {
    // A group written `[string, varchar]` must alias `VARCHAR(255)` too, or the
    // author has to enumerate every parameterization they happen to have used.
    assert.deepEqual(
      findingsFor(bareArrowBetween("STRING", "VARCHAR(255)"), [["string", "varchar"]]),
      [],
    );
  });

  it("keeps separate alias groups separate", () => {
    // Flattening groups into one pool would make `STRING` equivalent to `INT` in
    // any workspace that declared both a string group and a numeric group — the
    // exact failure `TypeAliasGroup` is modelled per-group to prevent.
    const aliases = [
      ["STRING", "TEXT"],
      ["INT", "BIGINT"],
    ];

    assert.deepEqual(findingsFor(bareArrowBetween("TEXT", "STRING"), aliases), []);
    assert.equal(findingsFor(bareArrowBetween("TEXT", "BIGINT"), aliases).length, 1);
  });

  it("bridges two groups that share a member", () => {
    // A token may legitimately belong to several groups; membership is compared
    // as an intersection, so `TEXT` in both groups makes each of its partners
    // equivalent to it — but not to each other.
    const aliases = [
      ["STRING", "TEXT"],
      ["TEXT", "CLOB"],
    ];

    assert.deepEqual(findingsFor(bareArrowBetween("STRING", "TEXT"), aliases), []);
    assert.deepEqual(findingsFor(bareArrowBetween("CLOB", "TEXT"), aliases), []);
    assert.equal(findingsFor(bareArrowBetween("STRING", "CLOB"), aliases).length, 1);
  });
});

// ── Namespaces ──────────────────────────────────────────────────────────────

describe("namespaced workspaces", () => {
  it("resolves schemas a namespaced mapping refers to by their bare name", () => {
    // Inside `namespace crm`, a mapping writes `customers` for what the index
    // keys as `crm::customers`. If the resolver were handed the wrong namespace
    // the schema would not resolve and the mismatch would go silently unreported.
    const findings = findingsFor(`
namespace crm {
  schema customers { signup STRING }
  schema profiles { signup_date DATE }

  mapping load {
    source { customers }
    target { profiles }
    signup -> signup_date
  }
}
`);

    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /crm::customers\.signup/);
    assert.match(findings[0].message, /crm::profiles\.signup_date/);
  });
});
